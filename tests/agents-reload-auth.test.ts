import test from "node:test";
import assert from "node:assert/strict";
import { localDaemonAuth, reloadConnectionError } from "../server/agents.ts";

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
