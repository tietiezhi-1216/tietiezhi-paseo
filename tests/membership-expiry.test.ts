import assert from "node:assert/strict";
import { test } from "node:test";
import { membershipExpiry } from "../shared/membership-expiry.ts";

const now = new Date(2026, 9, 9, 12, 0).getTime();
const minute = 60_000, hour = 60 * minute, day = 24 * hour;

test("会员记录精确到天/小时/分钟，不把剩余几小时显示成一天", () => {
  assert.equal(membershipExpiry(now + 13 * day + 4 * hour, now)?.text, "会员记录 13天4小时后到期");
  assert.equal(membershipExpiry(now + 3 * hour + 20 * minute, now)?.text, "会员记录 3小时20分后到期");
  assert.equal(membershipExpiry(now + 23 * hour + 59 * minute, now)?.text, "会员记录 23小时59分后到期");
  assert.equal(membershipExpiry(now + 20 * minute, now)?.text, "会员记录 20分后到期");
  assert.equal(membershipExpiry(now + minute, now)?.text, "会员记录 1分后到期");
});

test("不到一分钟仍倒计时，不提前判断日期已过；到点只标记记录待核实", () => {
  assert.equal(membershipExpiry(now + 1, now)?.text, "会员记录 不到1分钟后到期");
  assert.equal(membershipExpiry(now + 59_999, now)?.recordedDatePassed, false);
  const passed = membershipExpiry(now, now)!;
  assert.equal(passed.text, "会员日期已过 · 待核实");
  assert.equal(passed.recordedDatePassed, true);
  assert.doesNotMatch(passed.text, /会员已到期|到期到期/);
  assert.match(passed.detail, /当前会员状态尚未核实/);
});

test("历史日期不滚动、不替换为额度重置日，日期与数据来源均保留", () => {
  const at = new Date(2026, 9, 8, 10, 16).getTime();
  const value = membershipExpiry(at, now)!;
  assert.equal(value.date, "10/08 10:16");
  assert.match(value.detail, /保存的账号资料/);
  assert.match(value.detail, /额度重置和登录令牌有效期互不等同/);
  assert.equal(value.text, "会员日期已过 · 待核实");
});

test("倒计时随当前时间递减；更新到期记录后以新日期计算", () => {
  const at = now + 3 * hour + 20 * minute;
  assert.equal(membershipExpiry(at, now + minute)?.text, "会员记录 3小时19分后到期");
  assert.equal(membershipExpiry(now + day, now)?.recordedDatePassed, false);
  assert.match(membershipExpiry(now + day, now)!.detail, /不是额度接口实时确认/);
});

test("缺失或无效的记录不伪造会员日期", () => {
  for (const at of [null, undefined, NaN, Infinity, -Infinity, 0, -1, 1e20]) assert.equal(membershipExpiry(at, now), null);
  assert.equal(membershipExpiry(now + hour, NaN), null);
});
