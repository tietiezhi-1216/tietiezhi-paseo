import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type * as Cache from "../client/quota-cache.ts";
import type { AccountQuota } from "../shared/quota.ts";

async function loadCache(): Promise<typeof Cache> {
  const bundle = await build({ entryPoints: ["client/quota-cache.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "web-platform", setup(builder) {
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "platform", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0]!.text)(createRequire(import.meta.url), module, module.exports);
  return module.exports as typeof Cache;
}
const q = (usedPercent: number): AccountQuota => ({ accountId: "same-account", plan: null, fetchedAt: Date.now(), checkedAt: Date.now(), stale: false, error: null,
  windows: [{ id: "week", label: "本周", usedPercent, resetAt: Date.now() + 60000, pool: "shared" }] });

test("持久化缓存按Host隔离，不迁移无Host的v5记录，不遮盖空额度错误", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map<string, string>([["tietiezhi.quotas.cache.v5", JSON.stringify({ "same-account": q(99) })]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value),
  } });
  try {
    const cache = await loadCache();
    assert.equal(cache.getPersistentQuota("macmini", "same-account"), undefined);
    cache.updatePersistentQuotas("macmini", [q(20)], "xai", "same-account");
    cache.updatePersistentQuotas("macbook", [q(60)], "xai", "other-account");
    assert.equal(cache.getPersistentQuota("macmini", "same-account")?.windows[0].usedPercent, 20);
    assert.equal(cache.getPersistentQuota("macbook", "same-account")?.windows[0].usedPercent, 60);
    assert.equal(cache.getPersistentQuota("unknown-host", "same-account"), undefined);
    assert.equal(cache.getPersistentQuota("macmini", "same-account")?.stale, true);
    assert.equal(cache.getActiveAccountCache("macmini", "xai"), "same-account");
    assert.equal(cache.getActiveAccountCache("macbook", "xai"), "other-account");
    cache.updatePersistentQuotas("macmini", [{ ...q(20), windows: [], error: "接口未提供可计算的额度百分比", stale: true }]);
    assert.deepEqual(cache.getPersistentQuota("macmini", "same-account")?.windows, []);
    const reloaded = await loadCache();
    assert.match(reloaded.getPersistentQuota("macmini", "same-account")!.error!, /未提供/);
    reloaded.updatePersistentQuotas("macmini", [], "xai", null);
    assert.equal(reloaded.getActiveAccountCache("macmini", "xai"), undefined);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
