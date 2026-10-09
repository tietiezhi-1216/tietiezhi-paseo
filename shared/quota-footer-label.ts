import type { Family } from "./accounts.ts";
import { selectQuotaWindow, type QuotaWindow } from "./quota.ts";

export function resetCountdown(resetAt: number | null | undefined, now: number): string {
  if (resetAt == null || !Number.isFinite(resetAt)) return "刷新时间未知";
  const minutes = Math.ceil((resetAt - now) / 60_000);
  if (minutes <= 0) return "待刷新";
  if (minutes < 60) return `${minutes}分钟后刷新`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)}小时后刷新`;
  return `${Math.ceil(minutes / 1440)}天后刷新`;
}

export function readableResetCountdown(resetAt: number | null | undefined, now: number, compact = false): string {
  if (resetAt == null || !Number.isFinite(resetAt) || !Number.isFinite(now)) return "重置时间未知";
  const duration = resetAt - now;
  if (duration <= 0) return "等待重置";
  const days = Math.floor(duration / 86400000);
  const hours = Math.floor(duration % 86400000 / 3600000);
  const text = days ? `${days} 天${hours ? ` ${hours} 小时` : ""}后重置`
    : hours ? `${hours} 小时后重置` : `${Math.ceil(duration / 60000)} 分钟后重置`;
  return compact ? text.replaceAll(" ", "") : text;
}

export function naturalCountdown(resetAt: number | null | undefined, now: number): string {
  if (resetAt == null || !Number.isFinite(resetAt) || !Number.isFinite(now)) return "—";
  const duration = resetAt - now;
  if (duration <= 0) return "待刷新";
  const totalSeconds = Math.floor(duration / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days >= 1) {
    return `${days}天${hours > 0 ? `${hours}小时` : ""}后`;
  }
  if (hours >= 1) {
    return `${hours}小时${minutes > 0 ? `${minutes}分钟` : ""}后`;
  }
  if (minutes >= 1) {
    return `${minutes}分钟${seconds > 0 ? `${seconds}秒` : ""}后`;
  }
  return `${seconds}秒后`;
}


export function absoluteFooterReset(resetAt: number | null | undefined, now: number): string {
  return naturalCountdown(resetAt, now);
}

export function liveResetCountdown(resetAt: number | null | undefined, now: number, seconds = true): string {
  if (resetAt == null || !Number.isFinite(resetAt) || !Number.isFinite(now)) return "—";
  const total = Math.ceil((resetAt - now) / 1000);
  if (total <= 0) return "待刷新";
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total % 86400 / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(total % 60)}` : ""}`;
  return `${days ? `${days}天 ` : ""}${clock}`;
}

export function timeUntilReset(resetAt: number | null | undefined, now: number): string {
  const text = readableResetCountdown(resetAt, now, true);
  return text.replace("重置时间未知", "未知").replace("等待重置", "等待重置").replace("后重置", "后");
}

export function compactResetCountdown(resetAt: number | null | undefined, now: number): string {
  return resetCountdown(resetAt, now)
    .replace("分钟后刷新", "分").replace("小时后刷新", "时").replace("天后刷新", "天")
    .replace("刷新时间未知", "—");
}

export function subscriptionExpiryLabel(expiresAt: number | null | undefined): string {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return "到期—";
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return "到期—";
  return `到期${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function accountLevelLabel(plan: string | null | undefined): string {
  const value = plan?.trim();
  if (!value) return "—";
  // Keep provider-supplied levels; only shorten familiar branded names.
  return value.replace(/^chatgpt\s+/i, "").toUpperCase();
}

export function quotaFooterLabel(family: Family, windows: QuotaWindow[], now: number, stale = false, loading = false, readable = false): string {
  const vendor = { codex: "Codex", xai: "Grok", go: "Go", antigravity: "AG" }[family];
  const remaining = (window: QuotaWindow) => `${Math.round(100 - window.usedPercent)}%`;
  const window = selectQuotaWindow(family, family === "antigravity" ? "gemini" : null, windows);
  if (!window) return `${vendor} · ${loading ? "读取中…" : "未获取"}`;
  return `${vendor} ${remaining(window)} · ${stale ? "缓存 · " : ""}${readable ? readableResetCountdown(window.resetAt, now) : resetCountdown(window.resetAt, now)}`;
}
