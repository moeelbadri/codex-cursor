// Model slugs for GET /v1/models: live Codex catalog (same as the CLI), then
// ~/.codex/models_cache.json, then a small built-in fallback list.

import type { CodexAuth } from "./auth.ts";
import { resolveModelsCachePath } from "./paths.ts";

export { resolveModelsCachePath };

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
/** Default when models_cache.json has no client_version (stale values shrink the catalog). */
const DEFAULT_CODEX_CLIENT_VERSION = "0.144.4";
const REMOTE_MODELS_TTL_MS = 5 * 60 * 1000;

export const FALLBACK_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
  "codex-auto-review",
];

type CachedModel = {
  slug?: string;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
};

type ModelsCacheFile = {
  models?: CachedModel[];
  client_version?: string | number[];
};

export function extractModelsArray(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, unknown>;
  if (Array.isArray(root["models"])) return root["models"] as unknown[];
  return [];
}

export function slugsFromModelRecords(models: unknown): string[] {
  const list = Array.isArray(models) ? (models as CachedModel[]) : [];
  const picked: { slug: string; priority: number }[] = [];
  for (const model of list) {
    if (!model || typeof model !== "object") continue;
    const slug = model.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    // Skip entries explicitly marked unavailable; list everything else for discovery.
    const visibility = model.visibility;
    if (visibility === "none") continue;
    if (model.supported_in_api === false) continue;
    const priority = typeof model.priority === "number" ? model.priority : 0;
    picked.push({ slug, priority });
  }
  picked.sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const { slug } of picked) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    ids.push(slug);
  }
  return ids;
}

export function parseModelsCacheJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as ModelsCacheFile;
    return slugsFromModelRecords(extractModelsArray(parsed));
  } catch {
    return [];
  }
}

export function parseModelsResponseJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    return slugsFromModelRecords(extractModelsArray(parsed));
  } catch {
    return [];
  }
}

export function readClientVersionFromCacheText(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as ModelsCacheFile;
    const v = parsed.client_version;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (Array.isArray(v) && v.length >= 3) {
      return `${v[0]}.${v[1]}.${v[2]}`;
    }
  } catch {}
  return null;
}

export function mergeModelSlugLists(...lists: readonly string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const slug of list) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

type ModelsListCache = {
  path: string;
  mtimeMs: number;
  ids: string[];
  source: "file" | "fallback";
};

export type ModelsListSource = "merged" | "remote" | "file" | "fallback";

export type ModelsListResult = {
  ids: string[];
  source: ModelsListSource;
  cachePath: string;
};

export class ModelsCatalog {
  private memory: ModelsListCache | null = null;
  private remoteCache: { ids: string[]; expiresAt: number } | null = null;

  constructor(
    private readonly cachePath: string,
    private readonly auth?: CodexAuth,
  ) {}

  get cacheFilePath(): string {
    return this.cachePath;
  }

  private async resolveClientVersion(): Promise<string> {
    const text = await Bun.file(this.cachePath).text().catch(() => "");
    return (
      readClientVersionFromCacheText(text) ?? DEFAULT_CODEX_CLIENT_VERSION
    );
  }

  private async tryRemoteCatalog(): Promise<string[] | null> {
    if (!this.auth) return null;
    if (this.remoteCache && Date.now() < this.remoteCache.expiresAt) {
      return this.remoteCache.ids;
    }
    try {
      const snap = await this.auth.refreshIfStale();
      const clientVersion = await this.resolveClientVersion();
      const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(clientVersion)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${snap.accessToken}`,
          "chatgpt-account-id": snap.accountId,
          originator: "codex_cli_rs",
          "user-agent": `codex_cli_rs/${clientVersion} (codex-sub-cursor)`,
        },
      });
      if (!res.ok) return null;
      const ids = parseModelsResponseJson(await res.text());
      if (ids.length === 0) return null;
      this.remoteCache = { ids, expiresAt: Date.now() + REMOTE_MODELS_TTL_MS };
      return ids;
    } catch {
      return null;
    }
  }

  private async loadFileModelIds(): Promise<string[]> {
    const file = Bun.file(this.cachePath);
    const stat = await file.stat().catch(() => null);
    if (!stat) return [];
    if (
      this.memory &&
      this.memory.path === this.cachePath &&
      this.memory.mtimeMs === stat.mtimeMs &&
      this.memory.source !== "fallback"
    ) {
      return this.memory.source === "file" ? this.memory.ids : [];
    }
    const text = await file.text().catch(() => "");
    const fromCache = parseModelsCacheJson(text);
    const source = fromCache.length > 0 ? "file" : "fallback";
    const ids = source === "file" ? fromCache : [...FALLBACK_MODEL_IDS];
    this.memory = { path: this.cachePath, mtimeMs: stat.mtimeMs, ids, source };
    return source === "file" ? fromCache : [];
  }

  async listModels(): Promise<ModelsListResult> {
    const remote = (await this.tryRemoteCatalog()) ?? [];
    const file = await this.loadFileModelIds();
    const merged = mergeModelSlugLists(
      remote,
      file,
      remote.length === 0 && file.length === 0 ? FALLBACK_MODEL_IDS : [],
    );

    let source: ModelsListSource = "fallback";
    if (remote.length > 0 && file.length > 0) source = "merged";
    else if (remote.length > 0) source = "remote";
    else if (file.length > 0) source = "file";
    else if (merged.length > 0) source = "fallback";

    return {
      ids: merged.length > 0 ? merged : [...FALLBACK_MODEL_IDS],
      source,
      cachePath: this.cachePath,
    };
  }
}
