export function compactDateTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function compactTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatWhen(ts: number | null | undefined, empty = "—"): string {
  if (!ts || !Number.isFinite(ts)) return empty;
  const at = new Date(ts);
  if (!Number.isFinite(at.getTime())) return empty;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const ms = ts - Date.now();
  if (ms <= 0) return `已到 ${clock}`;
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}分钟后 · ${clock}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时后 · ${clock}`;
  return `${Math.round(hours / 24)}天后 · ${clock}`;
}

export function formatExpiry(ts: number | null | undefined): { label: string; text: string; urgent: boolean; expired: boolean } | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const at = new Date(ts);
  if (!Number.isFinite(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const now = Date.now();
  const diffMs = ts - now;
  if (diffMs <= 0) {
    return { label: "会员已到期", text: `已到期 (${timeStr})`, urgent: true, expired: true };
  }
  const hours = Math.round(diffMs / (3600 * 1000));
  if (hours < 24) {
    const displayHours = Math.max(1, hours);
    return { label: "会员到期", text: `${displayHours}小时后 · ${timeStr}`, urgent: true, expired: false };
  }
  const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
  if (diffDays <= 3) {
    return { label: "会员到期", text: `${diffDays}天后 · ${timeStr}`, urgent: true, expired: false };
  }
  return { label: "会员到期", text: `${diffDays}天后 · ${timeStr}`, urgent: false, expired: false };
}

export function usedPercent(used: number | null | undefined): number | null {
  return used === null || used === undefined || !Number.isFinite(used) ? null : Math.max(0, Math.min(100, used));
}

export function usedLabel(used: number | null | undefined): string {
  const percent = usedPercent(used);
  return percent === null ? "—" : `${Math.round(percent)}%`;
}

export function quotaFailureLabel(message: string | null | undefined): string {
  if (!message) return "";
  if (/授权已失效|401|登录/.test(message)) return "需登录";
  if (/429/.test(message)) return "稍后重试";
  if (/403/.test(message)) return "无权查询";
  if (/不支持/.test(message)) return "不支持额度";
  if (/未提供|格式无效/.test(message)) return "暂无额度";
  return "查询失败";
}
