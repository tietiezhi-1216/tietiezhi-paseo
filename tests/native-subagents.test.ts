import test from "node:test";
import assert from "node:assert/strict";
import { createNativeSubagentDirectory, nativeChildStatus } from "../shared/native-subagents.ts";
import { createPaseoBridge } from "../pi-extensions/paseo-subagents/bridge.ts";
const child = { id: "child", workspaceId: "workspace", title: "review", status: "running", labels: { "paseo.parent-agent-id": "parent" } };
test("native child counts follow labels, rename, completion and archive", () => {
  const d = createNativeSubagentDirectory(); d.upsert(child);
  assert.equal(d.snapshot("parent").length, 1); assert.equal(d.snapshot("peer").length, 0);
  d.upsert({ ...child, title: "renamed", status: "idle", requiresAttention: true, attentionReason: "finished" });
  assert.equal(d.snapshot("parent")[0].title, "renamed"); assert.equal(nativeChildStatus(d.snapshot("parent")[0]), "完成");
  d.upsert({ ...child, archivedAt: new Date().toISOString() }); assert.equal(d.snapshot("parent").length, 0);
});
test("identical native child ids on separate hosts never mix", () => {
  const a = createNativeSubagentDirectory(), b = createNativeSubagentDirectory(); a.upsert(child);
  assert.equal(b.snapshot("parent").length, 0); a.remove("child"); assert.equal(a.snapshot("parent").length, 0);
});
test("CLI bridge creates native child with parent linkage and safely separated prompt", async () => {
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const run: any = async (_file: string, args: string[], options: any) => {
    calls.push({ args, env: options.env });
    const data = args[0] === "run" ? { agentId: "child" }
      : args[1] === "ls" ? []
      : args[2] === "parent" ? { Id: "parent", Provider: "pi", Model: "xai/grok-4.7", Thinking: "medium" }
      : { Id: "child", ParentAgentId: "parent" };
    return { stdout: JSON.stringify(data), stderr: "" };
  };
  const bridge = createPaseoBridge({ PASEO_AGENT_ID: "parent", PASEO_HOME: "/selected/home", PASEO_PASSWORD: "stale", PASEO_HOST: "other-device" }, run);
  const result = await bridge.run({ prompt: "--host other-device", name: "review" }, "/project");
  assert.equal(result.agentId, "child");
  const command = calls.find(call => call.args[0] === "run")!;
  assert.ok(command.args.includes("paseo.parent-agent-id=parent")); assert.ok(command.args.includes("pi/xai/grok-4.7"));
  assert.equal(command.args.at(-1), "--host other-device"); assert.equal(command.args.at(-2), "--");
  assert.equal(command.env.PASEO_HOST, undefined); assert.equal(command.env.PASEO_PASSWORD, undefined);
  assert.equal(command.args[command.args.indexOf("--home") + 1], "/selected/home");
});
test("bridge refuses lifecycle actions on agents not owned by parent", async () => {
  let calls = 0;
  const bridge = createPaseoBridge({ PASEO_AGENT_ID: "parent" }, (async () => { calls++; return { stdout: '{"Id":"child","ParentAgentId":"other-parent"}' }; }) as any);
  await assert.rejects(bridge.stop("child"), /不属于/); assert.equal(calls, 1);
});
test("bridge outside Paseo or canceled never falls back; failures do not leak prompts", async () => {
  const external = createPaseoBridge({}, (async () => { throw new Error("must not execute"); }) as any);
  await assert.rejects(external.list(), /只能在 Paseo/);
  const bridge = createPaseoBridge({ PASEO_AGENT_ID: "parent" }, (async () => { throw new Error("Command failed: secret-prompt"); }) as any);
  await assert.rejects(bridge.run({ prompt: "secret-prompt" }, "/project"), error => { assert.doesNotMatch(String(error), /secret-prompt/); return true; });
});
