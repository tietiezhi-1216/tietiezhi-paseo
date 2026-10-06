import type { QuotaWindow } from "./quota.ts";

export function quotaGroups(windows: readonly QuotaWindow[]) {
  return (["gemini", "claude", "shared"] as const).flatMap((pool) => {
    const items = windows.filter((window) => window.pool === pool);
    return items.length ? [{
      pool, title: pool === "gemini" ? "Gemini" : pool === "claude" ? "Claude + GPT" : "其他额度",
      windows: items.map((window) => {
        const label = window.label;
        const title = /本周|week/i.test(label) ? "本周"
          : /5小时|5h|five.?hour/i.test(label) ? "5小时"
          : /当天|daily|24h/i.test(label) ? "当天"
          : /^(gemini|claude(?:\s*\+\s*gpt)?)$/i.test(label.trim()) ? "额度" : label;
        return { ...window, title };
      }),
    }] : [];
  });
}
