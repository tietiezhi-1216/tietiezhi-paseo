import { createHash } from "node:crypto";
import { AccountService } from "./accounts.ts";
import { LIVE_SLOTS, type Family } from "../shared/accounts.ts";
import type { AccountQuota, QuotaSnapshot } from "../shared/quota.ts";
import { fetchProviderQuota, legacyQuotaWindows, safeQuotaError, type Fetcher } from "./quota-providers.ts";
type CacheEntry = { result: AccountQuota; attemptedAt: number };
export class QuotaService {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<AccountQuota>>();
  private readonly accounts: () => AccountService;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  constructor(accounts: () => AccountService = () => new AccountService(), fetcher: Fetcher = fetch, now: () => number = Date.now) {
    this.accounts = accounts; this.fetcher = fetcher; this.now = now;
  }
  async get(input: { family: Family; slot?: string | null; all?: boolean; refresh?: boolean }, signal?: AbortSignal): Promise<QuotaSnapshot> {

    if (input.family === "go") throw new Error("此渠道已停用");
    const registry = await this.accounts().quotaCredentials(input.family, input.slot ?? LIVE_SLOTS[input.family]);
    const entries = input.all ? registry.entries : registry.entries.filter((a) => a.id === registry.currentAccountId);
    // Parallel queries across accounts for instant multi-account response
    const quotaPromises = entries.map(async (account) => {
      if (signal?.aborted) throw new Error("插件已停止");
      const fingerprint = createHash("sha256").update(JSON.stringify(account.credential)).digest("hex");
      const key = account.id + ":" + fingerprint;
      const old = this.cache.get(key);
      const isExpiredWindow = old?.result.windows.some((w) => w.resetAt != null && w.resetAt < this.now());
      if (old && !isExpiredWindow && this.now() - old.attemptedAt < (input.refresh ? 5_000 : 60_000)) { return old.result; }
      let work = this.pending.get(key);
      if (!work) {
        const previous = old?.result ?? [...this.cache.values()].filter((v) => v.result.accountId === account.id).sort((a, b) => b.attemptedAt - a.attemptedAt)[0]?.result;
        work = this.query(account, previous, signal).then((result) => {
          if (!signal?.aborted) {
            if (!result.error) {
              this.cache.set(key, { result, attemptedAt: this.now() });
              while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
            } else {
              // Errors are only cached for 5 seconds to allow fast automatic retry
              this.cache.set(key, { result, attemptedAt: this.now() - 55_000 });
            }
          }
          return result;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, work);
      }
      return await work;
    });
    const quotas = await Promise.all(quotaPromises);
    if (signal?.aborted) throw new Error("插件已停止");
    const latest = await this.accounts().quotaCredentials(input.family, input.slot ?? LIVE_SLOTS[input.family]);
    const validQuotas = quotas.filter((q) => q.windows.length > 0);
    if (validQuotas.length > 0) {
      try {
        await this.accounts().updateAllAccountUsages(
          validQuotas.map((q) => ({ id: q.accountId, quota: { windows: q.windows, plan: q.plan, fetchedAt: q.fetchedAt ?? this.now() } }))
        );
      } catch {}
    }
    return { snapshot: latest.snapshot, family: input.family, currentAccountId: latest.currentAccountId,
      quotas: quotas.filter((q) => latest.snapshot.accounts.some((a) => a.id === q.accountId)) };
  }
  private async query(account: Awaited<ReturnType<AccountService["quotaCredentials"]>>["entries"][number], previous: AccountQuota | undefined, lifetime?: AbortSignal): Promise<AccountQuota> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (lifetime?.aborted) abort(); else lifetime?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 15_000);
    const signal = controller.signal;
    const cached = legacyQuotaWindows(account.cachedUsage).filter((w) => account.family !== "antigravity" || w.pool !== "shared");
    const tokenBefore = account.credential.access;
    try {
      const quota = await fetchProviderQuota(account.family, account.credential, this.fetcher, signal);
      if (account.credential.access !== tokenBefore) {
        try { await this.accounts().updateCredential(account.id, account.credential); } catch {}
      }
      return { accountId: account.id, ...quota, fetchedAt: this.now(), checkedAt: this.now(), stale: false, error: null };
    } catch (error) {
      return {
        accountId: account.id, windows: previous?.windows ?? cached, plan: previous?.plan ?? account.plan,
        fetchedAt: previous?.fetchedAt ?? account.cachedAt ?? null, checkedAt: this.now(), stale: true, error: safeQuotaError(error),
      };
    } finally { clearTimeout(timer); lifetime?.removeEventListener("abort", abort); }
  }
}
