import test from "node:test";
import assert from "node:assert/strict";
import { agentLifecycleInput, agentUnarchive, agentArchive, AGENT_LIFECYCLE_LABELS } from "../shared/agents.ts";
import { archiveRemoteAgent, unarchiveRemoteAgent } from "../server/agents.ts";

test("current-host restore uses native currentHost scope without guessed address or credentials", () => {
  const input = agentLifecycleInput({ id: "archived", hostId: "macmini", serverId: "selected" }, "selected", { password: "stale", target: "ws://wrong-device", savePassword: true });
  assert.deepEqual(input, { currentHost: true, agentId: "archived" });
  assert.equal(agentUnarchive.input.parse(input).currentHost, true);
});
test("remote restore and archive preserve target/password and never become current-host operations", () => {
  const input = agentLifecycleInput({ id: "archived", hostId: "remote", serverId: "remote-server" }, "current", { password: " spaced secret ", target: "ws://remote:6767", savePassword: false });
  for (const contract of [agentUnarchive, agentArchive]) {
    const parsed = contract.input.parse(input);
    assert.equal(parsed.currentHost, false);
    assert.equal(parsed.serverId, "remote-server");
    assert.equal(parsed.password, " spaced secret ");
    assert.equal(parsed.target, "ws://remote:6767");
    assert.equal(parsed.savePassword, false);
  }
  assert.equal(AGENT_LIFECYCLE_LABELS.restore, "恢复");
  assert.equal(AGENT_LIFECYCLE_LABELS.archive, "归档");
});
test("archive and restore reject an unconfigured remote instead of falling back to local", async () => {
  const local = { agents: { ref() { throw new Error("must not fall back to local"); } } } as any;
  for (const operation of [archiveRemoteAgent, unarchiveRemoteAgent]) {
    await assert.rejects(operation({ agentId: "archived", hostId: "unconfigured-test-host", serverId: "unconfigured-test-server" }, local), /尚未配置连接密码与地址/);
  }
});
test("current-host restoration verifies ownership before restarting archived runtime", async () => {
  const local = { agents: { ref: () => ({ refresh: async () => null }) } } as any;
  await assert.rejects(unarchiveRemoteAgent({ currentHost: true, agentId: "archived" }, local), /当前设备不存在此 Agent/);
});
test("current-host archive refuses mixed remote connection arguments", async () => {
  const local = { agents: { ref() { throw new Error("must not mutate"); } } } as any;
  await assert.rejects(archiveRemoteAgent({ currentHost: true, agentId: "archived", target: "ws://remote" }, local), /不能混用远程/);
});
