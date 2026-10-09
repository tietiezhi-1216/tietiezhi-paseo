import { test } from "node:test";
import assert from "node:assert/strict";
import { QuotaService, QUOTA_POLL_INTERVAL_MS } from "../server/quota.ts";
import type { Family } from "../shared/accounts.ts";
import type { QuotaSnapshot } from "../shared/quota.ts";

type Input = { family: Family; all?: boolean; refresh?: boolean };
const snapshot = (input: Input): QuotaSnapshot => ({ family: input.family, currentAccountId: null, quotas: [], snapshot: { revision: "mock", warnings: [], accounts: [] } });
async function drain() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test("启动预热和每五分钟均覆盖全部渠道全部账号，无需客户端打开面板", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const service = new QuotaService(), calls: Input[] = [];
  t.mock.method(service, "get", async (input: Input) => { calls.push(input); return snapshot(input); });
  try {
    service.startBackgroundPolling(); service.startBackgroundPolling();
    t.mock.timers.tick(2999); await drain(); assert.equal(calls.length, 0);
    t.mock.timers.tick(1); await drain();
    assert.deepEqual(calls.map((c) => c.family), ["codex", "antigravity", "xai"]);
    assert.ok(calls.every((c) => c.all === true && c.refresh === true));
    t.mock.timers.tick(QUOTA_POLL_INTERVAL_MS - 3000); await drain();
    assert.deepEqual(calls.map((c) => c.family), ["codex", "antigravity", "xai", "codex", "antigravity", "xai"]);
    service.stop(); t.mock.timers.tick(2 * QUOTA_POLL_INTERVAL_MS); await drain(); assert.equal(calls.length, 6);
  } finally { service.stop(); }
});
test("慢轮询不会重叠，单渠道失败不阻止其他渠道", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const service = new QuotaService(), calls: Input[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(service, "get", async (input: Input) => {
    calls.push(input);
    if (calls.length === 1) await hold;
    if (input.family === "antigravity") throw new Error("failure");
    return snapshot(input);
  });
  try {
    service.startBackgroundPolling(); t.mock.timers.tick(3000); await drain();
    t.mock.timers.tick(QUOTA_POLL_INTERVAL_MS * 2); await drain(); assert.equal(calls.length, 1);
    release(); await drain(); assert.deepEqual(calls.map((c) => c.family), ["codex", "antigravity", "xai"]);
    t.mock.timers.tick(QUOTA_POLL_INTERVAL_MS); await drain(); assert.equal(calls.length, 6);
  } finally { release(); service.stop(); }
});
test("stop或已中止的生命周期同时清理预热和周期定时器", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const method of ["stop", "abort"] as const) {
    const service = new QuotaService(), lifetime = new AbortController(); let calls = 0;
    t.mock.method(service, "get", async (input: Input) => { calls++; return snapshot(input); });
    service.startBackgroundPolling(lifetime.signal);
    if (method === "stop") service.stop(); else lifetime.abort();
    t.mock.timers.tick(2 * QUOTA_POLL_INTERVAL_MS); await drain(); assert.equal(calls, 0);
  }
});
