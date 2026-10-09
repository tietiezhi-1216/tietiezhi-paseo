import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentDirectory } from "../shared/agents-directory.ts";
import { combineAgentSources, agentsPillState } from "../shared/agents-pill.ts";
import type { RemoteAgent } from "../shared/agents.ts";
import type { PaseoApi } from "@getpaseo/client";
import { listHostAgents, localAgentDirectory, retainHostAgents } from "../client/agents-directory.ts";

function agent(host: string, id = "same-id", extra: Partial<RemoteAgent> = {}): RemoteAgent {
  return { hostId: host, hostName: host, serverId: host, id, name: id, status: "running", requiresAttention: false,
    attentionReason: null, createdAt: null, updatedAt: null, lastUserMessageAt: null, workspaceId: "workspace",
    workspace: "workspace", archivedAt: null, parentAgentId: null, ...extra };
}

test("切换 Host 不重标记前一个 Host 的 Agent，同 ID 分别保留", () => {
  const directory = createAgentDirectory();
  directory.replace("a", [agent("a")]);
  directory.replace("b", [agent("b", "same-id", { status: "idle", attentionReason: "finished" })]);
  assert.equal(directory.get("a").agents[0].serverId, "a");
  assert.equal(directory.get("a").agents[0].status, "running");
  assert.equal(directory.get("b").agents[0].serverId, "b");
  assert.equal(directory.get("b").agents[0].attentionReason, "finished");
  const rows = combineAgentSources(directory.get("a").agents, directory.get("b").agents, [], "a");
  assert.equal(rows.length, 2);
  assert.equal(agentsPillState(rows, false, false).label, "done · 1");
});

test("晚返回的列表不覆盖完成事件，其他未变化行照常更新", () => {
  const directory = createAgentDirectory();
  directory.replace("a", [agent("a"), agent("a", "other")]);
  const revision = directory.revision("a");
  directory.upsert("a", agent("a", "same-id", { status: "idle", attentionReason: "finished" }));
  directory.replace("a", [agent("a"), agent("a", "other", { status: "idle" })], revision);
  assert.equal(directory.get("a").agents.find(a => a.id === "same-id")?.attentionReason, "finished");
  assert.equal(directory.get("a").agents.find(a => a.id === "other")?.status, "idle");
});

test("列举期间新增或归档的 Agent 不被旧列表删除或复活", () => {
  const directory = createAgentDirectory();
  const revision = directory.revision("a");
  directory.archive("a", "removed");
  directory.upsert("a", agent("a", "new"));
  directory.replace("a", [agent("a", "removed")], revision);
  assert.deepEqual(directory.get("a").agents.map(a => a.id), ["new"]);
  directory.archive("a", "new");
  assert.equal(agentsPillState(directory.get("a").agents, false, false).label, "idle · 0");
});

test("跨 Host 实时快照覆盖配置缓存，不重复计数，不包含子 Agent", () => {
  const local = [agent("a")];
  const live = [agent("b"), agent("b", "done", { status: "idle", attentionReason: "finished" }), agent("b", "child", { parentAgentId: "done" })];
  const configured = [agent("a", "stale-local"), ...live.map(a => ({ ...a, status: "running" as const, attentionReason: null })), ...live];
  const combined = combineAgentSources(local, live, configured, "a");
  assert.equal(combined.length, 3);
  assert.equal(agentsPillState(combined, false, false).label, "done · 1");
  assert.equal(combined.filter(a => a.status === "running").length, 2);
});

test("所有读取者收到同一版本快照，取消订阅后不再收到更新", () => {
  const directory = createAgentDirectory();
  const seen: number[] = [];
  const stop = directory.subscribeAll(() => { seen.push(directory.getVersion()); });
  directory.replace("a", []);
  const snapshot = directory.get("a");
  assert.equal(directory.get("a"), snapshot);
  assert.equal(snapshot.ready, true);
  directory.upsert("a", agent("a"));
  stop();
  directory.upsert("b", agent("b"));
  assert.deepEqual(seen, [1, 2]);
});

test("实时 Host 完整分页，不因 owned snapshot 仅有第一页而漏数；排除子 Agent", async () => {
  const cursors: (string | undefined)[] = [];
  let subscriptions = 0;
  const owned = { async release() {} };
  const api = { agents: { async list(options: { page: { cursor?: string }; filter: { includeArchived: boolean }; subscribe?: object }) {
    cursors.push(options.page.cursor);
    assert.equal(options.filter.includeArchived, true);
    if (!options.page.cursor) {
      assert.deepEqual(options.subscribe, {});
      return { entries: Array.from({ length: 200 }, (_, i) => ({ agent: { id: String(i), status: "running" } })), subscription: owned, pageInfo: { hasMore: true, nextCursor: "second" } };
    }
    assert.equal(options.subscribe, undefined);
    return { entries: [{ agent: { id: "last", status: "running" } }, { agent: { id: "child", status: "running", labels: { "paseo.parent-agent-id": "last" } } }], pageInfo: { hasMore: false } };
  } } } as unknown as PaseoApi;
  const rows = await listHostAgents(api, "paged", "Paged", subscription => { assert.equal(subscription, owned); subscriptions++; });
  assert.deepEqual(cursors, [undefined, "second"]);
  assert.equal(subscriptions, 1);
  assert.equal(rows.length, 201);
  assert.ok(rows.every(row => row.serverId === "paged"));
});

test("最后读取者离开后释放订阅；晚返回的列表不再写入目录或留下计时器", async () => {
  let resolveList!: (value: unknown) => void;
  let released = 0, unsubscribed = 0;
  const api = { agents: {
    subscribe: () => () => { unsubscribed++; },
    list: () => new Promise(resolve => { resolveList = resolve; }),
  } } as unknown as PaseoApi;
  const stop = retainHostAgents(api, "late-stop", "Late");
  stop(); stop();
  resolveList({ entries: [{ agent: { id: "late", status: "running" } }], subscription: { async release() { released++; } }, pageInfo: { hasMore: false } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(unsubscribed, 1);
  assert.equal(released, 1);
  assert.equal(localAgentDirectory.get("late-stop").ready, false);
  assert.deepEqual(localAgentDirectory.get("late-stop").agents, []);
});
