// Reads model slugs from the Codex CLI's ~/.codex/models_cache.json (refreshed by
// `codex` / `codex debug models`). Falls back to a small built-in list when the
// cache is missing or unreadable.

import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const FALLBACK_MODEL_IDS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
  "codex-auto-review",
];

export function resolveModelsCachePath(authPath?: string): string {
  const auth = authPath ?? join(homedir(), ".codex", "auth.json");
  return join(dirname(auth), "models_cache.json");
}

type CachedModel = {
  slug?: string;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
};

type ModelsCacheFile = {
  models?: CachedModel[];
};

export function parseModelsCacheJson(text: string): string[] {
  let parsed: ModelsCacheFile;
  try {
    parsed = JSON.parse(text) as ModelsCacheFile;
  } catch {
    return [];
  }
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  const picked: { slug: string; priority: number }[] = [];
  for (const model of models) {
    if (!model || typeof model !== "object") continue;
    const slug = model.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    if (model.visibility === "hidden") continue;
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

type ModelsListCache = {
  path: string;
  mtimeMs: number;
  ids: string[];
  source: "cache" | "fallback";
};

export type ModelsListResult = {
  ids: string[];
  source: "cache" | "fallback";
  cachePath: string;
};

export class ModelsCatalog {
  private memory: ModelsListCache | null = null;

  constructor(private readonly cachePath: string) {}

  get cacheFilePath(): string {
    return this.cachePath;
  }

  async listModels(): Promise<ModelsListResult> {
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
    const source = fromCache.length > 0 ? "cache" : "fallback";
    const ids = source === "cache" ? fromCache : [...FALLBACK_MODEL_IDS];
    this.memory = { path: this.cachePath, mtimeMs: stat.mtimeMs, ids, source };
    return {
      ids,
      source,
      cachePath: this.cachePath,
    };
  }
}
