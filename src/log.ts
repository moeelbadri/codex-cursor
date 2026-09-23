import type { QuotaSnapshot } from "./quota.ts";

// Per-request console logger. Designed so a quick glance at the proxy
// terminal makes it obvious whether Cursor is actually hitting it (vs.
// silently falling back to its own provider).
//
// One line per chat completion is emitted on completion or error, e.g.:
//
//   [14:23:01] gpt-5.5 stream msgs=3 tools=1 → 200 in=14 out=42 tot=56 | 5h=12% used 88% left | wk=40% used 60% left 1.2s stop
//
// With --verbose, a second indented line shows a preview of the latest user
// message so you can correlate with what you typed in Cursor.

const ESC = "\x1b[";
const C = {
  reset: `${ESC}0m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
};

export type LogLevel = "quiet" | "info" | "verbose";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type LogContext = {
  model: string;
  stream: boolean;
  messageCount: number;
  toolCount: number;
  // First ~120 chars of the latest non-system message for verbose mode.
  preview: string | null;
};

export type LogResult = {
  status: number;
  finishReason?: string | null;
  serverModel?: string | null;
  upstreamRequestId?: string | null;
  usage?: Usage | null;
  quota?: QuotaSnapshot | null;
  error?: string;
};

export class RequestLogger {
  private readonly start = Date.now();

  constructor(
    private readonly level: LogLevel,
    private readonly ctx: LogContext,
  ) {
    if (this.level === "verbose" && this.ctx.preview) {
      // Print a "request started" line so verbose mode can show the prompt
      // even before the upstream finishes (useful for long reasoning runs).
      const ts = formatTime(new Date());
      process.stdout.write(
        `${C.gray}[${ts}]${C.reset} ${C.cyan}${this.ctx.model}${C.reset} ${this.modeLabel()} ${C.dim}msgs=${this.ctx.messageCount} tools=${this.ctx.toolCount}${C.reset}\n` +
          `           ${C.dim}> ${this.ctx.preview}${C.reset}\n`,
      );
    }
  }

  complete(result: LogResult): void {
    if (this.level === "quiet") return;
    const elapsed = Date.now() - this.start;
    const ts = formatTime(new Date());
    const status = colorStatus(result.status);
    const finish = result.error
      ? `${C.red}${truncate(result.error, 80)}${C.reset}`
      : finishLabel(result.finishReason ?? "stop");
    const tokens = result.usage ? formatUsage(result.usage) : `${C.dim}(no usage)${C.reset}`;
    const quota = result.quota ? formatQuota(result.quota) : "";
    const reqId = result.upstreamRequestId
      ? ` ${C.dim}req=${result.upstreamRequestId}${C.reset}`
      : "";
    const serverModel =
      result.serverModel && result.serverModel !== this.ctx.model
        ? ` ${C.dim}→${result.serverModel}${C.reset}`
        : "";
    const line =
      `${C.gray}[${ts}]${C.reset} ` +
      `${C.cyan}${this.ctx.model}${C.reset}${serverModel} ` +
      `${this.modeLabel()} ` +
      `${C.dim}msgs=${this.ctx.messageCount} tools=${this.ctx.toolCount}${C.reset} ` +
      `→ ${status} ${tokens}` +
      (quota ? ` ${quota}` : "") +
      ` ${formatDuration(elapsed)} ${finish}${reqId}\n`;
    process.stdout.write(line);
  }

  private modeLabel(): string {
    return this.ctx.stream
      ? `${C.magenta}stream${C.reset}`
      : `${C.blue}json${C.reset}`;
  }
}



// Pulls usage out of the upstream `response.completed` event payload.
export function usageFromCompleted(
  completedResponse: Record<string, unknown> | undefined,
): Usage | null {
  const u = completedResponse?.["usage"] as Record<string, unknown> | undefined;
  if (!u) return null;
  const input = numberOr(u["input_tokens"], 0);
  const output = numberOr(u["output_tokens"], 0);
  const details = u["output_tokens_details"] as Record<string, unknown> | undefined;
  const reasoning = numberOr(details?.["reasoning_tokens"], 0);
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: numberOr(u["total_tokens"], input + output),
  };
}

export function formatQuota(q: QuotaSnapshot): string {
  const parts: string[] = [];
  if (q.primary) {
    parts.push(
      `${windowLabel(q.primary.windowSeconds, "5h")}=${formatWindowQuota(q.primary)}`,
    );
  }
  if (q.secondary) {
    parts.push(
      `${windowLabel(q.secondary.windowSeconds, "wk")}=${formatWindowQuota(q.secondary)}`,
    );
  }
  if (parts.length === 0) return "";
  return `${C.dim}|${C.reset} ${parts.join(` ${C.dim}|${C.reset} `)}`;
}

function windowLabel(windowSeconds: number | null, fallback: string): string {
  if (windowSeconds === 18_000) return "5h";
  if (windowSeconds === 604_800) return "wk";
  return fallback;
}

function formatWindowQuota(w: NonNullable<QuotaSnapshot["primary"]>): string {
  const used = `${w.usedPercent.toFixed(1)}% used`;
  const left = `${w.remainingPercent.toFixed(1)}% left`;
  const reset = w.resetAt ? ` ${formatResetIn(w.resetAt)}` : "";
  return `${C.yellow}${used}${C.reset} ${C.green}${left}${C.reset}${reset}`;
}

function formatResetIn(resetAtUnixSec: number): string {
  const deltaSec = Math.max(0, resetAtUnixSec - Math.floor(Date.now() / 1000));
  if (deltaSec < 60) return `${C.dim}resets ${deltaSec}s${C.reset}`;
  const mins = Math.floor(deltaSec / 60);
  if (mins < 120) return `${C.dim}resets ${mins}m${C.reset}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 48) {
    return remMins > 0
      ? `${C.dim}resets ${hours}h${remMins}m${C.reset}`
      : `${C.dim}resets ${hours}h${C.reset}`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0
    ? `${C.dim}resets ${days}d${remHours}h${C.reset}`
    : `${C.dim}resets ${days}d${C.reset}`;
}

function formatUsage(u: Usage): string {
  const reasoning = u.reasoningTokens > 0 ? `${C.dim}(r${u.reasoningTokens})${C.reset}` : "";
  return (
    `${C.dim}in=${C.reset}${u.inputTokens} ` +
    `${C.dim}out=${C.reset}${u.outputTokens}${reasoning ? " " + reasoning : ""} ` +
    `${C.dim}tot=${C.reset}${u.totalTokens}`
  );
}

function colorStatus(status: number): string {
  const color =
    status < 300 ? C.green : status < 400 ? C.yellow : status < 500 ? C.yellow : C.red;
  return `${color}${status}${C.reset}`;
}

function finishLabel(finish: string): string {
  switch (finish) {
    case "stop":
      return `${C.green}stop${C.reset}`;
    case "tool_calls":
      return `${C.magenta}tool_calls${C.reset}`;
    case "length":
      return `${C.yellow}length${C.reset}`;
    case "content_filter":
      return `${C.red}content_filter${C.reset}`;
    default:
      return `${C.dim}${finish}${C.reset}`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${C.dim}${ms}ms${C.reset}`;
  return `${C.dim}${(ms / 1000).toFixed(1)}s${C.reset}`;
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}



function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
