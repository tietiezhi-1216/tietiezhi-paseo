import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountService, type AccountPaths } from "../server/accounts.ts";
import { QuotaService } from "../server/quota.ts";
import { fetchProviderQuota, safeQuotaError } from "../server/quota-providers.ts";
import { getQuota, resolveQuotaRoute, selectQuotaWindow, QuotaSnapshotSchema } from "../shared/quota.ts";

const cred = (id: string) => ({ type: "oauth", accountId: id, access: `secret-access-${id}`, refresh: `secret-refresh-${id}`, expires: 2e12 });
const response = () => new Response(JSON.stringify({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 28, limit_window_seconds: 18000, reset_at: 1900000000 }, secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_at: 1900100000 } } }));
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ttz-quota-"));
  const paths: AccountPaths = { auth: join(dir, "auth.json"), archive: join(dir, "accounts.json"), legacy: [join(dir, "legacy.json")], backups: join(dir, "backups") };
  const auth = { "openai-codex": cred("A"), "openai-codex-account-2": cred("B") };
  await writeFile(paths.auth, JSON.stringify(auth), { mode: 0o600 });
  return { paths, auth, service: new AccountService(paths), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test("只匹配显式 Pi 渠道路由，不根据模型名或其他 provider 猜测", () => {
  for (const [model, family] of [["openai-codex/gpt-5.5", "codex"], ["xai/grok", "xai"], ["antigravity/gemini-pro", "antigravity"]]) assert.equal(resolveQuotaRoute("pi", model)?.family, family);
  assert.equal(resolveQuotaRoute("pi", "gpt-5.5"), null);
  assert.equal(resolveQuotaRoute("codex", "openai-codex/gpt"), null);
  assert.equal(resolveQuotaRoute("pi", "custom-openai/gpt"), null);
  assert.equal(resolveQuotaRoute("pi", "unrelated/openai-codex/gpt"), null);
  assert.equal(resolveQuotaRoute("pi", "openai-codex-account-!/gpt"), null);
  assert.equal(resolveQuotaRoute("pi/xai", "grok")?.family, "xai");
  assert.equal(resolveQuotaRoute("pi", "xai-account-2/grok")?.slot, "xai-account-2");
  assert.throws(() => getQuota.input.parse({ family: "codex", slot: "../../auth.json" }));
});
test("Antigravity 不跨 Gemini/Claude 额度池回退，展示正确池的限制窗口", () => {
  const windows = [ { id: "g", label: "Gemini", pool: "gemini" as const, usedPercent: 10, resetAt: null }, { id: "c", label: "Claude", pool: "claude" as const, usedPercent: 80, resetAt: null } ];
  assert.equal(selectQuotaWindow("antigravity", "antigravity/gemini-pro", windows)?.usedPercent, 10);
  assert.equal(selectQuotaWindow("antigravity", "antigravity/claude-sonnet", windows)?.usedPercent, 80);
  assert.equal(selectQuotaWindow("antigravity", "antigravity/claude-sonnet", windows.slice(0, 1)), null);
  assert.equal(selectQuotaWindow("antigravity", "unknown", windows), null);
});
test("真实默认/独立路由按账号身份绑定，RPC 不暴露凭据；不存在的独立路由不回退默认", async () => {
  const f = await fixture(); let calls = 0;
  try {
    const quotas = new QuotaService(() => f.service, async (url, init) => { calls++; assert.equal(String(url), "https://chatgpt.com/backend-api/wham/usage"); assert.ok(new Headers(init?.headers).get("Authorization")?.startsWith("Bearer ")); return response(); });
    const base = await quotas.get({ family: "codex" });
    assert.equal(base.quotas[0].windows[0].usedPercent, 28);
    assert.equal(base.quotas[0].windows[0].label, "5小时");
    const named = await quotas.get({ family: "codex", slot: "openai-codex-account-2" });
    assert.notEqual(base.currentAccountId, named.currentAccountId);
    assert.equal(named.quotas[0].accountId, named.currentAccountId);
    const missing = await quotas.get({ family: "codex", slot: "openai-codex-account-missing" });
    assert.equal(missing.currentAccountId, null); assert.equal(missing.quotas.length, 0); assert.equal(calls, 2);
    assert.doesNotThrow(() => QuotaSnapshotSchema.parse(named));
    assert.doesNotMatch(JSON.stringify(named), /secret-access|secret-refresh|credential|Bearer/);
    await assert.rejects(quotas.get({ family: "xai", slot: "openai-codex" }), /不匹配/);
  } finally { await f.cleanup(); }
});
test("去重/冷却与刷新失败保留上次额度，Token 轮换不会丢掉同账号缓存", async () => {
  const f = await fixture(); let now = 1000, fail = false, calls = 0;
  try {
    const quotas = new QuotaService(() => f.service, async () => { calls++; if (fail) throw new Error("provider leaked secret-access-A"); return response(); }, () => now);
    await Promise.all([quotas.get({ family: "codex" }), quotas.get({ family: "codex" })]);
    assert.equal(calls, 1);
    await quotas.get({ family: "codex", refresh: true }); assert.equal(calls, 1);
    now += 61000; fail = true;
    const stale = await quotas.get({ family: "codex" });
    assert.equal(stale.quotas[0].stale, true); assert.equal(stale.quotas[0].windows[0].usedPercent, 28);
    assert.equal(stale.quotas[0].fetchedAt, 1000); assert.doesNotMatch(stale.quotas[0].error!, /secret/);
    f.auth["openai-codex"].access = "rotated-access";
    await writeFile(f.paths.auth, JSON.stringify(f.auth));
    const rotated = await quotas.get({ family: "codex" });
    assert.equal(rotated.quotas[0].windows[0].usedPercent, 28); assert.equal(rotated.quotas[0].stale, true);
  } finally { await f.cleanup(); }
});
test("查询期间切换默认账号，旧结果不会被绑定到新账号", async () => {
  const f = await fixture(); let ready!: () => void, release!: () => void;
  const started = new Promise<void>((r) => { ready = r; });
  const pending = new Promise<void>((r) => { release = r; });
  try {
    const quotas = new QuotaService(() => f.service, async () => { ready(); await pending; return response(); });
    const work = quotas.get({ family: "codex" });
    await started;
    const oldId = (await f.service.list()).accounts.find((a) => a.active)!.id;
    f.auth["openai-codex"] = cred("B");
    await writeFile(f.paths.auth, JSON.stringify({ ...f.auth, "openai-codex-account-1": cred("A") })); release();
    const result = await work;
    assert.notEqual(result.currentAccountId, oldId);
    assert.equal(result.quotas[0].accountId, oldId);
    assert.equal(result.quotas.some((q) => q.accountId === result.currentAccountId), false);
  } finally { release?.(); await f.cleanup(); }
});
test("旧额度仅读缓存、不改授权；网络失败不伪造百分比", async () => {
  const f = await fixture();
  try {
    await writeFile(f.paths.legacy[0], JSON.stringify({ fetchedAt: 100, accounts: [{ id: "openai-codex", cred: cred("A"), usage: { primary: { usedPercent: 42, resetAt: 1900000000000 } } }] }));
    const quotas = new QuotaService(() => f.service, async () => { throw new Error("timeout"); });
    const result = await quotas.get({ family: "codex", all: true });
    assert.equal(result.quotas.find((q) => q.accountId === result.currentAccountId)!.windows[0].usedPercent, 42);
    assert.equal(result.quotas.find((q) => q.accountId !== result.currentAccountId)!.windows.length, 0);
    const { readFile } = await import("node:fs/promises");
    assert.deepEqual(JSON.parse(await readFile(f.paths.auth, "utf8")), f.auth);
  } finally { await f.cleanup(); }
});
test("xAI/Go 缺失比例不当成 0，Antigravity 仅只读查询不 onboard/续期", async () => {
  await assert.rejects(fetchProviderQuota("xai", cred("X"), async () => new Response('{"config":{"currentPeriod":{"end":1900000000}}}'), new AbortController().signal), /未提供/);
  assert.equal(resolveQuotaRoute("pi", "opencode-go/foo"), null);
  await assert.rejects(fetchProviderQuota("go", { type: "api_key", key: "fake-go-key" }, async () => { assert.fail("Go 不得发起查询"); }, new AbortController().signal), /停用/);
  const urls: string[] = [];
  const ag = await fetchProviderQuota("antigravity", { ...cred("G"), projectId: "fake-project" }, async (url) => { urls.push(String(url)); return new Response('{"models":{"gemini-pro":{"quotaInfo":{"remainingFraction":0.7,"resetTime":"2030-01-01T00:00:00Z"}},"claude-sonnet":{"quotaInfo":{"remainingFraction":0.2,"resetTime":"2030-01-01T00:00:00Z"}}}}'); }, new AbortController().signal);
  assert.equal(ag.windows.length, 2); assert.ok(urls.some(url => /fetchAvailableModels$/.test(url)));
  assert.doesNotMatch(urls.join("\n"), /onboard|oauth|token/);
  assert.equal(safeQuotaError(new Error("secret-refresh-ABC")), "额度查询失败或网络超时；保留上次结果");
});
test("插件停止取消额度请求，命令形式 Key 不执行也不发送", async () => {
  let called = false;
  await assert.rejects(fetchProviderQuota("go", { key: "!secret-command" }, async () => { called = true; return response(); }, new AbortController().signal), /停用/);
  assert.equal(called, false);
  const f = await fixture(); const lifetime = new AbortController(); let start!: () => void;
  const started = new Promise<void>((r) => { start = r; });
  try {
    const quotas = new QuotaService(() => f.service, async (_url, init) => {
      start(); await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true }));
      return response();
    });
    const work = quotas.get({ family: "codex" }, lifetime.signal);
    await started; lifetime.abort(); await assert.rejects(work, /已停止/);
  } finally { await f.cleanup(); }
});

test("失败不把历史额度写成最新缓存；缺失比例不回退上一周期", async () => {
  const f = await fixture(); let writes = 0;
  const update = f.service.updateAllAccountUsages.bind(f.service);
  f.service.updateAllAccountUsages = async (values) => { writes++; return update(values); };
  try {
    await writeFile(f.paths.legacy[0], JSON.stringify({ fetchedAt: 100, accounts: [{ id: "openai-codex", cred: cred("A"), usage: { primary: { usedPercent: 52, resetAt: 1900000000000 } } }] }));
    const failed = new QuotaService(() => f.service, async () => { throw new Error("network failure"); });
    const result = await failed.get({ family: "codex" });
    assert.equal(result.quotas[0].fetchedAt, 100); assert.equal(result.quotas[0].stale, true); assert.equal(writes, 0);
    const missing = new QuotaService(() => f.service, async () => new Response('{"rate_limit":{}}'));
    const noPercent = await missing.get({ family: "codex" });
    assert.deepEqual(noPercent.quotas[0].windows, []);
    assert.match(noPercent.quotas[0].error!, /未提供/); assert.equal(writes, 0);
  } finally { await f.cleanup(); }
});
test("新周期成功取到0才显示100%，聚合信用池优先于产品分项", async () => {
  const fresh = await fetchProviderQuota("xai", cred("X"), async () => new Response(JSON.stringify({
    config: { creditUsagePercent: 0, currentPeriod: { end: "2030-01-01T00:00:00Z" } },
  })), new AbortController().signal);
  assert.equal(fresh.windows[0].usedPercent, 0);
  const shared = await fetchProviderQuota("xai", cred("X"), async () => new Response(JSON.stringify({
    config: { creditUsagePercent: 70, productUsage: [{ product: "GrokBuild", usagePercent: 5 }], currentPeriod: { end: "2030-01-01T00:00:00Z" } },
  })), new AbortController().signal);
  assert.equal(shared.windows[0].usedPercent, 70);
  assert.equal(shared.windows[0].resetAt, Date.parse("2030-01-01T00:00:00Z"));
});
test("OAuth已轮换但额度查询失败时仍保存新refresh token，不丢失轮换", async () => {
  const f = await fixture();
  try {
    f.auth["openai-codex"].expires = 1;
    await writeFile(f.paths.auth, JSON.stringify(f.auth));
    const quotas = new QuotaService(() => f.service, async (url) => String(url).includes("/oauth/token")
      ? new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }))
      : new Response("forbidden", { status: 403 }));
    const result = await quotas.get({ family: "codex" });
    assert.equal(result.quotas[0].stale, true); assert.match(result.quotas[0].error!, /403/);
    const { readFile } = await import("node:fs/promises");
    const auth = JSON.parse(await readFile(f.paths.auth, "utf8"));
    assert.equal(auth["openai-codex"].access, "new-access");
    assert.equal(auth["openai-codex"].refresh, "new-refresh");
    assert.doesNotMatch(JSON.stringify(result), /new-access|new-refresh/);
  } finally { await f.cleanup(); }
});
test("错误缓存真实冷却5秒，不假造attemptedAt或发起紧密重试", async () => {
  const f = await fixture(); let now = 1000, calls = 0;
  try {
    const service = new QuotaService(() => f.service, async () => { calls++; return new Response("error", { status: 503 }); }, () => now);
    await service.get({ family: "codex" }); assert.equal(calls, 1);
    now += 4999; await service.get({ family: "codex", refresh: true }); assert.equal(calls, 1);
    now++; await service.get({ family: "codex" }); assert.equal(calls, 2);
  } finally { await f.cleanup(); }
});
