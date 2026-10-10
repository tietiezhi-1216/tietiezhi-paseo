import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentProbeBroker } from "../server/agent-probe.ts";
import { probeConnectedHosts } from "../client/agent-probe-lookup.ts";
import { ProbeResultSchema, type ProbeHostResult } from "../shared/agent-probe.ts";

const agentId = "61037014-ce93-42c8-a21b-de527ef83bc3";
const found: ProbeHostResult = { serverId: "remote", label: "Remote", state: "found", agent: {
  id: agentId, title: "Target", provider: "pi", status: "idle", model: null, workspaceId: "workspace",
} };

test("App bridge preserves request identity, accumulates hosts and returns only metadata", () => {
  const broker = createAgentProbeBroker();
  const { requestId } = broker.request(agentId);
  assert.deepEqual(broker.pending().requests, [{ requestId, agentId }]);
  broker.report(requestId, [{ serverId: "local", label: "Local", state: "not_found", agent: null }]);
  assert.equal(broker.collect(requestId).state, "pending");
  broker.report(requestId, [found]);
  const result = broker.collect(requestId);
  assert.equal(result.state, "found");
  assert.equal(result.hosts.length, 2);
  assert.equal(ProbeResultSchema.safeParse(result).success, true);
  assert.equal(broker.pending().requests.length, 0);
  broker.report(requestId, [{ ...found, state: "offline", agent: null }]);
  assert.equal(broker.collect(requestId).hosts[1].state, "found");
});

test("App absence expires instead of claiming Agent not found; late replies rejected", () => {
  let now = 0;
  const broker = createAgentProbeBroker(() => now);
  const { requestId } = broker.request(agentId);
  now = 20_000;
  assert.equal(broker.collect(requestId).state, "expired");
  assert.deepEqual(broker.collect(requestId).hosts, []);
  assert.equal(broker.report(requestId, [found]).accepted, false);
  broker.dispose();
  assert.throws(() => broker.collect(requestId));
});

test("App cannot accidentally report another Agent; queue bounded and cleaned", () => {
  let now = 0;
  const broker = createAgentProbeBroker(() => now);
  const { requestId } = broker.request(agentId);
  assert.throws(() => broker.report(requestId, [{ ...found, agent: { ...found.agent!, id: "wrong" } }]));
  assert.throws(() => broker.report(requestId, [{ ...found, agent: null }]));
  assert.deepEqual(broker.collect(requestId).hosts, []);
  for (let i = 0; i < 15; i++) broker.request(agentId);
  assert.throws(() => broker.request(agentId));
  now = 80_000;
  assert.equal(broker.pending().requests.length, 0);
  broker.request(agentId);
});

test("Native App lookup uses exact Host APIs and all pages, includes archived/child Agents", async () => {
  const calls: unknown[] = [];
  const result = await probeConnectedHosts([
    { serverId: "offline", label: "Offline", status: "offline" },
    { serverId: "remote", label: "Remote", status: "online" },
  ], agentId, serverId => {
    assert.equal(serverId, "remote");
    return { agents: { async list(options) {
      calls.push(options);
      assert.equal(options.filter.includeArchived, true);
      assert.equal("subscribe" in options, false);
      return options.page.cursor ? { entries: [{ agent: found.agent! }], pageInfo: { hasMore: false } }
        : { entries: [], pageInfo: { hasMore: true, nextCursor: "next" } };
    } } };
  }, new AbortController().signal);
  assert.equal(calls.length, 2);
  assert.equal(result[0].state, "offline");
  assert.deepEqual(result[1], found);
});

test("Native App lookup distinguishes inaccessible Host from an exhaustive miss", async () => {
  const result = await probeConnectedHosts([
    { serverId: "error", label: "Error", status: "online" },
    { serverId: "missing", label: "Missing", status: "online" },
  ], agentId, serverId => {
    if (serverId === "error") throw Error("sensitive transport error");
    return { agents: { async list() { return { entries: [], pageInfo: { hasMore: false } }; } } };
  }, new AbortController().signal);
  assert.deepEqual(result.map(h => h.state), ["error", "not_found"]);
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
});
