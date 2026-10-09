import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceService } from "../server/performance.ts";

const epoch = 1_700_000_000_000;
const stamp = (ms: number) => new Date(epoch + ms).toISOString();
const user = { type: "message", timestamp: stamp(-10_000), message: { role: "user" } };
const response = (ms: number, output = 100, extra = {}) => ({ type: "message", timestamp: stamp(ms), message: {
  role: "assistant", durationMs: 1000, usage: { input: 10, output, cacheRead: 20 }, text: "Reply", ...extra,
} });
const cases = [
  { name: "continuation excludes responses before live turn", rows: [user, response(-5000, 90000), response(2000)], output: 100, tps: 100 },
  { name: "steering does not erase earlier responses", rows: [user, response(1000), { ...user, timestamp: stamp(1500) }, response(2000, 300)], output: 400, tps: 200 },
  { name: "deduplicates response ID", rows: [user, response(1000, 100, { responseId: "r" }), response(2000, 100, { responseId: "r" })], output: 100, tps: 100 },
  { name: "deduplicates entry ID", rows: [user, { ...response(1000), id: "r" }, { ...response(2000), id: "r" }], output: 100, tps: 100 },
  { name: "active ancestry excludes abandoned sibling", rows: [
    { ...user, id: "u", parentId: null },
    { ...response(1000, 90000), id: "abandoned", parentId: "u" },
    { ...response(2000), id: "active", parentId: "u" },
  ], output: 100, tps: 100 },
  { name: "broken ancestry is unknown", rows: [{ ...response(2000), id: "r", parentId: "missing" }] },
  { name: "cycle is unknown", rows: [{ ...response(2000), id: "r", parentId: "r" }] },
  { name: "conflicting response ID is unknown", rows: [user, response(1000, 100, { responseId: "r" }), response(2000, 200, { responseId: "r" })] },
  { name: "mismatched native reply is unknown", rows: [user, response(2000, 100, { text: "Different reply" })] },
  { name: "pre-turn request is excluded even if persisted later", rows: [user, response(1000, 90000, { timestamp: epoch - 1000 }), response(2000)], output: 100, tps: 100 },
  { name: "missing usage invalidates entire sum", rows: [user, response(1000), response(2000, 100, { usage: undefined })] },
  { name: "string token count is invalid", rows: [user, response(2000, 100, { usage: { output: "100" } })] },
  { name: "negative token count is invalid", rows: [user, response(2000, -100)] },
  { name: "later turn cannot be attached", rows: [user, response(2000), response(9000)] },
  { name: "failed response hides model speed", rows: [user, response(2000, 100, { stopReason: "error" })], output: 100 },
  { name: "missing response timing hides model speed", rows: [user, response(2000, 100, { durationMs: undefined })], output: 100 },
  { name: "short durations are not clamped", rows: [user, response(100, 100, { durationMs: 100 })], output: 100, tps: 1000 },
];
for (const c of cases) test(c.name, async t => {
  const dir = mkdtempSync(join(tmpdir(), "tps-attribution-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nativeHandle = join(dir, "session.jsonl");
  writeFileSync(nativeHandle, c.rows.map(row => JSON.stringify(row)).join("\n"));
  let now = epoch;
  t.mock.method(Date, "now", () => now);
  const service = new PerformanceService(join(dir, "records.json"));
  service.onTurnStarted({ agent: { id: "a" }, turnId: "turn" } as any);
  now += c.name.startsWith("short") ? 100 : 4000;
  const event = { agent: { id: "a", provider: "pi" }, turnId: "turn", timeline: [{ type: "assistant_message", text: "Reply", messageId: "reply" }] } as any;
  const context = { paseo: { agents: { ref: () => ({ refresh: async () => ({ agent: { persistence: { nativeHandle } } }) }) } } } as any;
  const result = await service.onTurnEnded(event, context);
  if (c.output === undefined) assert.equal(result, null);
  else {
    assert.equal(result?.outputTokens, c.output);
    assert.equal(result?.modelTps, c.tps);
    assert.equal(await service.onTurnEnded(event, context), null, "replayed hook is ignored");
    assert.equal(service.getAgentTurns("a").records.length, 1);
  }
});

for (const started of [true, false]) test(`no guessed lastUsage fallback (started=${started})`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "tps-unknown-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const service = new PerformanceService(join(dir, "records.json"));
  const event = { agent: { id: "a" }, turnId: "turn", timeline: [] } as any;
  if (started) service.onTurnStarted(event);
  const context = { paseo: { agents: { ref: () => ({ refresh: async () => ({ agent: { lastUsage: { inputTokens: 100, outputTokens: 500 } } }) }) } } } as any;
  assert.equal(await service.onTurnEnded(event, context), null);
  assert.equal(service.getAgentTurns("a").records.length, 0);
});
