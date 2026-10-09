import test from "node:test";
import assert from "node:assert/strict";
import { subagentPillData, SubagentPillSchema } from "../shared/subagents.ts";
const tool = (status: string, details: unknown = {}, input: unknown = { agent: "worker" }) => ({ name: "subagent", status, detail: { type: "unknown", input, output: { details } } });
test("subagent capsule leaves unrelated native tools and unsupported details untouched", () => {
  assert.equal(subagentPillData({ ...tool("running"), name: "bash" }), undefined);
  assert.equal(subagentPillData({ ...tool("running"), name: "subagent_supervisor" }), undefined);
  assert.equal(subagentPillData({ ...tool("running"), detail: { type: "plain_text" } }), undefined);
});
test("foreground progress projects only public child display fields", () => {
  const data = subagentPillData(tool("running", { results: [{ agent: "scout", model: "xai/grok-4.7", secret: "do-not-display", progress: { activityState: "running", currentTool: "read" } }] }))!;
  assert.equal(data.state, "running");
  assert.deepEqual(data.children, [{ name: "scout", model: "xai/grok-4.7", state: "running", tool: "read" }]);
  assert.equal(JSON.stringify(data).includes("do-not-display"), false);
  assert.equal(SubagentPillSchema.safeParse(data).success, true);
});
test("async dispatch success is submitted, not falsely completed", () => {
  const data = subagentPillData(tool("completed", { asyncId: "run-123" }))!;
  assert.equal(data.state, "submitted"); assert.equal(data.runId, "run-123");
  assert.equal(subagentPillData(tool("completed", { runId: "run-123", status: "completed" }))!.state, "done");
});
test("errors, cancellations, workflow and management calls are distinguished", () => {
  assert.equal(subagentPillData({ ...tool("failed"), error: "runner failed" })!.error, "runner failed");
  assert.equal(subagentPillData(tool("canceled"))!.state, "canceled");
  assert.equal(subagentPillData(tool("running", {}, { workflow: true }))!.title, "子代理工作流");
  assert.equal(subagentPillData(tool("completed", {}, { action: "status" }))!.title, "子代理 · status");
});
test("Pi text results are bounded and malformed results cannot crash the transformer", () => {
  const data = subagentPillData({ name: "subagent", status: "completed", detail: { type: "unknown", input: null, output: { content: [{ type: "text", text: "x".repeat(30_000) }], details: { results: [null] } } } })!;
  assert.equal(data.output.length, 20_000);
  assert.equal(data.children[0].state, "状态未知");
});
