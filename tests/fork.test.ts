import { test } from "node:test";
import assert from "node:assert/strict";
import { forkReply } from "../shared/fork.ts";
import { resolveForkBoundary, createReplyFork } from "../server/fork.ts";

const input = { agentId: "source", serverId: "host", recordId: "record", replyAt: 1000, target: "tab" as const, prompt: "继续", operationId: "00000000-0000-4000-8000-000000000001" };
const record = { model: "model", provider: "pi", content: "selected reply", messageId: "reply", inputTokens: 1, outputTokens: 2, cachedTokens: 0, durationMs: 1000, tps: 2, timestamp: 2000 };
const entry = { item: { type: "assistant_message", text: "selected reply", messageId: "reply" }, timestamp: new Date(1000).toISOString(), seqEnd: 12 };

function fixture() {
  const calls: any[] = [];
  const daemon = {
    close: async () => { calls.push(["close"]); },
    fetchAgent: async () => ({ agent: { provider: "pi", model: "model", cwd: "/repo", workspaceId: "original", title: "Source", features: [], thinkingOptionId: "high" } }),
    fetchAgentTimeline: async () => ({ epoch: "epoch", entries: [entry, { ...entry, item: { ...entry.item, text: "later reply", messageId: "later" }, seqEnd: 50 }], hasOlder: false, staleCursor: false, gap: false }),
    buildAgentForkContext: async (...args: any[]) => { calls.push(["context", ...args]); return { attachment: { type: "text", mimeType: "text/plain", text: "native context at seq 12" }, error: null }; },
  };
  const make = (id: string) => ({ id, agents: { create: async (options: any) => { calls.push(["create", id, options]); return { id: "new-agent" }; } } });
  const paseo = { workspaces: { ref: (id: string) => make(id), create: async (options: any) => { calls.push(["workspace", options]); return make("new-workspace"); } } };
  return { calls, daemon, paseo, connect: async (id: string) => { assert.equal(id, "host"); return daemon; } };
}

test("fork preserves exact reply boundary and native attachment, not later messages", async () => {
  const f = fixture();
  const result = await createReplyFork(input, record, f.paseo as any, f.connect as any);
  assert.deepEqual(result, { agentId: "new-agent", workspaceId: "original", serverId: "host" });
  assert.deepEqual(f.calls[0], ["context", "source", { boundaryCursor: { epoch: "epoch", seq: 12 } }]);
  assert.equal(f.calls[1][2].attachments[0].text, "native context at seq 12");
  assert.equal(f.calls[1][2].config.provider, "pi/model");
  assert.equal(f.calls[1][2].config.thinkingOptionId, "high");
  assert.equal(f.calls[1][2].prompt, "继续");
  assert.equal(f.calls[1][2].idempotencyKey, input.operationId);
  assert.equal(f.calls.some(call => call[0] === "workspace"), false);
  assert.equal(f.calls.at(-1)[0], "close");
});
test("fork workspace uses branch-off worktree and creates the agent there", async () => {
  const f = fixture();
  await createReplyFork({ ...input, target: "workspace" }, record, f.paseo as any, f.connect as any);
  assert.deepEqual(f.calls[1][1].source, { kind: "worktree", cwd: "/repo", action: "branch-off" });
  assert.equal(f.calls[2][1], "new-workspace");
});
test("ambiguous or stale history cannot fork; failure closes connection and creates nothing", async () => {
  const f = fixture();
  f.daemon.fetchAgentTimeline = async () => ({ epoch: "epoch", entries: [entry, entry], hasOlder: false, staleCursor: false, gap: false });
  await assert.rejects(createReplyFork(input, record, f.paseo as any, f.connect as any), /不唯一/);
  assert.deepEqual(f.calls, [["close"]]);
  f.daemon.fetchAgentTimeline = async () => ({ epoch: "epoch", entries: [], hasOlder: false, staleCursor: true, gap: false });
  await assert.rejects(resolveForkBoundary(f.daemon as any, "source", record, 1000), /边界已改变/);
});
test("message without id uses both text and exact timestamp", async () => {
  const f = fixture();
  await assert.rejects(resolveForkBoundary(f.daemon as any, "source", { ...record, messageId: undefined }, 999), /未找到/);
  const boundary = await resolveForkBoundary(f.daemon as any, "source", { ...record, messageId: undefined }, 1000);
  assert.equal(boundary.boundaryCursor.seq, 12);
});
test("invalid request and missing record are rejected before side effects", async () => {
  const f = fixture();
  await assert.rejects(createReplyFork(input, undefined, f.paseo as any, f.connect as any), /缺少/);
  assert.deepEqual(f.calls, []);
});
