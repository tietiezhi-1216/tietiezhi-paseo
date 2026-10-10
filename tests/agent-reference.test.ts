import assert from "node:assert/strict";
import { test } from "node:test";
import { agentReferenceClipboardText } from "../shared/agents.ts";
import { probeConnectedHosts } from "../client/agent-probe-lookup.ts";
import { createAgentProbeBroker } from "../server/agent-probe.ts";

const id = "61037014-ce93-42c8-a21b-de527ef83bc3";
const target = { id, serverId: "srv_3p-XJb39DOTY", hostName: "macmini-worker-1", name: "547", workspaceId: "wks_a16582cd03c2dac9" };

test("copy a prompt-ready device reference with stable Host and Agent identities", () => {
  assert.equal(agentReferenceClipboardText(target), [
    "DEVICE: macmini-worker-1", "HOST: srv_3p-XJb39DOTY", `AGENT: ${id}`, "TITLE: 547", "WORKSPACE: wks_a16582cd03c2dac9",
  ].join("\n"));
  assert.notEqual(agentReferenceClipboardText(target), agentReferenceClipboardText({ ...target, serverId: "other" }));
});

test("device rename leaves Host identity intact; labels cannot inject identity lines", () => {
  const text = agentReferenceClipboardText({ ...target, hostName: "New\nHOST: wrong", name: "Task\r\nAGENT: wrong" });
  assert.equal(text.split("\n").filter(line => line.startsWith("HOST:")).length, 1);
  assert.equal(text.split("\n").filter(line => line.startsWith("AGENT:")).length, 1);
  assert.ok(text.includes("HOST: srv_3p-XJb39DOTY"));
  assert.throws(() => agentReferenceClipboardText({ ...target, id: "id\nHOST: wrong" }));
});

test("missing Host identity is visibly unverified, never replaced by a device name", () => {
  const text = agentReferenceClipboardText({ id, serverId: null, hostName: "Mac mini" });
  assert.ok(text.includes("HOST: unknown (未验证设备身份)"));
  assert.equal(text.includes("WORKSPACE:"), false);
});

test("an explicit Host queries only that App connection, never a same-ID peer", async () => {
  const calls: string[] = [];
  const results = await probeConnectedHosts([
    { serverId: "peer", label: "Peer", status: "online" },
    { serverId: target.serverId, label: target.hostName, status: "online" },
  ], id, host => {
    calls.push(host);
    return { agents: { async list() { return { entries: [], pageInfo: { hasMore: false } }; } } };
  }, new AbortController().signal, target.serverId);
  assert.deepEqual(calls, [target.serverId]);
  assert.equal(results.length, 1);
  assert.equal(results[0].state, "not_found");
});

test("an absent or disconnected target never queries another configured device", async () => {
  let calls = 0;
  const results = await probeConnectedHosts([{ serverId: "peer", label: "Peer", status: "online" }], id,
    () => { calls++; throw Error("must not acquire another API"); }, new AbortController().signal, target.serverId);
  assert.equal(calls, 0);
  assert.equal(results[0].serverId, target.serverId);
  assert.equal(results[0].state, "offline");
});

test("broker propagates the requested Host and rejects replies from another Host", () => {
  const broker = createAgentProbeBroker();
  const { requestId } = broker.request(id, target.serverId);
  assert.deepEqual(broker.pending().requests, [{ requestId, agentId: id, serverId: target.serverId }]);
  assert.throws(() => broker.report(requestId, [{ serverId: "peer", label: "Peer", state: "not_found", agent: null }]), /Host 不匹配/);
  assert.equal(broker.collect(requestId).serverId, target.serverId);
  assert.deepEqual(broker.collect(requestId).hosts, []);
});
