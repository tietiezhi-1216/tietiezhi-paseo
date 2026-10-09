import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveForkConnection } from "../server/fork.ts";

test("local fork normalizes daemon loopback/wildcard bind addresses without remote fallback", () => {
  for (const listen of ["127.0.0.1:6767", "localhost:6767", "0.0.0.0:6767"]) assert.deepEqual(resolveForkConnection({ serverId: "host", listen, home: "/daemon" }, "host"), { url: "ws://127.0.0.1:6767/ws", home: "/daemon" });
  for (const listen of ["[::1]:6767", "[::]:6767"]) assert.equal(resolveForkConnection({ serverId: "host", listen, home: "/daemon" }, "host").url, "ws://[::1]:6767/ws");
});

test("unsupported endpoints, missing home and mismatched Host are refused before creation", () => {
  for (const listen of ["example.com:6767", "192.168.1.2:6767", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:6767/path", undefined, {}, ""]) assert.throws(() => resolveForkConnection({ serverId: "host", listen, home: "/daemon" }, "host"), /监听地址/);
  for (const home of [undefined, "", "  ", {}]) assert.throws(() => resolveForkConnection({ serverId: "host", listen: "127.0.0.1:6767", home }, "host"), /daemon 目录/);
  assert.throws(() => resolveForkConnection({ serverId: "other", listen: "0.0.0.0:6767", home: "/daemon" }, "host"), /Host 不匹配/);
});
