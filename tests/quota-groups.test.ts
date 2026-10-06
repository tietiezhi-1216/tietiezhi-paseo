import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaGroups } from "../shared/quota-groups.ts";
import { type QuotaWindow } from "../shared/quota.ts";
test("Antigravity 按明确 pool 分组，不按模型名猜池或合并百分比", () => {
  const windows: QuotaWindow[] = [
    { id: "g", label: "Gemini · 本周", pool: "gemini", usedPercent: 20, resetAt: 1000 },
    { id: "c", label: "Claude · 5小时", pool: "claude", usedPercent: 80, resetAt: 2000 },
    { id: "s", label: "未标记周期", pool: "shared", usedPercent: 30, resetAt: null },
  ];
  const groups = quotaGroups(windows);
  assert.deepEqual(groups.map((g) => g.title), ["Gemini", "Claude + GPT", "其他额度"]);
  assert.equal(groups[0].windows[0].title, "本周");
  assert.equal(groups[1].windows[0].title, "5小时");
  assert.equal(groups[2].windows[0].title, "未标记周期");
  assert.equal(groups.flatMap((g) => g.windows).length, windows.length);
  assert.deepEqual(groups.map((g) => g.windows[0].usedPercent), [20, 80, 30]);
});
test("未知周期不伪造 5 小时，多个同池窗口均保留", () => {
  const windows: QuotaWindow[] = [
    { id: "a", label: "Gemini", pool: "gemini", usedPercent: 20, resetAt: 1000 },
    { id: "b", label: "Gemini · 动态额度", pool: "gemini", usedPercent: 80, resetAt: 2000 },
  ];
  const group = quotaGroups(windows)[0];
  assert.equal(group.windows[0].title, "额度");
  assert.equal(group.windows[1].title, "Gemini · 动态额度");
  assert.equal(group.windows.length, 2);
});
