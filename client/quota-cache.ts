import type { AccountQuota } from "../shared/quota.ts";

const CACHE_KEY = "tietiezhi.quotas.cache.v3";

export const persistentQuotaStore: Record<string, AccountQuota> = (() => {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
})();

export function updatePersistentQuotas(quotas: readonly AccountQuota[] | undefined) {
  if (!quotas || !quotas.length) return;
  let changed = false;
  for (const q of quotas) {
    if (q && q.accountId && q.windows.length > 0) {
      persistentQuotaStore[q.accountId] = { ...q, error: null };
      changed = true;
    }
  }
  if (changed && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(persistentQuotaStore));
    } catch {}
  }
}
