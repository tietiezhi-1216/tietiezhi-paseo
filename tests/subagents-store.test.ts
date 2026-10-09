import test from "node:test";
import assert from "node:assert/strict";
import { createSubagentsStore } from "../client/subagents-store.ts";
const item = (status = "running") => ({ type: "tool_call", callId: "call-1", name: "subagent", status, detail: { type: "unknown", input: { agent: "worker" }, output: { details: {} } }, error: null });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let handler: any, reads = 0, released = 0, resolve: any;
  const timeline = {
    subscribe(fn: any) { handler = fn; const stop: any = () => { released++; }; stop.ready = Promise.resolve(); return stop; },
    refetch() { reads++; return new Promise<any>(done => { resolve = done; }); },
  };
  return { store: createSubagentsStore(timeline), emit: (event: any) => handler({ agentId: "agent", event }), complete: (entries: any[]) => resolve({ entries }), stats: () => ({ reads, released }) };
}
test("composer shares observer, live completion wins stale snapshot, and releases on last unmount", async () => {
  const f = fixture(), one = f.store.retain(), two = f.store.retain(); await flush();
  f.emit({ type: "timeline", item: item("completed") });
  f.complete([{ item: item("running") }]); await flush();
  assert.equal(f.store.getSnapshot().entries[0].data.state, "done");
  assert.equal(f.stats().reads, 1); one(); assert.equal(f.stats().released, 0); two(); assert.equal(f.stats().released, 1);
});
test("host-scoped stores do not mix identical call ids", async () => {
  const a = fixture(), b = fixture(), stopA = a.store.retain(), stopB = b.store.retain(); await flush();
  a.emit({ type: "timeline", item: item() });
  assert.equal(a.store.getSnapshot().entries.length, 1); assert.equal(b.store.getSnapshot().entries.length, 0);
  stopA(); stopB();
});
test("late snapshot after stop cannot repopulate composer", async () => {
  const f = fixture(), stop = f.store.retain(); await flush(); stop();
  f.complete([{ item: item() }]); await flush(); assert.equal(f.store.getSnapshot().entries.length, 0);
});
test("replacement clears old records, refetches and displays subscription errors", async () => {
  const f = fixture(), stop = f.store.retain(); await flush(); f.emit({ type: "timeline", item: item() });
  f.emit({ type: "replacement", epoch: "new" }); assert.equal(f.store.getSnapshot().entries.length, 0); assert.equal(f.stats().reads, 2);
  f.emit({ type: "error", error: "offline" }); assert.match(f.store.getSnapshot().error!, /订阅中断/); stop();
});
