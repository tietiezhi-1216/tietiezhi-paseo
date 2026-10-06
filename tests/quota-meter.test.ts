import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaMeterAppearance, quotaRingPoint } from "../shared/quota-meter.ts";

test("剩余额度使用绿黄橙红阶梯颜色，填充比例与剩余数字一致", () => {
  for (const [remaining, color] of [[100, "#6bb7a4"], [50, "#6bb7a4"], [49, "#d3aa64"], [30, "#d3aa64"], [29, "#d99868"], [10, "#d99868"], [9, "#df8580"], [0, "#df8580"]] as const) {
    assert.deepEqual(quotaMeterAppearance(100 - remaining), { amount: remaining, color });
  }
});
test("未知额度不伪造 0%，输入越界有界处理", () => {
  assert.equal(quotaMeterAppearance(null).amount, null);
  assert.equal(quotaMeterAppearance(NaN).amount, null);
  assert.equal(quotaMeterAppearance(-10).amount, 100);
  assert.equal(quotaMeterAppearance(200).amount, 0);
});
test("原生圆环起点在顶部，顺时针经过右侧和底部", () => {
  const top = quotaRingPoint(0, 90, 20, 2);
  assert.deepEqual(top, { left: 9, top: 0 });
  const right = quotaRingPoint(1, 4, 20, 2);
  assert.ok(Math.abs(right.left - 18) < 0.00001 && Math.abs(right.top - 9) < 0.00001);
  const bottom = quotaRingPoint(2, 4, 20, 2);
  assert.ok(Math.abs(bottom.left - 9) < 0.00001 && Math.abs(bottom.top - 18) < 0.00001);
});
