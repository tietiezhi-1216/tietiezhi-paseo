import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceService } from "../server/performance.ts";
import { TurnPerformanceSchema } from "../shared/performance.ts";

for (const timings of [[1000, 3000], [1000, undefined], [1000, 0], [1000, -1], [1000, "3000"]]) {
  test(`whole-turn response TPS requires complete native timings: ${JSON.stringify(timings)}`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "response-tps-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "session.jsonl");
    const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1000).toISOString();
    const assistant = (seconds: number, output: number, durationMs: unknown) => ({ type: "message", timestamp: at(seconds), message: { role: "assistant", durationMs, usage: { input: 100, output, cacheRead: 200, reasoning: 20 }, content: [{ type: "text", text: "Reply" }] } });
    writeFileSync(file, [
      { type: "message", timestamp: at(-5), message: { role: "assistant", usage: { output: 90000 } } },
      { type: "message", timestamp: at(0), message: { role: "user" } },
      assistant(1, 100, timings[0]),
      { type: "message", timestamp: at(7), message: { role: "toolResult", durationMs: 6000 } },
      assistant(10, 900, timings[1]),
    ].map(row => JSON.stringify(row)).join("\n"));
    const service = new PerformanceService(join(dir, "records.json"));
    let now = 1_700_000_000_000;
    t.mock.method(Date, "now", () => now);
    service.onTurnStarted({ agent: { id: "test" } } as any);
    now += 10_000;
    const result = await service.onTurnEnded({ agent: { id: "test", provider: "pi" }, timeline: [{ type: "assistant_message", messageId: "final", text: "Reply" }] } as any, {
      paseo: { agents: { ref: () => ({ refresh: async () => ({ agent: { persistence: { nativeHandle: file } } }) }) } },
    } as any);
    assert.ok(result);
    assert.equal(result.outputTokens, 1000);
    assert.equal(result.reasoningTokens, 40); // Already included in output, not added again.
    assert.equal(result.durationMs, 10000);
    assert.equal(result.tps, 100);
    assert.equal(result.modelDurationMs, timings[1] === 3000 ? 4000 : undefined);
    assert.equal(result.modelTps, timings[1] === 3000 ? 250 : undefined);
    assert.deepEqual(TurnPerformanceSchema.parse(service.getAgentTurns("test").records[0]), service.getAgentTurns("test").records[0]);
    assert.equal(new PerformanceService(join(dir, "records.json")).getAgentTurns("test").records[0].modelTps, result.modelTps);
    assert.equal(service.getOverview().overallAvgTps, 100, "Do not mix old turn TPS and response TPS in overview");
  });
}

test("legacy records remain valid without invented response timings", () => {
  const old = TurnPerformanceSchema.parse({ model: "old", provider: "pi", inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 1000, tps: 1, timestamp: 1 });
  assert.equal(old.modelTps, undefined);
  assert.equal(old.modelDurationMs, undefined);
});
