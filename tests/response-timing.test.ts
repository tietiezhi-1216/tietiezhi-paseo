import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResponseTimingCollector } from "../pi-extensions/turn-timing/collector.ts";
import extension, { type TimingExtensionAPI } from "../pi-extensions/turn-timing/index.ts";
import { RESPONSE_TIMING_ENTRY, isResponseTiming, matchResponseTiming, type ResponseTiming } from "../shared/response-timing.ts";
import { PerformanceService } from "../server/performance.ts";

const message = { role: "assistant", timestamp: 1700000001000, provider: "provider", api: "api", model: "model", responseId: "response-1", stopReason: "stop" };
const timing: ResponseTiming = { version: 1, source: "provider-request-to-first-delta", ...message, ttftMs: 1200, firstDelta: "thinking_delta", requestAttempts: 1 };

for (const kind of ["text_delta", "thinking_delta", "toolcall_delta"]) {
  test(`records the first nonempty ${kind}, excludes metadata and later deltas`, () => {
    let clock = 100;
    const c = new ResponseTimingCollector(() => clock);
    c.requestStarted(); // Outside a primary turn: ignored.
    c.beginTurn();
    c.delta(message, { type: kind, delta: "before request" });
    assert.equal(c.finishTurn(), undefined);
    c.beginTurn(); c.requestStarted();
    clock = 300;
    for (const type of ["start", "text_start", "thinking_start", "toolcall_start", "done"]) c.delta(message, { type, delta: "metadata" });
    c.delta({ ...message, role: "toolResult" }, { type: kind, delta: "not assistant" });
    c.delta(message, { type: kind, delta: "" });
    clock = 1300;
    c.delta(message, { type: kind, delta: "first" });
    clock = 4000; c.delta(message, { type: "text_delta", delta: "later" });
    c.endMessage(message);
    const result = c.finishTurn();
    assert.equal(result?.ttftMs, 1200);
    assert.equal(result?.firstDelta, kind);
    assert.ok(isResponseTiming(result));
    assert.equal(c.finishTurn(), undefined, "No duplicate persistence");
    assert.doesNotMatch(JSON.stringify(result), /before request|metadata|first\"|later/);
  });
}

test("provider retry delay is included; wall clock does not affect timing", () => {
  let clock = 50;
  const c = new ResponseTimingCollector(() => clock);
  c.beginTurn(); c.requestStarted(); clock = 550; c.requestStarted();
  clock = 1550; c.delta(message, { type: "text_delta", delta: "ok" }); c.endMessage(message);
  const result = c.finishTurn();
  assert.equal(result?.ttftMs, 1500);
  assert.equal(result?.requestAttempts, 2);
});

for (const stopReason of ["error", "aborted"]) test(`failed ${stopReason} response stays unknown`, () => {
  const c = new ResponseTimingCollector(() => 1);
  c.beginTurn(); c.requestStarted(); c.delta(message, { type: "text_delta", delta: "partial" });
  c.endMessage({ ...message, stopReason }); assert.equal(c.finishTurn(), undefined);
});

test("resets, missing start and response identity mismatch never leak timings", () => {
  const c = new ResponseTimingCollector(() => 1);
  c.beginTurn(); c.delta(message, { type: "text_delta", delta: "ok" }); c.endMessage(message); assert.equal(c.finishTurn(), undefined);
  c.beginTurn(); c.requestStarted(); c.delta(message, { type: "text_delta", delta: "ok" });
  c.endMessage({ ...message, timestamp: message.timestamp + 1 }); assert.equal(c.finishTurn(), undefined);
  c.beginTurn(); c.requestStarted(); c.delta(message, { type: "text_delta", delta: "ok" }); c.reset(); c.endMessage(message); assert.equal(c.finishTurn(), undefined);
  c.beginTurn(); c.requestStarted(); c.endMessage(message); assert.equal(c.finishTurn(), undefined);
});

test("exact matching refuses duplicates, changed identity, malformed timings", () => {
  assert.equal(matchResponseTiming([timing], message), timing);
  assert.equal(matchResponseTiming([timing, timing], message), undefined);
  for (const mismatch of [{ timestamp: message.timestamp + 1 }, { provider: "other" }, { api: "other" }, { model: "other" }, { responseId: "other" }, { responseId: undefined }]) assert.equal(matchResponseTiming([timing], { ...message, ...mismatch }), undefined);
  for (const invalid of [{ ttftMs: -1 }, { ttftMs: NaN }, { ttftMs: "1" }, { version: 2 }, { firstDelta: "start" }, { requestAttempts: 0 }]) assert.equal(isResponseTiming({ ...timing, ...invalid }), false);
});

test("extension writes metadata once at turn_end and clears session transitions", () => {
  const handlers = new Map<string, Function[]>(); const entries: unknown[] = [];
  extension({ on: (event: string, handler: Function) => { handlers.set(event, [...handlers.get(event) ?? [], handler]); }, appendEntry: (kind: string, data: unknown) => { entries.push({ kind, data }); } } as TimingExtensionAPI);
  const emit = (type: string, fields = {}) => { for (const handler of handlers.get(type) ?? []) handler({ type, ...fields }); };
  const output = () => {
    emit("turn_start"); emit("before_provider_request");
    emit("message_update", { message, assistantMessageEvent: { type: "text_delta", delta: "SECRET OUTPUT" } });
    emit("message_end", { message });
  };
  output(); assert.equal(entries.length, 0); emit("turn_end"); emit("turn_end");
  assert.equal(entries.length, 1); assert.doesNotMatch(JSON.stringify(entries), /SECRET OUTPUT/);
  for (const event of ["session_start", "session_switch", "session_fork", "session_shutdown", "agent_end"]) {
    output(); emit(event); emit("turn_end"); assert.equal(entries.length, 1);
  }
});

for (const mode of ["first", "later-only", "duplicate", "mismatch", "invalid", "failed"]) {
  test(`native JSONL -> persisted footer TTFT: ${mode}`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "ttft-integration-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const nativeHandle = join(dir, "session.jsonl"); const store = join(dir, "performance.json");
    const a = (m: typeof message, at: string) => ({ type: "message", timestamp: at, message: { ...m, durationMs: 2000, usage: { input: 20, output: 100, cacheRead: 40 }, content: [{ type: "text", text: "Reply" }] } });
    const metadata = (data: unknown) => ({ type: "custom", customType: RESPONSE_TIMING_ENTRY, data });
    const first = mode === "failed" ? { ...message, stopReason: "error" } : message;
    const later = { ...message, timestamp: message.timestamp + 5000, responseId: "response-2" };
    const data = mode === "mismatch" ? { ...timing, responseId: "wrong" } : mode === "invalid" ? { ...timing, ttftMs: -5 } : timing;
    const rows = [{ type: "message", timestamp: "2023-11-14T22:13:20.000Z", message: { role: "user" } }, a(first, "2023-11-14T22:13:22.000Z"),
      ...(mode === "later-only" ? [] : [metadata(data)]), ...(mode === "duplicate" ? [metadata(timing)] : []),
      a(later, "2023-11-14T22:13:27.000Z"), metadata({ ...timing, ...later, ttftMs: 50 })];
    writeFileSync(nativeHandle, rows.map(r => JSON.stringify(r)).join("\n"));
    const service = new PerformanceService(store);
    let now = 1_700_000_000_000;
    t.mock.method(Date, "now", () => now);
    service.onTurnStarted({ agent: { id: "agent" } } as any);
    now += 7000;
    const result = await service.onTurnEnded({ agent: { id: "agent", provider: "pi" }, timeline: [] } as any, { paseo: { agents: { ref: () => ({ refresh: async () => ({ agent: { persistence: { nativeHandle } } }) }) } } } as any);
    assert.ok(result); assert.equal(result.outputTokens, 200);
    assert.equal(result.ttftMs, mode === "first" ? 1200 : undefined);
    assert.equal(new PerformanceService(store).getAgentTurns("agent").records[0].ttftMs, result.ttftMs);
  });
}
