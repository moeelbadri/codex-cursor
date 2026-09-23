import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Codex CLI home (`CODEX_HOME`, else directory containing auth.json). */
export function resolveCodexHome(authPath?: string): string {
  const fromEnv = process.env["CODEX_HOME"]?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("~/")
      ? join(homedir(), fromEnv.slice(2))
      : fromEnv === "~"
        ? homedir()
        : fromEnv;
  }
  if (authPath) return dirname(authPath);
  return join(homedir(), ".codex");
}

export function resolveModelsCachePath(authPath?: string): string {
  return join(resolveCodexHome(authPath), "models_cache.json");
}

export function defaultAuthPath(authPath?: string): string {
  return authPath ?? join(resolveCodexHome(), "auth.json");
}
