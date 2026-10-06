import { test } from "node:test";
import assert from "node:assert/strict";
import { compactTime, quotaFailureLabel } from "../shared/ui-format.ts";

test("界面时间仅显示月日时分，缺失/无效时间不伪造", () => {
  assert.equal(compactTime(new Date(2026, 9, 4, 8, 5).getTime()), "10/04 08:05");
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(compactTime(value), "—");
});
test("额度错误保持可见短标签，不把完整诊断变成常驻说明", () => {
  assert.equal(quotaFailureLabel("授权已失效，请在 Pi 续期或重新登录"), "需登录");
  assert.equal(quotaFailureLabel("额度接口 HTTP 429"), "稍后重试");
  assert.equal(quotaFailureLabel("额度接口 HTTP 403"), "无权查询");
  assert.equal(quotaFailureLabel("此授权类型不支持额度查询"), "不支持额度");
  assert.equal(quotaFailureLabel("额度查询失败或网络超时；保留上次结果"), "查询失败");
  assert.equal(quotaFailureLabel(null), "");
});
