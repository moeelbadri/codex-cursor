import { describe, expect, test } from "bun:test";
import { formatQuota } from "./log.ts";
import { parseWhamUsage } from "./quota.ts";

describe("parseWhamUsage", () => {
  test("reads primary and secondary windows", () => {
    const snap = parseWhamUsage({
      rate_limit: {
        primary_window: {
          used_percent: 18.25,
          reset_at: 1_700_000_000,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 61,
          reset_at: 1_700_500_000,
          limit_window_seconds: 604_800,
        },
      },
    });
    expect(snap?.primary?.usedPercent).toBe(18.25);
    expect(snap?.primary?.remainingPercent).toBe(81.75);
    expect(snap?.secondary?.usedPercent).toBe(61);
    expect(snap?.secondary?.remainingPercent).toBe(39);
  });
});

describe("formatQuota", () => {
  test("includes session and weekly labels", () => {
    const line = formatQuota({
      primary: {
        usedPercent: 10,
        remainingPercent: 90,
        resetAt: null,
        windowSeconds: 18_000,
      },
      secondary: {
        usedPercent: 40,
        remainingPercent: 60,
        resetAt: null,
        windowSeconds: 604_800,
      },
    });
    expect(line).toContain("5h=");
    expect(line).toContain("wk=");
    expect(line).toContain("10.0% used");
    expect(line).toContain("90.0% left");
  });
});
