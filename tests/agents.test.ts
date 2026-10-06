import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaseoAgentListResult } from "@getpaseo/client";
import { agentKey, agentSection, filterAgents, type AgentRow, type HostSummary } from "../shared/agents.ts";
import { readHostAgents, sendAgentMessage, type GetHostApi } from "../client/host-directory.ts";

function page(id: string, extra: Record<string, unknown> = {}, nextCursor: string | null = null): PaseoAgentListResult {
  return {
    requestId: "fixture", entries: [{ agent: {
      id, title: id, provider: "pi", model: "xai/grok", status: "idle", updatedAt: "2026-01-01T00:00:00Z",
      labels: {}, ...extra,
    }, project: { workspaceName: "fixture workspace" } }],
    pageInfo: { hasMore: nextCursor !== null, nextCursor },
  } as unknown as PaseoAgentListResult;
}
function row(serverId: string, extra: Partial<AgentRow> = {}): AgentRow {
  return {
    serverId, id: "same-agent-id", title: "Test", workspace: "SlotGame", workspaceId: "workspace",
    provider: "pi", model: null, status: "idle", section: "idle", lastActivityAt: "2026-01-01T00:00:00Z",
    parentAgentId: null, ...extra,
  };
}

test("状态分类包含授权等待，不误认为完成", () => {
  assert.equal(agentSection({ status: "idle", requiresAttention: true, attentionReason: "permission" }), "permission");
  assert.equal(agentSection({ status: "idle", requiresAttention: true, attentionReason: "finished" }), "done");
  assert.equal(agentSection({ status: "running", requiresAttention: true, attentionReason: "finished" }), "working");
  assert.equal(agentSection({ status: "initializing" }), "working");
  assert.equal(agentSection({ status: "error" }), "error");
});

test("同 ID 不同 Host 不冲突，搜索包含主机名称且可隐藏子 Agent", () => {
  const hosts: HostSummary[] = [
    { serverId: "a", label: "MacBook", status: "online" }, { serverId: "b", label: "Remote Server", status: "online" },
  ];
  const rows = [row("a"), row("b"), row("b", { id: "child", parentAgentId: "parent" })];
  assert.notEqual(agentKey(rows[0]), agentKey(rows[1]));
  assert.equal(filterAgents(rows, hosts, "", "", false).length, 2);
  assert.equal(filterAgents(rows, hosts, "remote", "", false)[0].serverId, "b");
  assert.equal(filterAgents(rows, hosts, "slotgame", "b", true).length, 2);
});

test("跨 Host 列表完整分页，标记正确主机，不创建订阅", async () => {
  const cursors: (string | undefined)[] = [];
  const getApi = ((serverId: string) => {
    assert.equal(serverId, "relay-remote");
    return { agents: { list: async (options: { page: { cursor?: string }; subscribe?: unknown }) => {
      assert.equal(options.subscribe, undefined);
      cursors.push(options.page.cursor);
      return options.page.cursor ? page("b") : page("a", {}, "cursor2");
    } } };
  }) as unknown as GetHostApi;
  const rows = await readHostAgents(getApi, "relay-remote");
  assert.deepEqual(cursors, [undefined, "cursor2"]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
  assert.ok(rows.every((r) => r.serverId === "relay-remote" && r.model === "xai/grok"));
});

test("归档和关闭 Agent 不展示，保留子 Agent 元数据", async () => {
  const getApi = (() => ({ agents: { list: async () => ({
    requestId: "fixture", entries: [
      ...page("archived", { archivedAt: "2026-01-01" }).entries,
      ...page("closed", { status: "closed" }).entries,
      ...page("child", { labels: { "paseo.parent-agent-id": "parent" } }).entries,
    ], pageInfo: { hasMore: false, nextCursor: null },
  }) } })) as unknown as GetHostApi;
  const rows = await readHostAgents(getApi, "a");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parentAgentId, "parent");
});

test("无效循环分页中止，而不是无限请求", async () => {
  const getApi = (() => ({ agents: { list: async () => page("a", {}, "same") } })) as unknown as GetHostApi;
  await assert.rejects(readHostAgents(getApi, "a"), /无效分页游标/);
});

test("离线和未知主机错误不回退到本机", async () => {
  const calls: string[] = [];
  const getApi: GetHostApi = (id) => { calls.push(id); throw new Error("Paseo host is disconnected"); };
  await assert.rejects(readHostAgents(getApi, "remote"), /disconnected/);
  await assert.rejects(sendAgentMessage(getApi, row("remote"), "hello", "message-1"), /disconnected/);
  assert.deepEqual(calls, ["remote", "remote"]);
});

test("消息只发给已确认的 Host / Agent，使用 messageId 去重并显式 steer 而非默认中断", async () => {
  const calls: unknown[] = [];
  const getApi = ((serverId: string) => ({ agents: { ref: (id: string) => ({
    send: async (text: string, options: unknown) => { calls.push({ serverId, id, text, options }); },
  }) } })) as unknown as GetHostApi;
  await sendAgentMessage(getApi, row("remote"), "  hello remote  ", "stable-message-id");
  assert.deepEqual(calls, [{ serverId: "remote", id: "same-agent-id", text: "hello remote", options: { messageId: "stable-message-id", activeTurnBehavior: "steer" } }]);
});

test("空消息及超长消息不触发任何 SDK 调用", async () => {
  const getApi: GetHostApi = () => { throw new Error("should not be called"); };
  await assert.rejects(sendAgentMessage(getApi, row("remote"), "  ", "m"), /不能为空/);
  await assert.rejects(sendAgentMessage(getApi, row("remote"), "x".repeat(32_001), "m"), /最多/);
});

test("取消后丢弃分页结果，卸载后不继续遍历", async () => {
  const controller = new AbortController();
  let calls = 0;
  const getApi = (() => ({ agents: { list: async () => {
    calls++; controller.abort(); return page("a", {}, "more");
  } } })) as unknown as GetHostApi;
  await assert.rejects(readHostAgents(getApi, "remote", controller.signal), /取消/);
  assert.equal(calls, 1);
});
