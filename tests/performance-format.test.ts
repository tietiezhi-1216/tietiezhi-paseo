import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPerformanceDuration, formatCacheHit, TurnPerformanceSchema } from "../shared/performance.ts";

test("durations use compact h/m/s with correct boundary rounding", () => {
  for (const [ms, expected] of [[0, "0s"], [39000, "39s"], [272000, "4m 32s"], [4080000, "1h 8m"], [3661000, "1h 1m 1s"], [60000, "1m"], [59999, "1m"], [3600000, "1h"]] as const) assert.equal(formatPerformanceDuration(ms), expected);
  assert.equal(formatPerformanceDuration(1200, true), "1.2s");
  assert.equal(formatPerformanceDuration(30, true), "0.03s");
  for (const unknown of [undefined, NaN, Infinity, -1]) assert.equal(formatPerformanceDuration(unknown), "—");
});

test("cache hit uses full raw input/cache counts, handles zero and invalid usage", () => {
  assert.equal(formatCacheHit(3000, 865000), "99.7%");
  assert.equal(formatCacheHit(2000, 3000), "60.0%");
  assert.equal(formatCacheHit(2000, 0), "0.0%");
  assert.equal(formatCacheHit(0, 2000), "100.0%");
  for (const [input, cached] of [[0, 0], [-1, 20], [20, -1], [NaN, 20], [20, Infinity]]) assert.equal(formatCacheHit(input, cached), "—");
});

test("missing TTFT stays unknown and cannot be inferred from response duration", () => {
  const result = TurnPerformanceSchema.parse({ model: "model", provider: "pi", inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 10000, modelDurationMs: 5000, tps: 0.1, timestamp: 1 });
  assert.equal(result.ttftMs, undefined);
  assert.equal(formatPerformanceDuration(result.ttftMs, true), "—");
  assert.equal(TurnPerformanceSchema.parse({ ...result, ttftMs: 0 }).ttftMs, 0);
  assert.equal(TurnPerformanceSchema.safeParse({ ...result, ttftMs: -1 }).success, false);
});
