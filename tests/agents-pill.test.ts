import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsPillState, formatAgentsPillLabel } from "../shared/agents-pill.ts";
import type { RemoteAgent } from "../shared/agents.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

function agent(id: string, extra: Partial<RemoteAgent> = {}): RemoteAgent {
  return {
    id, hostId: "local", hostName: "Local", serverId: "local", name: id,
    status: "idle", requiresAttention: false, attentionReason: null,
    createdAt: null, updatedAt: null, lastUserMessageAt: null,
    workspaceId: "workspace", workspace: "workspace", archivedAt: null, parentAgentId: null,
    ...extra,
  };
}
const done = (id: string) => agent(id, { requiresAttention: true, attentionReason: "finished" });
const working = (id: string) => agent(id, { status: "running" });
const error = (id: string) => agent(id, { status: "error" });

test("胶囊恢复当前 Agent 名，状态数量保持汇总值，长名称不会挤掉状态", () => {
  assert.equal(formatAgentsPillLabel("插件开发", { label: "working · 6" }), "插件开发 · working · 6");
  assert.equal(formatAgentsPillLabel("插件开发", { label: "done · 1" }), "插件开发 · done · 1");
  assert.equal(formatAgentsPillLabel("  当前项目启动一下给我看看  ", { label: "done · 2" }), "当前项目启动… · done · 2");
  assert.equal(formatAgentsPillLabel("abcdefghijklmnop", { label: "idle · 3" }), "abcdefghijkl… · idle · 3");
  assert.equal(formatAgentsPillLabel("", { label: "loading" }), "loading");
});

test("Agents 胶囊有 done 时优先展示完成数量与绿色，即使存在 working 和 error", () => {
  const rows = [working("w1"), done("d1"), error("e1"), working("w2"), done("d2"), agent("idle")];
  assert.deepEqual(agentsPillState(rows, false, false), { label: "done · 2", colorKind: "success" });
  assert.deepEqual(agentsPillState([...rows].reverse(), false, false), { label: "done · 2", colorKind: "success" });
});

test("Agents 胶囊 done 消失后恢复 error，再恢复 working，不保留旧的完成数量", () => {
  assert.equal(agentsPillState([done("d"), error("e"), working("w")], false, false).label, "done · 1");
  assert.deepEqual(agentsPillState([error("e"), working("w")], false, false), { label: "error · 1", colorKind: "failure" });
  assert.deepEqual(agentsPillState([working("w1"), working("w2"), agent("idle")], false, false), { label: "working · 2", colorKind: "running" });
  assert.deepEqual(agentsPillState([agent("idle")], false, false), { label: "idle · 1", colorKind: "unknown" });
  assert.equal(agentsPillState([agent("closed", { status: "closed" })], false, false).label, "closed · 1");
});

test("归档的 done 和带旧 finished 标记的运行任务不抢占 done 胶囊", () => {
  const rows = [
    agent("archived", { attentionReason: "finished", archivedAt: "2026-10-09T00:00:00Z" }),
    agent("running", { status: "running", attentionReason: "finished" }),
    agent("initializing", { status: "initializing", attentionReason: "finished" }),
  ];
  assert.deepEqual(agentsPillState(rows, false, false), { label: "working · 2", colorKind: "running" });
});

test("加载和离线状态不被完成缓存掩盖", () => {
  assert.deepEqual(agentsPillState(undefined, true, false), { label: "loading", colorKind: "unknown" });
  assert.deepEqual(agentsPillState([done("cached")], false, true), { label: "offline", colorKind: "failure" });
  assert.deepEqual(agentsPillState([], false, false), { label: "idle · 0", colorKind: "unknown" });
  assert.deepEqual(agentsPillState([], true, false), { label: "loading", colorKind: "unknown" });
  assert.equal(agentsPillState([agent("archived", { archivedAt: "2026-10-09" })], false, false).label, "idle · 0");
});

test("Composer Pill 注册不再独立查询或猜测 working，等待同源图标快照驱动文字", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-pill-priority-"));
  let stop: (() => void) | undefined;
  try {
    const outfile = join(temporary, "pill.cjs");
    await build({
      entryPoints: [resolve("client/agents-pill.tsx")], outfile,
      bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      alias: { "react-native": "react-native-web" },
      plugins: [{ name: "preview-sdk", setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/react-native)?$/ }, () => ({ path: resolve("tests/browser/sdk.jsx") }));
      } }],
    });
    const { contributeAgentsPills } = createRequire(import.meta.url)(outfile);
    const labels: string[] = [];
    const registered: string[] = [];
    let directRpcCalls = 0;
    let onUpdate: (update: unknown) => void = () => {};
    stop = contributeAgentsPills({
      rpc: async () => { directRpcCalls++; return { agents: [working("stale")], hosts: [] }; },
      paseo: { agents: {
        subscribe: (handler: (update: unknown) => void) => { onUpdate = handler; return () => {}; },
        list: async () => ({ entries: [{ agent: { ...agent("current"), title: "当前会话" } }], pageInfo: { hasMore: false } }),
      } },
      addComposerPill: (input: { button: { label: string } }) => {
        registered.push(input.button.label);
        return { update: (patch: { label: string }) => labels.push(patch.label), remove() {} };
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(registered, ["当前会话 · loading"]);
    assert.deepEqual(labels, []);
    onUpdate({ kind: "upsert", agent: { ...agent("current"), title: "已改名任务" } });
    assert.deepEqual(labels, ["已改名任务 · loading"]);
    assert.equal(directRpcCalls, 0);
  } finally {
    stop?.();
    await rm(temporary, { recursive: true, force: true });
  }
});
