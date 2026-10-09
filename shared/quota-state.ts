import type { AccountQuota, QuotaWindow } from "./quota.ts";
import { compactDateTime } from "./ui-format.ts";

export const QUOTA_FRESHNESS_MS = 5 * 60_000 + 30_000;
export type QuotaPresentation = {
  kind: "fresh" | "cached" | "expired" | "error" | "unavailable" | "missing";
  windows: QuotaWindow[];
  label: string;
  detail: string;
};

/** Decide what can be shown as quota, never extrapolate a provider's reset time. */
export function quotaPresentation(quota: AccountQuota | undefined, now = Date.now(), pending = false): QuotaPresentation {
  const none = (kind: QuotaPresentation["kind"], label: string, detail = label): QuotaPresentation => ({ kind, windows: [], label, detail });
  if (quota?.error) {
    if (/未提供可计算/.test(quota.error)) return none("unavailable", "额度未提供", "接口未返回可计算的额度比例");
    const label = /授权已失效|401|登录/.test(quota.error) ? "额度授权异常" : /429/.test(quota.error) ? "查询限流" : "查询失败";
    return none("error", label, label + (quota.fetchedAt != null ? ` · 上次获取 ${compactDateTime(quota.fetchedAt)}` : ""));
  }
  if (!quota?.windows.length) return none("missing", pending ? "读取中…" : "未获取");
  const windows = quota.windows.filter((w) => w.resetAt == null || (Number.isFinite(w.resetAt) && w.resetAt > now));
  if (!windows.length) return none("expired", "旧额度已过期", "旧周期数据已隐藏");
  const timestamp = quota.fetchedAt;
  if (timestamp == null || !Number.isFinite(timestamp)) return none("cached", "历史额度未确认");
  const cached = quota.stale || now - timestamp > QUOTA_FRESHNESS_MS || timestamp > now + 60_000;
  return { kind: cached ? "cached" : "fresh", windows,
    label: cached ? "缓存" : "", detail: `${cached ? "缓存 · " : ""}获取于 ${compactDateTime(timestamp)}` };
}

export function quotaHostCacheKey(hostId: string, key: string): string {
  return JSON.stringify([hostId, key]);
}
