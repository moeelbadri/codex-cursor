// Model slugs for GET /v1/models: live Codex catalog (same as the CLI), then
// ~/.codex/models_cache.json, then a small built-in fallback list.

import type { CodexAuth } from "./auth.ts";
import { resolveModelsCachePath } from "./paths.ts";

export { resolveModelsCachePath };

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
/** Keep in sync with upstream.ts CODEX_USER_AGENT_VERSION. */
const CODEX_CLIENT_VERSION = "0.120.0";
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
};

export function slugsFromModelRecords(models: unknown): string[] {
  const list = Array.isArray(models) ? (models as CachedModel[]) : [];
  const picked: { slug: string; priority: number }[] = [];
  for (const model of list) {
    if (!model || typeof model !== "object") continue;
    const slug = model.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    // Include picker + API-only slugs; skip disabled entries.
    const visibility = model.visibility;
    if (visibility === "none" || visibility === "hidden") continue;
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
    return slugsFromModelRecords(parsed.models);
  } catch {
    return [];
  }
}

export function parseModelsResponseJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as ModelsCacheFile;
    return slugsFromModelRecords(parsed.models);
  } catch {
    return [];
  }
}

type ModelsListCache = {
  path: string;
  mtimeMs: number;
  ids: string[];
  source: "file" | "fallback";
};

export type ModelsListSource = "remote" | "file" | "fallback";

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

  private async tryRemoteCatalog(): Promise<string[] | null> {
    if (!this.auth) return null;
    if (this.remoteCache && Date.now() < this.remoteCache.expiresAt) {
      return this.remoteCache.ids;
    }
    try {
      const snap = await this.auth.refreshIfStale();
      const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${snap.accessToken}`,
          "chatgpt-account-id": snap.accountId,
          originator: "codex_cli_rs",
          "user-agent": `codex_cli_rs/${CODEX_CLIENT_VERSION} (codex-sub-cursor)`,
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

  async listModels(): Promise<ModelsListResult> {
    const remote = await this.tryRemoteCatalog();
    if (remote) {
      return { ids: remote, source: "remote", cachePath: this.cachePath };
    }

    const file = Bun.file(this.cachePath);
    const stat = await file.stat().catch(() => null);
    if (!stat) {
      return {
        ids: [...FALLBACK_MODEL_IDS],
        source: "fallback",
        cachePath: this.cachePath,
      };
    }
    if (
      this.memory &&
      this.memory.path === this.cachePath &&
      this.memory.mtimeMs === stat.mtimeMs
    ) {
      return {
        ids: this.memory.ids,
        source: this.memory.source,
        cachePath: this.cachePath,
      };
    }
    const text = await file.text().catch(() => "");
    const fromCache = parseModelsCacheJson(text);
    const source = fromCache.length > 0 ? "file" : "fallback";
    const ids = source === "file" ? fromCache : [...FALLBACK_MODEL_IDS];
    this.memory = { path: this.cachePath, mtimeMs: stat.mtimeMs, ids, source };
    return {
      ids,
      source,
      cachePath: this.cachePath,
    };
  }
}
