import type { AccountQuota } from "../shared/quota.ts";
import type { Family } from "../shared/accounts.ts";

const QUOTA_CACHE_KEY = "tietiezhi.quotas.cache.v5";
const ACTIVE_ACCOUNT_CACHE_KEY = "tietiezhi.active.account.v5";

export const persistentQuotaStore: Record<string, AccountQuota> = (() => {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(QUOTA_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
})();

export const activeAccountStore: Record<string, string> = (() => {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_ACCOUNT_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
})();

export function setActiveAccountCache(family: Family, accountId: string | null | undefined) {
  if (!accountId || typeof localStorage === "undefined") return;
  activeAccountStore[family] = accountId;
  try {
    localStorage.setItem(ACTIVE_ACCOUNT_CACHE_KEY, JSON.stringify(activeAccountStore));
  } catch {}
}

export function updatePersistentQuotas(quotas: readonly AccountQuota[] | undefined, family?: Family, currentAccountId?: string | null) {
  if (family && currentAccountId) {
    setActiveAccountCache(family, currentAccountId);
  }
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
      localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(persistentQuotaStore));
    } catch {}
  }
}
