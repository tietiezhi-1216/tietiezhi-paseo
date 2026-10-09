import { createHash } from "node:crypto";
import { AccountService } from "./accounts.ts";
import { LIVE_SLOTS, type Family } from "../shared/accounts.ts";
import type { AccountQuota, QuotaSnapshot } from "../shared/quota.ts";
import { fetchProviderQuota, legacyQuotaWindows, safeQuotaError, type Fetcher } from "./quota-providers.ts";
import { quotaFetch, closeQuotaHttp } from "./quota-http.ts";

type CacheEntry = { result: AccountQuota; attemptedAt: number };
export const QUOTA_POLL_INTERVAL_MS = 5 * 60_000;
export class QuotaService {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<AccountQuota>>();
  private persistence: Promise<void> = Promise.resolve();
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private shutdown = new AbortController();
  private removeAbortListener: (() => void) | null = null;

  private readonly accounts: () => AccountService;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  constructor(accounts: () => AccountService = () => new AccountService(), fetcher: Fetcher = quotaFetch, now: () => number = Date.now) {
    this.accounts = accounts; this.fetcher = fetcher; this.now = now;
  }

  startBackgroundPolling(signal?: AbortSignal) {
    if (this.pollTimer || this.shutdown.signal.aborted) return;
    if (signal?.aborted) { this.stop(); return; }
    const pollAll = async () => {
      if (this.polling || this.shutdown.signal.aborted) return;
      this.polling = true;
      try {
        for (const family of ["codex", "antigravity", "xai"] as const) {
          if (this.shutdown.signal.aborted) break;
          try {
            const result = await this.get({ family, all: true, refresh: true }, signal);
            const failed = result.quotas.filter((q) => q.error).length;
            console.log(`[tietiezhi quota poll] ${family}: fresh=${result.quotas.length - failed}, failed=${failed}`);
          } catch {
            if (!this.shutdown.signal.aborted) console.warn(`[tietiezhi quota poll] ${family}: query failed`);
          }
        }
      } finally { this.polling = false; }
    };
    this.initialTimer = setTimeout(() => { this.initialTimer = null; void pollAll(); }, 3_000);
    this.pollTimer = setInterval(() => { void pollAll(); }, QUOTA_POLL_INTERVAL_MS);
    const abort = () => this.stop();
    signal?.addEventListener("abort", abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener("abort", abort);
  }

  stop() {
    this.shutdown.abort();
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.initialTimer = this.pollTimer = null;
    this.removeAbortListener?.();
    this.removeAbortListener = null;
    void closeQuotaHttp().catch(() => {});
  }

  private persist(write: () => Promise<void>): Promise<void> {
    // Token rotations and quota snapshots must not overwrite each other's archive writes.
    const task = this.persistence.then(write);
    this.persistence = task.catch(() => {});
    return task;
  }

  async get(input: { family: Family; slot?: string | null; all?: boolean; refresh?: boolean }, lifetime?: AbortSignal): Promise<QuotaSnapshot> {
    if (input.family === "go") throw new Error("此渠道已停用");
    const signal = lifetime ? AbortSignal.any([lifetime, this.shutdown.signal]) : this.shutdown.signal;
    const checkAbort = () => { if (signal.aborted) throw new Error("插件已停止"); };
    checkAbort();
    const registry = await this.accounts().quotaCredentials(input.family, input.slot ?? LIVE_SLOTS[input.family]);
    const entries = input.all ? registry.entries : registry.entries.filter((a) => a.id === registry.currentAccountId);
    const quotas = await Promise.all(entries.map(async (account) => {
      checkAbort();
      const fingerprint = createHash("sha256").update(JSON.stringify(account.credential)).digest("hex");
      const key = account.id + ":" + fingerprint;
      const old = this.cache.get(key);
      const expired = old?.result.windows.some((w) => w.resetAt != null && w.resetAt <= this.now());
      const ttl = old?.result.error || input.refresh ? 5_000 : 30_000;
      if (old && (old.result.error || !expired) && this.now() - old.attemptedAt < ttl) return old.result;
      let work = this.pending.get(key);
      if (!work) {
        const previous = old?.result ?? [...this.cache.values()]
          .filter((v) => v.result.accountId === account.id)
          .sort((a, b) => b.attemptedAt - a.attemptedAt)[0]?.result;
        work = this.query(account, previous, signal).then((result) => {
          if (!signal.aborted) {
            this.cache.set(key, { result, attemptedAt: this.now() });
            while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
          }
          return result;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, work);
      }
      return work;
    }));
    checkAbort();
    let latest = await this.accounts().quotaCredentials(input.family, input.slot ?? LIVE_SLOTS[input.family]);
    const valid = quotas.filter((q) => !q.error && !q.stale && q.fetchedAt != null && q.windows.length > 0
      && latest.snapshot.accounts.some((a) => a.id === q.accountId));
    if (valid.length) {
      await this.persist(() => this.accounts().updateAllAccountUsages(valid.map((q) => ({
        id: q.accountId, quota: { windows: q.windows, plan: q.plan, fetchedAt: q.fetchedAt! },
      }))));
      latest = await this.accounts().quotaCredentials(input.family, input.slot ?? LIVE_SLOTS[input.family]);
    }
    checkAbort();
    return { snapshot: latest.snapshot, family: input.family, currentAccountId: latest.currentAccountId,
      quotas: quotas.filter((q) => latest.snapshot.accounts.some((a) => a.id === q.accountId)) };
  }

  private async query(account: Awaited<ReturnType<AccountService["quotaCredentials"]>>["entries"][number], previous: AccountQuota | undefined, lifetime: AbortSignal): Promise<AccountQuota> {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)]);
    const cached = legacyQuotaWindows(account.cachedUsage).filter((w) => account.family !== "antigravity" || w.pool !== "shared");
    const tokenBefore = JSON.stringify([account.credential.access, account.credential.refresh]);
    try {
      const quota = await fetchProviderQuota(account.family, account.credential, this.fetcher, signal);
      return { accountId: account.id, ...quota, fetchedAt: this.now(), checkedAt: this.now(), stale: false, error: null };
    } catch (error) {
      const message = safeQuotaError(error);
      const unavailable = message === "接口未提供可计算的额度百分比";
      return { accountId: account.id,
        windows: unavailable ? [] : previous?.windows ?? cached,
        plan: previous?.plan ?? account.plan,
        fetchedAt: unavailable ? null : previous?.fetchedAt ?? account.cachedAt ?? null,
        checkedAt: this.now(), stale: true, error: message };
    } finally {
      // Persist a rotated refresh token even when the subsequent usage request fails.
      if (JSON.stringify([account.credential.access, account.credential.refresh]) !== tokenBefore) {
        await this.persist(() => this.accounts().updateCredential(account.id, account.credential));
      }
    }
  }
}
