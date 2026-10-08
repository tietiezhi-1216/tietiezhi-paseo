import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareAgentNavigation, AGENT_ACTIVITY_QUERY_KEY, AGENT_NAVIGATION_EVENT, agentIdClipboardText, paseoAgentIdClipboardText, agentActivityAt, agentMatchesQuery, buildAgentWorkspaceRoute, agentDisplaySection, combineOwnedAgents, isListedAgent, mergeAgentSnapshot, resolveHostServerId, resolveReloadHost, type RemoteAgent } from "../shared/agents.ts";

const agent = { serverId: "srv_remote", workspaceId: "wks_target", id: "agent/42" };

test("same-host navigation uses the supplied API", () => {
  const calls: unknown[] = [];
  prepareAgentNavigation(agent, {
    platform: "ios", currentServerId: agent.serverId,
    navigation: { openAgent: (input) => calls.push(input) },
  })();
  assert.deepEqual(calls, [{ agentId: agent.id }]);
});

test("web navigation uses acknowledged in-app dispatch", () => {
  const calls: unknown[] = [];
  prepareAgentNavigation(agent, {
    platform: "web", currentServerId: "srv_other",
    dispatchWebTarget: (target) => { calls.push(target); return true; },
  })();
  assert.deepEqual(calls, [{ serverId: agent.serverId, workspaceId: agent.workspaceId, agentId: agent.id }]);
  assert.equal(AGENT_NAVIGATION_EVENT, "paseo:web-notification-click");
});

test("native URL routing uses workspace route", () => {
  const calls: unknown[] = [];
  prepareAgentNavigation(agent, {
    platform: "ios", currentServerId: "srv_current",
    nativeLinking: { listenerCount: () => 1, emit: (_, payload) => calls.push(payload.url) },
  })();
  assert.deepEqual(calls, [`paseo://${buildAgentWorkspaceRoute(agent.serverId, agent.workspaceId, agent.id)!.slice(1)}`]);
});

test("cross-host navigation uses native navigation with the target serverId", () => {
  const calls: unknown[] = [];
  prepareAgentNavigation({ serverId: "srv_remote", workspaceId: null, id: "remote-agent" }, {
    platform: "ios", currentServerId: "srv_current",
    navigation: { openAgent: (input) => calls.push(input) },
  })();
  assert.deepEqual(calls, [{ agentId: "remote-agent", serverId: "srv_remote" }]);
});

test("reload host prefers host id, then live server id", () => {
  const hosts = [
    { id: "jili", serverId: "srv_81" },
    { id: "tada", serverId: "srv_82" },
  ];
  assert.equal(resolveReloadHost(hosts, { hostId: "jili", serverId: "srv_82" })?.id, "jili");
  assert.equal(resolveReloadHost(hosts, { hostId: "missing", serverId: "srv_82" })?.id, "tada");
  assert.equal(resolveReloadHost(hosts, { serverId: "srv_82" })?.id, "tada");
  assert.equal(resolveReloadHost(hosts, { hostId: "  ", serverId: "nope" }), null);
});

test("agent host identity prefers the live daemon serverId", () => {
  assert.equal(resolveHostServerId("srv_live", "srv_config"), "srv_live");
  assert.equal(resolveHostServerId(null, "srv_config"), "srv_config");
  assert.equal(resolveHostServerId("  ", undefined), null);
});

test("agent id copies as AGENT colon uuid", () => {
  assert.equal(agentIdClipboardText("25278e1a-c3e3-4eea-add1-016e856d142a"), "AGENT: 25278e1a-c3e3-4eea-add1-016e856d142a");
  assert.equal(agentIdClipboardText("  25278e1a-c3e3-4eea-add1-016e856d142a  "), "AGENT: 25278e1a-c3e3-4eea-add1-016e856d142a");
  assert.equal(paseoAgentIdClipboardText("666cb5b9-ece3-4d59-8798-e3f73232294b"), "Paseo Agent ID: 666cb5b9-ece3-4d59-8798-e3f73232294b");
});

test("search matches name, workspace and id", () => {
  const target = { id: "25278e1a-c3e3-4eea-add1-016e856d142a", name: "插件开发", hostName: "Mac mini · .80", hostId: "macmini-80" };
  assert.equal(agentMatchesQuery(target, "localhost", ""), true);
  assert.equal(agentMatchesQuery(target, "localhost", "插件"), true);
  assert.equal(agentMatchesQuery(target, "localhost", "LOCAL"), true);
  assert.equal(agentMatchesQuery(target, "localhost", "25278e1a"), true);
  assert.equal(agentMatchesQuery(target, "localhost", "gateway"), false);
});

test("the agents popover reuses the pill query so the first open is already populated", () => {
  const client = readFileSync(join(process.cwd(), "client/agents-pill.tsx"), "utf8");
  assert.equal(AGENT_ACTIVITY_QUERY_KEY, "slotgame-agent-activity");
  assert.equal((client.match(/AGENT_ACTIVITY_QUERY_KEY/g) ?? []).length >= 2, true);
  assert.match(client, /fontVariant: \["tabular-nums"\]/);
  assert.match(client, /minWidth: compact \? 280 : 360/);
  assert.match(client, /<ScrollView/);
  assert.match(client, /kind: "popover"/);
  assert.match(client, /复制当前 Agent ID/);
  assert.doesNotMatch(client, /kind: "menu"/);
  assert.match(client, /autoFocus/);
  assert.match(client, /搜索 Agent \/ 工作区 \/ ID/);
  assert.match(client, /需要主机密码/);
  assert.match(client, /请输入主机连接密码/);
  assert.match(client, /确认重载/);
});

test("agents pills observe future agents and release the directory subscription", () => {
  const source = readFileSync(join(process.cwd(), "client/agents-pill.tsx"), "utf8");
  const pills = source.slice(source.indexOf("export function contributeAgentsPills("));
  assert.match(pills, /subscribe: \{\}/);
  assert.match(pills, /agentSubscription\?\.release\(\)/);
  assert.match(pills, /for \(const \{ agent, project \} of entries\)/);
});

test("agent display sections hide archived agents", () => {
  assert.equal(isListedAgent({ archivedAt: null }), true);
  assert.equal(isListedAgent({ archivedAt: "2026-09-10T00:00:00.000Z" }), false);
  assert.equal(isListedAgent({ archivedAt: null, parentAgentId: "parent-1" }), false);
  assert.equal(isListedAgent({ archivedAt: null, parentAgentId: null }), true);
  assert.equal(agentDisplaySection({ status: "running", attentionReason: null, archivedAt: null }), "working");
  assert.equal(agentDisplaySection({ status: "idle", attentionReason: "finished", archivedAt: null }), "done");
  assert.equal(agentDisplaySection({ status: "closed", attentionReason: null, archivedAt: null }), "closed");
});

test("live patches keep finished agents in done until they run again", () => {
  const base: { status: string; attentionReason: "finished" | "error" | "permission" | null } = { status: "idle", attentionReason: "finished" };
  assert.equal(mergeAgentSnapshot(base, { status: "idle", attentionReason: null }).attentionReason, "finished");
  assert.equal(mergeAgentSnapshot(base, { status: "running", attentionReason: null }).attentionReason, null);
  assert.equal(agentActivityAt({ lastUserMessageAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T01:00:00.000Z" }), "2026-09-11T00:00:00.000Z");
});

test("owned device agents win over borrowed snapshots", () => {
  const local: RemoteAgent = { id: "agent-a", hostId: "80", hostName: "80", serverId: "srv80", name: "local", status: "running", requiresAttention: false, attentionReason: null, createdAt: null, updatedAt: null, lastUserMessageAt: null, workspaceId: "w", workspace: "JILI", archivedAt: null, parentAgentId: null };
  const stale: RemoteAgent = { ...local, status: "idle", attentionReason: "finished", name: "stale" };
  const other: RemoteAgent = { ...local, id: "agent-b", serverId: "srv81", hostId: "81", name: "remote", status: "idle" };
  const combined = combineOwnedAgents([local], [stale, other], "srv80");
  assert.equal(combined.length, 2);
  assert.equal(combined[0].status, "running");
  assert.equal(combined[0].attentionReason, null);
  assert.equal(combined[1].id, "agent-b");
  const sameIdOtherHost = { ...other, id: local.id };
  assert.equal(combineOwnedAgents([local], [sameIdOtherHost, sameIdOtherHost], "srv80").length, 2);
});

test("agentReload supports password, target and savePassword", async () => {
  const { agentReload } = await import("../shared/agents.ts");
  const parsed = agentReload.input.parse({
    agentId: "agent-123",
    password: "secret-token",
    target: "ws://192.168.1.50:6767",
    savePassword: true,
  });
  assert.equal(parsed.agentId, "agent-123");
  assert.equal(parsed.password, "secret-token");
  assert.equal(parsed.target, "ws://192.168.1.50:6767");
  assert.equal(parsed.savePassword, true);
});

test("getAgentDateBucket partitions agents into today, yesterday, this week, this month, earlier", async () => {
  const { getAgentDateBucket, ARCHIVED_DATE_GROUPS } = await import("../shared/agents.ts");
  assert.deepEqual(ARCHIVED_DATE_GROUPS, ["今天", "昨天", "本周", "本月", "更早"]);

  // 本地时间 2026-10-09 14:00:00 (周五)
  const fixedNow = new Date(2026, 9, 9, 14, 0, 0).getTime();

  // 今天 10:00
  assert.equal(getAgentDateBucket({ archivedAt: new Date(2026, 9, 9, 10, 0, 0).toISOString() }, fixedNow), "今天");
  // 昨天 10:00
  assert.equal(getAgentDateBucket({ archivedAt: new Date(2026, 9, 8, 10, 0, 0).toISOString() }, fixedNow), "昨天");
  // 本周二 10-06
  assert.equal(getAgentDateBucket({ archivedAt: new Date(2026, 9, 6, 10, 0, 0).toISOString() }, fixedNow), "本周");
  // 本月初 10-02 (上周五)
  assert.equal(getAgentDateBucket({ archivedAt: new Date(2026, 9, 2, 10, 0, 0).toISOString() }, fixedNow), "本月");
  // 上个月 09-20
  assert.equal(getAgentDateBucket({ archivedAt: new Date(2026, 8, 20, 10, 0, 0).toISOString() }, fixedNow), "更早");
  // 无效时间
  assert.equal(getAgentDateBucket({ archivedAt: null }, fixedNow), "更早");
});


