import { test } from "node:test";
import assert from "node:assert/strict";
import { accountLevelLabel, compactResetCountdown, liveResetCountdown, readableResetCountdown, quotaFooterLabel, resetCountdown, subscriptionExpiryLabel } from "../shared/quota-footer-label.ts";

const now = 1_790_000_000_000;
test("可读重置时间展示天和小时，窄栏只收紧空格", () => {
  const end = now + (4 * 86400 + 18 * 3600 + 20 * 60) * 1000;
  assert.equal(readableResetCountdown(end, now), "4 天 18 小时后重置");
  assert.equal(readableResetCountdown(end, now, true), "4天18小时后重置");
  assert.equal(readableResetCountdown(now + 45 * 60000, now), "45 分钟后重置");
  assert.equal(readableResetCountdown(null, now), "重置时间未知");
  assert.equal(readableResetCountdown(now, now), "等待重置");
});
test("秒级倒计时按绝对重置时间计算，跨天/跨秒无累计漂移", () => {
  const end = now + (5 * 86400 + 3 * 3600 + 24 * 60 + 18) * 1000;
  assert.equal(liveResetCountdown(end, now), "5天 03:24:18");
  assert.equal(liveResetCountdown(end, now + 1000), "5天 03:24:17");
  assert.equal(liveResetCountdown(end, now + 18000), "5天 03:24:00");
  assert.equal(liveResetCountdown(now + 86400000, now), "1天 00:00:00");
  assert.equal(liveResetCountdown(now + 86400000, now + 1000), "23:59:59");
  assert.equal(liveResetCountdown(now + 3600000, now, false), "01:00");
});
test("倒计时缺失显示未知，到时不变成负数或伪造新周期", () => {
  assert.equal(liveResetCountdown(null, now), "—");
  assert.equal(liveResetCountdown(NaN, now), "—");
  assert.equal(liveResetCountdown(now, now), "待刷新");
  assert.equal(liveResetCountdown(now - 1, now), "待刷新");
});
test("等级及会员到期单行格式，缺失不替换为授权期限", () => {
  assert.equal(accountLevelLabel("ChatGPT Plus"), "PLUS");
  assert.equal(accountLevelLabel("pro"), "PRO");
  assert.equal(accountLevelLabel(null), "—");
  assert.equal(subscriptionExpiryLabel(new Date(2026, 9, 28).getTime()), "到期10/28");
  assert.equal(subscriptionExpiryLabel(null), "到期—");
  assert.equal(subscriptionExpiryLabel(NaN), "到期—");
});
test("紧凑刷新倒计时不混淆会员到期日期", () => {
  assert.equal(compactResetCountdown(now + 3 * 3600000, now), "3时");
  assert.equal(compactResetCountdown(now + 5 * 86400000, now), "5天");
  assert.equal(compactResetCountdown(null, now), "—");
  assert.equal(compactResetCountdown(now - 1, now), "待刷新");
});
test("侧边栏仅一行厂商、剩余额度、重置倒计时，无账号和默认标签", () => {
  const window = { id: "5h", label: "5小时", pool: "shared" as const, usedPercent: 44, resetAt: now + 3 * 3600000 };
  assert.equal(quotaFooterLabel("codex", [window], now), "Codex 56% · 3小时后刷新");
  assert.equal(quotaFooterLabel("codex", [window], now, true), "Codex 56% · 缓存 · 3小时后刷新");
  assert.equal(quotaFooterLabel("go", [], now), "Go · 未获取");
  assert.equal(quotaFooterLabel("xai", [], now, false, true), "Grok · 读取中…");
});
test("倒计时不伪造已过期或缺失的重置时间", () => {
  assert.equal(resetCountdown(now - 1, now), "待刷新");
  assert.equal(resetCountdown(null, now), "刷新时间未知");
  assert.equal(resetCountdown(NaN, now), "刷新时间未知");
  assert.equal(resetCountdown(now + 20 * 60000, now), "20分钟后刷新");
  assert.equal(resetCountdown(now + 2 * 86400000, now), "2天后刷新");
});
test("Antigravity 双池一行分别显示，不合并额度或重置时间", () => {
  const windows = [
    { id: "g", label: "Gemini", pool: "gemini" as const, usedPercent: 20, resetAt: now + 3600000 },
    { id: "c", label: "Claude", pool: "claude" as const, usedPercent: 65, resetAt: now + 2 * 3600000 },
  ];
  assert.equal(quotaFooterLabel("antigravity", windows, now), "AG G80%/1h C35%/2h");
});
