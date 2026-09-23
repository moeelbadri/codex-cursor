// Fetches ChatGPT/Codex subscription quota (5-hour + weekly windows) from the
// same endpoint the Codex desktop app uses.

import type { CodexAuth } from "./auth.ts";

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export type QuotaWindow = {
  usedPercent: number;
  remainingPercent: number;
  resetAt: number | null;
  windowSeconds: number | null;
};

export type QuotaSnapshot = {
  primary: QuotaWindow | null;
  secondary: QuotaWindow | null;
};

export class QuotaClient {
  constructor(private readonly auth: CodexAuth) {}

  async fetchSnapshot(timeoutMs = 2500): Promise<QuotaSnapshot | null> {
    try {
      const snap = await this.auth.snapshot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(WHAM_USAGE_URL, {
        method: "GET",
        headers: {
          authorization: `Bearer ${snap.accessToken}`,
          "chatgpt-account-id": snap.accountId,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return parseWhamUsage(data);
    } catch {
      return null;
    }
  }
}

export function parseWhamUsage(data: Record<string, unknown>): QuotaSnapshot | null {
  const rateLimit = data["rate_limit"] as Record<string, unknown> | undefined;
  if (!rateLimit) return null;
  const primary = parseWindow(
    rateLimit["primary_window"] ?? rateLimit["primary"],
  );
  const secondary = parseWindow(
    rateLimit["secondary_window"] ?? rateLimit["secondary"],
  );
  if (!primary && !secondary) return null;
  return { primary, secondary };
}

function parseWindow(raw: unknown): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const usedPercent = numberField(w["used_percent"]);
  if (usedPercent === null) return null;
  const resetAt =
    numberField(w["reset_at"]) ?? numberField(w["resets_at"]);
  const windowSeconds = numberField(w["limit_window_seconds"]);
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  return {
    usedPercent,
    remainingPercent,
    resetAt,
    windowSeconds,
  };
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
