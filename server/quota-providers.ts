import type { Family } from "../shared/accounts.ts";
import type { QuotaWindow } from "../shared/quota.ts";
type Rec = Record<string, unknown>;
export type Fetcher = typeof fetch;
const rec = (v: unknown): Rec => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Rec : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function percent(v: unknown): number | null { const n = num(v); return n === null ? null : Math.min(100, Math.max(0, n)); }
function epoch(v: unknown): number | null {
  if (typeof v === "string") { const d = Date.parse(v); return Number.isFinite(d) ? d : null; }
  const n = num(v); return n === null || n <= 0 ? null : n < 1e10 ? n * 1000 : n;
}
export function normalizeWindow(id: string, label: string, used: unknown, reset: unknown, pool: QuotaWindow["pool"] = "shared"): QuotaWindow | null {
  const p = percent(used);
  return p === null ? null : { id: id.slice(0, 200), label: label.slice(0, 100), usedPercent: p, resetAt: epoch(reset), pool };
}
export async function fetchProviderQuota(family: Family, credential: Rec, fetcher: Fetcher, signal: AbortSignal): Promise<{ windows: QuotaWindow[]; plan: string | null }> {
  if (family === "go") throw new Error("此渠道已停用");
  const token = text(credential.access);
  if (!token || token.startsWith("!")) throw new Error("此授权类型不支持额度查询");
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetcher(url, { ...init, redirect: "error", signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers } });
    if (!response.ok) throw new Error(response.status === 401 ? "授权已失效，请在 Pi 续期或重新登录" : `额度接口 HTTP ${response.status}`);
    // Only typed quota fields are returned; never return response text, headers, or arbitrary upstream errors.
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("额度响应过大");
    try { return rec(JSON.parse(body)); } catch { throw new Error("额度响应格式无效"); }
  };
  let windows: QuotaWindow[] = [];
  let plan: string | null = null;
  if (family === "codex") {
    const body = await request("https://chatgpt.com/backend-api/wham/usage", { headers: text(credential.accountId) ? { "ChatGPT-Account-Id": text(credential.accountId) } : {} });
    const rate = rec(body.rate_limit);
    for (const [key, fallback] of [["primary_window", "主窗口"], ["secondary_window", "次窗口"]] as const) {
      const w = rec(rate[key]);
      const seconds = num(w.limit_window_seconds);
      const label = seconds && seconds > 0 ? seconds === 18000 ? "5小时" : seconds === 604800 ? "本周" : `${Math.round(seconds / 3600)}小时` : fallback;
      const normalized = normalizeWindow(key, label, w.used_percent, w.reset_at);
      if (normalized) windows.push(normalized);
    }
    // Restrict plans to human-readable short metadata, not arbitrary response content.
    const p = text(body.plan_type);
    if (/^[A-Za-z0-9 _+-]{1,40}$/.test(p) && ![credential.access, credential.refresh, credential.key].some((s) => typeof s === "string" && s.length > 3 && p.includes(s))) plan = p;
  } else if (family === "xai") {
    const body = await request("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { headers: { "X-XAI-Token-Auth": "xai-grok-cli" } });
    const config = rec(body.config);
    const products = Array.isArray(config.productUsage) ? config.productUsage.map(rec) : [];
    const product = products.find((p) => /grokbuild/i.test(text(p.product)));
    const used = product?.usagePercent ?? config.creditUsagePercent;
    const w = normalizeWindow("billing", "账期", used, rec(config.currentPeriod).end ?? config.billingPeriodEnd);
    if (w) windows.push(w);
    plan = "Grok";

  } else {
    const upstream = async (action: string, payload: Rec) => {
      let last: unknown;
      for (const base of ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"]) {
        try {
          return await request(`${base}/v1internal:${action}`, {
            method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "antigravity/1.23.2" },
            body: JSON.stringify(payload),
          });
        } catch (e) { last = e; if (signal.aborted) break; }
      }
      throw last;
    };
    let project = text(credential.projectId);
    if (!project) {
      const info = await upstream("loadCodeAssist", { metadata: { ideType: "ANTIGRAVITY", ideVersion: "1.23.2", ideName: "antigravity" } });
      project = text(info.cloudaicompanionProject ?? info.cloudAiCompanionProject ?? info.projectId);
    }
    if (!project) throw new Error("未提供 Antigravity project；请在 Pi 完成登录");
    // Deliberately do not call onboardUser or refresh tokens.
    const [available, summary] = await Promise.all([
      upstream("fetchAvailableModels", { project }),
      upstream("retrieveUserQuotaSummary", {}).catch(() => ({})),
    ]);
    
    // First, try to extract windows from the summary.
    const sum = rec(summary);
    const groups = (Array.isArray(sum.groups) ? sum.groups : Array.isArray(rec(sum.quotaSummary).groups) ? rec(sum.quotaSummary).groups : []) as unknown[];
    for (const group of groups) {
      const row = rec(group);
      const groupName = typeof row.displayName === "string" ? row.displayName : "";
      const pool = /gemini/i.test(groupName) ? "gemini" : /claude/i.test(groupName) ? "claude" : null;
      if (!pool) continue;
      const buckets = Array.isArray(row.buckets) ? row.buckets : [];
      for (const bucket of buckets) {
        const item = rec(bucket);
        const remaining = num(item.remainingFraction);
        if (remaining === null) continue;
        const identity = [item.window, item.displayName, item.bucketId].filter((value) => typeof value === "string").join(" ");
        const title = /本周|week/i.test(identity) ? "本周" : /5小时|5h|five.?hour/i.test(identity) ? "5小时" : /当天|daily|24h/i.test(identity) ? "当天" : pool === "gemini" ? "Gemini" : "Claude / GPT-OSS";
        const w = normalizeWindow(`${pool}-${windows.length}`, title, (1 - remaining) * 100, item.resetTime, pool);
        if (w) windows.push(w);
      }
    }

    // Fallback to fetchAvailableModels if summary is empty.
    if (!windows.length) {
      for (const [name, value] of Object.entries(rec(available.models)).slice(0, 100)) {
        const model = rec(value), quota = rec(model.quotaInfo);
        const remaining = num(quota.remainingFraction);
        if (remaining === null) continue;
        const identity = `${name} ${text(model.modelProvider)}`;
        const pool = /gemini/i.test(identity) ? "gemini" : /claude|anthropic|gpt-oss/i.test(identity) ? "claude" : null;
        if (!pool) continue;
        const w = normalizeWindow(`${pool}-${windows.length}`, pool === "gemini" ? "Gemini" : "Claude / GPT-OSS", (1 - remaining) * 100, quota.resetTime, pool);
        if (w) windows.push(w);
      }
    }
    // We keep all windows returned by the API so that multiple quotas (e.g. 5 hours and 1 week) are shown.
    // However, if there are duplicates with the exact same reset time and used percentage, we could filter them out.
    // The upstream returns different models which map to the same pool and same quota.
    const seen = new Set<string>();
    const uniqueWindows = [];
    for (const w of windows) {
      const sig = `${w.pool}:${Math.round(w.usedPercent)}:${Math.round((w.resetAt ?? 0) / 60000)}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        uniqueWindows.push(w);
      }
    }
    windows = uniqueWindows;
    plan = "Antigravity";
  }
  if (!windows.length) throw new Error("接口未提供可计算的额度百分比");
  return { windows, plan };
}
export function safeQuotaError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^(额度接口 HTTP [0-9]{3}|授权已失效，请在 Pi 续期或重新登录|此授权类型不支持额度查询|额度响应过大|额度响应格式无效|接口未提供可计算的额度百分比|未提供 Antigravity project；请在 Pi 完成登录)$/.test(message)
    ? message : "额度查询失败或网络超时；保留上次结果";
}
export function legacyQuotaWindows(value: unknown): QuotaWindow[] {
  const usage = rec(value);
  const windows: QuotaWindow[] = [];
  for (const [id, label] of [["primary", "主窗口"], ["secondary", "次窗口"]] as const) {
    const w = rec(usage[id]), normalized = normalizeWindow(id, label, w.usedPercent, w.resetAt);
    if (normalized) windows.push(normalized);
  }
  for (const raw of (Array.isArray(usage.windows) ? usage.windows : []).slice(0, 100)) {
    const w = rec(raw), label = text(w.label);
    const pool = /gemini/i.test(label) ? "gemini" : /claude|gpt|anthropic/i.test(label) ? "claude" : "shared";
    // Generic legacy Antigravity windows are excluded by the service, as their pool isn't identifiable.
    const normalized = normalizeWindow(`legacy-${windows.length}`, label, w.usedPercent, w.resetAt, pool);
    if (normalized) windows.push(normalized);
  }
  return windows.slice(0, 100);
}
