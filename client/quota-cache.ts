import { AccountQuotaSchema, type AccountQuota } from "../shared/quota.ts";
import type { Family } from "../shared/accounts.ts";
import { quotaHostCacheKey } from "../shared/quota-state.ts";
import { readWebStorage, writeWebStorage } from "./web.ts";

// v5 lacked Host identity and must not be migrated into the scoped cache.
const QUOTA_CACHE_KEY = "tietiezhi.quotas.cache.v6";
const ACTIVE_ACCOUNT_CACHE_KEY = "tietiezhi.active.account.v6";
function readStore(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readWebStorage(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
const quotas: Record<string, AccountQuota> = {};
for (const [key, value] of Object.entries(readStore(QUOTA_CACHE_KEY))) {
  const result = AccountQuotaSchema.safeParse(value);
  if (result.success) quotas[key] = result.data;
}
const activeAccounts = readStore(ACTIVE_ACCOUNT_CACHE_KEY);

export function getPersistentQuota(hostId: string, accountId: string): AccountQuota | undefined {
  const result = AccountQuotaSchema.safeParse(quotas[quotaHostCacheKey(hostId, accountId)]);
  // Disk/browser snapshots are cached evidence, not a newly completed provider query.
  return result.success && result.data.accountId === accountId ? { ...result.data, stale: true } : undefined;
}
export function getActiveAccountCache(hostId: string, family: Family): string | undefined {
  const value = activeAccounts[quotaHostCacheKey(hostId, family)];
  return typeof value === "string" ? value : undefined;
}
export function updatePersistentQuotas(hostId: string, values: readonly AccountQuota[] | undefined, family?: Family, currentAccountId?: string | null) {
  if (family) {
    const key = quotaHostCacheKey(hostId, family);
    if (currentAccountId) activeAccounts[key] = currentAccountId;
    else delete activeAccounts[key];
    writeWebStorage(ACTIVE_ACCOUNT_CACHE_KEY, JSON.stringify(activeAccounts));
  }
  if (!values?.length) return;
  for (const value of values) {
    const result = AccountQuotaSchema.safeParse(value);
    if (result.success) quotas[quotaHostCacheKey(hostId, result.data.accountId)] = result.data;
  }
  // Bound storage growth across hosts/accounts; discard oldest snapshots first.
  const keys = Object.keys(quotas).sort((a, b) => (quotas[a]!.checkedAt ?? 0) - (quotas[b]!.checkedAt ?? 0));
  for (const key of keys.slice(0, Math.max(0, keys.length - 200))) delete quotas[key];
  writeWebStorage(QUOTA_CACHE_KEY, JSON.stringify(quotas));
}
