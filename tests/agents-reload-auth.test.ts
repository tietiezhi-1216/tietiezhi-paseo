import test from "node:test";
import assert from "node:assert/strict";
import { localDaemonAuth, reloadConnectionError, reloadCurrentHostAgent } from "../server/agents.ts";
import type { PaseoApi } from "@getpaseo/client";

test("current host reload uses bound SDK ownership and real runtime restart without App ids", async () => {
  const calls: string[] = [];
  const paseo = { agents: { ref: (id: string) => ({ refresh: async () => { calls.push(`verify:${id}`); return { id }; } }) } } as unknown as PaseoApi;
  const result = await reloadCurrentHostAgent("agent-1", paseo, async () => ({
    refreshAgent: async (id: string) => { calls.push(`restart:${id}`); return {} as any; },
    close: async () => { calls.push("close"); },
  }));
  assert.equal(result.agentId, "agent-1");
  assert.deepEqual(calls, ["verify:agent-1", "restart:agent-1", "close"]);
});

test("unknown current-host agent does not open any fallback connection", async () => {
  const paseo = { agents: { ref: () => ({ refresh: async () => null }) } } as unknown as PaseoApi;
  await assert.rejects(reloadCurrentHostAgent("missing", paseo, async () => { throw new Error("must not connect"); }), /当前设备不存在/);
});

test("current-host restart failure still closes the native connection", async () => {
  let closed = false;
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ id: "agent-1" }) }) } } as unknown as PaseoApi;
  await assert.rejects(reloadCurrentHostAgent("agent-1", paseo, async () => ({
    refreshAgent: async () => { throw new Error("restart failed"); },
    close: async () => { closed = true; },
  })), /restart failed/);
  assert.equal(closed, true);
});

test("authentication errors identify the failing phase without exposing raw details", async () => {
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ id: "agent-1" }) }) } } as unknown as PaseoApi;
  await assert.rejects(reloadCurrentHostAgent("agent-1", paseo, async () => {
    throw new Error("Incorrect password secret-value");
  }), (error: Error) => {
    assert.match(error.message, /连接当前设备 Daemon失败/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test("explicit reload password overrides stale local credential", () => {
  const auth = localDaemonAuth("new-password", "stale-token");
  assert.equal(auth.password, "new-password");
  assert.equal(auth.localCredential, undefined);
});

test("initial local connection can still use its private credential", () => {
  const auth = localDaemonAuth(undefined, "local-token");
  assert.equal(auth.password, undefined);
  assert.equal(auth.localCredential?.(), "local-token");
});

test("missing remote address survives authentication error normalization", () => {
  const error = new Error("PASSWORD_REQUIRED: 目标是远程设备，尚未配置连接密码与地址");
  assert.equal(reloadConnectionError(error), error);
  assert.match(reloadConnectionError(new Error("Incorrect password")).message, /需要连接凭据或密码/);
  const network = new Error("Connection timeout");
  assert.equal(reloadConnectionError(network), network);
});
