import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PaseoApi, PaseoAgentTimelineEvent } from "@getpaseo/client";
import { ThinkingTimelineService, turnThoughts } from "../server/thinking.ts";
import { boundedThinking, thinkingPreview, TurnThinkingSchema, type TurnThinkingData } from "../shared/thinking.ts";

const agent = { id: "a", workspaceId: "ws", parentAgentId: null, provider: "pi", cwd: "/workspace", title: "Agent" };
const thought = (seq: number, text: string, turnId = "turn-1") => ({ seqStart: seq, seqEnd: seq, turnId, timestamp: new Date().toISOString(), item: { type: "reasoning", text } });
const page = (entries: any[]) => ({ epoch: "epoch", entries, hasOlder: false, error: null, agent: { status: "running" } });
function fixture() {
  const state = { page: page([]), reads: 0, stops: 0, subscribes: 0, writes: [] as any[], handler: undefined as ((message: PaseoAgentTimelineEvent) => void) | undefined, pending: undefined as Promise<any> | undefined };
  const paseo = { agents: { ref: () => ({
    refresh: async () => ({ agent: { ...agent, status: "running", activeTurn: { turnId: "turn-1", startedAt: new Date().toISOString() } } }),
    timeline: {
      subscribe(handler: (message: PaseoAgentTimelineEvent) => void) {
        state.subscribes++; state.handler = handler;
        const release = async () => { state.stops++; };
        return Object.assign(() => { void release(); }, { ready: Promise.resolve(), release });
      },
      refetch: async () => { state.reads++; return state.pending ?? state.page; },
      append: async (item: any) => { state.writes.push(item); return { epoch: "epoch", seq: 100 + state.writes.length }; },
    },
  }) } } as unknown as PaseoApi;
  const service = new ThinkingTimelineService(0);
  const emit = (event: object, id = "a") => state.handler?.({ agentId: id, timestamp: new Date().toISOString(), epoch: "epoch", event } as PaseoAgentTimelineEvent);
  return { service, state, paseo, emit };
}
async function until(predicate: () => boolean) {
  for (let index = 0; index < 100; index++) { if (predicate()) return; await delay(2); }
  assert.ok(predicate(), "thinking timeline did not settle");
}

test("thinking preview is actual source text and serialized previews respect the 64 KiB host limit", () => {
  const data: TurnThinkingData = { turnId: "turn", phase: "active", activity: "thinking", truncated: false,
    records: Array.from({ length: 30 }, (_, index) => ({ id: String(index), text: "# 标题\n" + "😀\u0000中文\\\"".repeat(10000) })) };
  const bounded = boundedThinking(data);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 48 * 1024);
  assert.equal(bounded.truncated, true);
  assert.equal(thinkingPreview(bounded), "标题");
  assert.equal(TurnThinkingSchema.safeParse(bounded).success, true);
  assert.equal(TurnThinkingSchema.safeParse({ ...bounded, records: [] }).success, false);
});
test("projected fragments are grouped per turn, skipping own updates but not tools/prose", () => {
  const entries = [thought(1, "Old turn", "old"), thought(2, "First "),
    { seqStart: 3, seqEnd: 3, timestamp: new Date().toISOString(), item: { type: "plugin", kind: "turn-thinking", pluginId: "tietiezhi" } },
    thought(4, "thought"), { ...thought(5, ""), item: { type: "assistant_message", text: "Visible prose" } }, thought(6, "Second thought")];
  assert.deepEqual(turnThoughts(page(entries) as any, "turn-1", 0).map(record => record.text), ["First thought", "Second thought"]);
});
test("all reasoning updates replace one row id, not one row per thought; finish releases observation", async () => {
  const f = fixture(); f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.reads === 1);
  assert.equal(f.state.writes.length, 0, "models without thoughts must not get a fake or empty thought row");
  assert.equal(f.state.subscribes, 1);
  f.state.page = page([thought(1, "Inspect source")]);
  for (let index = 0; index < 50; index++) f.emit({ type: "timeline", provider: "pi", turnId: "turn-1", item: { type: "reasoning", text: "fragment" } });
  await until(() => f.state.writes.length > 0);
  f.state.page = page([thought(1, "Inspect source"), { ...thought(2, ""), item: { type: "tool_call" } }, thought(3, "Testing files")]);
  f.emit({ type: "timeline", provider: "pi", turnId: "turn-1", item: { type: "reasoning", text: "fragment" } });
  await until(() => f.state.writes.at(-1).data.records.length === 2);
  assert.equal(new Set(f.state.writes.map(item => item.id)).size, 1);
  assert.equal(f.state.writes.at(-1).data.records[1].text, "Testing files");
  assert.ok(f.state.reads < 6, "token events are throttled, not one RPC each");
  await f.service.finish({ agent, turnId: "turn-1", outcome: { kind: "completed" }, timeline: [] });
  assert.equal(f.state.writes.at(-1).data.phase, "complete");
  assert.equal(f.state.writes.at(-1).data.activity, "idle");
  assert.equal(f.state.stops, 1);
  f.service.dispose();
});
test("no thought history from other agents/turns leaks into the summary", async () => {
  const f = fixture(); f.state.page = page([thought(1, "Older turn", "old")]);
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.reads === 1);
  f.emit({ type: "timeline", provider: "pi", turnId: "turn-1", item: { type: "reasoning", text: "Other agent" } }, "b");
  await delay(5);
  assert.equal(f.state.writes.length, 0);
  await f.service.finish({ agent, turnId: "turn-1", outcome: { kind: "completed" }, timeline: [] });
  assert.equal(f.state.writes.length, 0);
  f.service.dispose();
});
test("reload initialization verifies the active turn and is idempotent", async () => {
  const f = fixture(); f.state.page = page([thought(1, "Existing live thinking")]);
  assert.deepEqual(await f.service.initialize("a", f.paseo), { attached: true });
  assert.deepEqual(await f.service.initialize("a", f.paseo), { attached: true });
  await until(() => f.state.writes.length > 0);
  assert.equal(f.state.subscribes, 1);
  assert.equal(f.state.writes[0].data.activity, "thinking");
  f.service.dispose();
});
test("replacement discards stale in-flight history before publishing the new epoch", async () => {
  const f = fixture(); let resolve!: (value: any) => void;
  f.state.pending = new Promise(done => { resolve = done; });
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.reads === 1);
  f.emit({ type: "replacement", epoch: "new-epoch" });
  f.state.pending = undefined; f.state.page = { ...page([thought(1, "New canonical history")]), epoch: "new-epoch" };
  resolve(page([thought(1, "Obsolete history")]));
  await until(() => f.state.writes.length > 0);
  assert.ok(f.state.writes.every(item => item.data.records.every((record: any) => record.text !== "Obsolete history")));
  f.service.dispose();
});
test("closing an agent saves a static last-known thought even when the final read fails", async () => {
  const f = fixture(); f.state.page = page([thought(1, "Actual thought")]);
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.writes.length > 0);
  f.state.page = { ...page([]), error: "transport failed" } as any;
  await f.service.stopAgent("a");
  assert.equal(f.state.writes.at(-1).data.phase, "complete");
  assert.equal(f.state.writes.at(-1).data.records[0].text, "Actual thought");
  assert.equal(f.state.stops, 1);
  f.service.dispose();
});
test("late reads cannot append rows after cleanup", async () => {
  const f = fixture(); let resolve!: (value: any) => void;
  f.state.pending = new Promise(done => { resolve = done; });
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.reads === 1);
  f.service.dispose(); resolve(page([thought(1, "Late thought")])); await delay(5);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.stops, 1);
});
test("finishing waits out an in-flight preview then publishes the final canonical snapshot", async () => {
  const f = fixture(); let resolve!: (value: any) => void;
  f.state.pending = new Promise(done => { resolve = done; });
  f.service.start({ agent, turnId: "turn-1" }, { paseo: f.paseo });
  await until(() => f.state.reads === 1);
  const finishing = f.service.finish({ agent, turnId: "turn-1", outcome: { kind: "completed" }, timeline: [] });
  f.state.pending = undefined; f.state.page = page([thought(1, "Final canonical thinking")]);
  resolve(page([thought(1, "Earlier preview")])); await finishing;
  assert.equal(f.state.writes.at(-1).data.records[0].text, "Final canonical thinking");
  assert.equal(f.state.writes.at(-1).data.phase, "complete");
  assert.equal(new Set(f.state.writes.map(item => item.id)).size, 1);
  f.service.dispose();
});
