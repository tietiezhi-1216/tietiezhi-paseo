import { compactDateTime } from "./ui-format.ts";

export type MembershipExpiry = { text: string; detail: string; date: string; recordedDatePassed: boolean };

/** Saved account metadata is not a freshly verified subscription status. */
export function membershipExpiry(at: number | null | undefined, now = Date.now()): MembershipExpiry | null {
  if (at == null || !Number.isFinite(at) || at <= 0 || !Number.isFinite(now) || !Number.isFinite(new Date(at).getTime())) return null;
  const date = compactDateTime(at);
  const fullDate = `${new Date(at).getFullYear()}/${date}`;
  const remaining = at - now;
  const provenance = "来自保存的账号资料，不是额度接口实时确认的会员状态；会员到期、额度重置和登录令牌有效期互不等同。";
  if (remaining <= 0) return {
    text: "会员日期已过 · 待核实", date, recordedDatePassed: true,
    detail: `记录日期 ${fullDate} 已过，当前会员状态尚未核实。${provenance}`,
  };
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  const countdown = days ? `${days}天${hours ? `${hours}小时` : ""}`
    : hours ? `${hours}小时${mins ? `${mins}分` : ""}`
    : mins ? `${mins}分` : "不到1分钟";
  return { text: `会员记录 ${countdown}后到期`, date, recordedDatePassed: false,
    detail: `记录日期 ${fullDate}；${provenance}` };
}
