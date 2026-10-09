import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { quotaFetch, fetchWithQuotaProxy, resolveQuotaProxy, closeQuotaHttp } from "../server/quota-http.ts";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  return address.port;
}
async function close(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("代理读取插件进程或daemon Pi配置，不依赖交互shell", () => {
  assert.equal(resolveQuotaProxy({}, { HTTPS_PROXY: "http://configured:1234" }), "http://configured:1234");
  assert.equal(resolveQuotaProxy({ HTTP_PROXY: "http://env:1234" }, { HTTPS_PROXY: "http://configured:1234" }), "http://env:1234");
  assert.equal(resolveQuotaProxy({}, { PROXY_HOST: "configured", PROXY_PORT: "1234" }), "http://configured:1234");
});
test("真实HTTP代理使用同包fetch+dispatcher，不调用宿主原生fetch", async () => {
  const originalProxy = process.env.HTTPS_PROXY;
  const native = globalThis.fetch;
  let connections = 0;
  const origin = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); });
  const proxy = createServer((req, res) => {
    connections++;
    const upstream = request(req.url!, { method: req.method, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.on("connect", (req, client, head) => {
    connections++;
    const [host, port] = req.url!.split(":");
    const upstream = connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  });
  try {
    const originPort = await listen(origin), proxyPort = await listen(proxy);
    process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
    globalThis.fetch = async () => { assert.fail("must not use a different-version built-in fetch"); };
    const response = await fetchWithQuotaProxy(quotaFetch, `http://127.0.0.1:${originPort}/usage`, { signal: AbortSignal.timeout(3000) });
    assert.deepEqual(await response.json(), { ok: true }); assert.equal(connections, 1);
  } finally {
    globalThis.fetch = native;
    if (originalProxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = originalProxy;
    await closeQuotaHttp(); await close(proxy); await close(origin);
  }
});
test("代理失败仅重试一次直连；取消请求不重试", async () => {
  let calls = 0;
  const response = await fetchWithQuotaProxy(async (_url, init) => {
    calls++;
    if ((init as RequestInit & { dispatcher?: unknown }).dispatcher) throw new Error("proxy unavailable");
    return new Response("ok");
  }, "https://provider.invalid/quota", {});
  assert.equal(await response.text(), "ok"); assert.equal(calls, 2);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(fetchWithQuotaProxy(async () => {
    calls++; controller.abort(); throw new Error("aborted");
  }, "https://provider.invalid/quota", { signal: controller.signal }), /aborted/);
  assert.equal(calls, 1);
  await closeQuotaHttp();
});
