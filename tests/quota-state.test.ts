import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaPresentation, quotaHostCacheKey, QUOTA_FRESHNESS_MS } from "../shared/quota-state.ts";
import type { AccountQuota } from "../shared/quota.ts";

const now = 1_790_000_000_000;
const quota = (patch: Partial<AccountQuota> = {}): AccountQuota => ({
  accountId: "A", plan: null, fetchedAt: now, checkedAt: now, stale: false, error: null,
  windows: [{ id: "billing", label: "账期", pool: "shared", usedPercent: 52, resetAt: now + 86400000 }], ...patch,
});

test("过期周期隐藏旧比例，不把日期增加七天或猜成100%", () => {
  const q = quota({ windows: [{ id: "billing", label: "账期", pool: "shared", usedPercent: 52, resetAt: now - 1 }] });
  const state = quotaPresentation(q, now);
  assert.equal(state.kind, "expired"); assert.deepEqual(state.windows, []);
  assert.equal(q.windows[0].resetAt, now - 1); assert.equal(q.windows[0].usedPercent, 52);
});
test("网络/额度认证错误隐藏旧比例，不暗示聊天授权也已失效", () => {
  for (const error of ["额度查询失败或网络超时；保留上次结果", "授权已失效，请在 Pi 续期或重新登录"]) {
    const state = quotaPresentation(quota({ error, stale: true }), now);
    assert.equal(state.kind, "error"); assert.deepEqual(state.windows, []);
    assert.match(state.detail, /上次获取/); assert.doesNotMatch(state.label, /需登录/);
  }
});
test("提供账期但未提供比例时明确 unavailable，不读回历史百分比", () => {
  const state = quotaPresentation(quota({ error: "接口未提供可计算的额度百分比" }), now);
  assert.equal(state.kind, "unavailable"); assert.deepEqual(state.windows, []);
});
test("缓存有真实时间戳才展示并标记，checkedAt不能冒充fetchedAt", () => {
  assert.equal(quotaPresentation(quota(), now).kind, "fresh");
  const state = quotaPresentation(quota({ checkedAt: now, fetchedAt: now - QUOTA_FRESHNESS_MS - 1 }), now);
  assert.equal(state.kind, "cached"); assert.match(state.detail, /缓存/); assert.equal(state.windows[0].usedPercent, 52);
  assert.deepEqual(quotaPresentation(quota({ fetchedAt: null }), now).windows, []);
  assert.equal(quotaPresentation(quota({ stale: true }), now).kind, "cached");
});
test("只过滤过期窗口，不丢弃另一池尚有效的官方数据", () => {
  const q = quota(); q.windows.push({ ...q.windows[0], id: "expired", resetAt: now - 1, pool: "claude" });
  assert.equal(quotaPresentation(q, now).windows.length, 1);
});
test("Host与账号均参与缓存标识，相同账号不跨Host污染", () => {
  assert.notEqual(quotaHostCacheKey("macmini", "A"), quotaHostCacheKey("macbook", "A"));
  assert.notEqual(quotaHostCacheKey("a:b", "c"), quotaHostCacheKey("a", "b:c"));
});
