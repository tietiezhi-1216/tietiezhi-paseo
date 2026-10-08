import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import lockfile from "proper-lockfile";
import { FAMILY_LABELS, LIVE_SLOTS, familyOfSlot, type Account, type AccountSnapshot, type Family } from "../shared/accounts.ts";

type RecordValue = Record<string, unknown>;
type Candidate = {
  id: string;
  family: Family;
  slot: string;
  label: string;
  credential: RecordValue;
  plan: string | null;
  subscriptionExpiresAt: number | null;
  cachedUsage?: unknown;
  cachedAt?: number | null;
};
export type AccountPaths = { auth: string; archive: string; legacy: string[]; backups: string };
type Document = { value: RecordValue; content: string | null };
type Registry = { accounts: Candidate[]; snapshot: AccountSnapshot; auth: Document; archive: Document };

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("插件已停止，账号切换已取消");
}
function claims(credential: RecordValue): RecordValue {
  try {
    const access = string(credential.access) ?? "";
    return record(JSON.parse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString("utf8")));
  } catch { return {}; }
}
function accountEmail(credential: RecordValue): string | null {
  const jwt = claims(credential);
  const profile = record(jwt["https://api.openai.com/profile"]);
  return [credential.email, credential.account, profile.email, jwt.email]
    .map(string).find((value) => value?.includes("@")) ?? null;
}
function identity(family: Family, credential: RecordValue): string {
  const jwt = claims(credential);
  const auth = record(jwt["https://api.openai.com/auth"]);
  const stable = string(credential.accountId) ?? string(auth.chatgpt_account_id) ??
    string(credential.userId) ?? accountEmail(credential)?.toLowerCase() ?? string(jwt.sub);
  // Hash even stable identities; never expose credential material, email-derived IDs, or JWTs in RPC IDs.
  const value = stable ?? string(credential.key) ?? string(credential.refresh) ?? string(credential.access) ?? JSON.stringify(credential);
  return `${family}:${digest(`${family}\0${value}`).slice(0, 24)}`;
}
function credentialProblem(credential: RecordValue): string | null {
  if (credential.type === "api_key" && string(credential.key)) return null;
  if (credential.type === "oauth" && string(credential.access) && string(credential.refresh) && number(credential.expires) !== null) return null;
  return "缺少完整的 Pi 授权凭据，请先在目标主机登录";
}
function technicalLabel(label: string | null, slot: string): boolean {
  return !label || label === slot || familyOfSlot(label) !== null;
}

async function document(path: string, label: string): Promise<Document> {
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: {}, content: null };
    throw new Error(`无法读取${label}，请检查目标主机的文件权限`);
  }
  try {
    const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { value: record(value), content };
  } catch { throw new Error(`${label}不是有效 JSON 对象；为避免覆盖，操作已停止`); }
}

export function defaultAccountPaths(): AccountPaths {
  const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
  let configuredEnv: RecordValue = {};
  try {
    const config = record(JSON.parse(readFileSync(join(paseoHome, "config.json"), "utf8")));
    configuredEnv = record(record(record(record(config.agents).providers).pi).env);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("无法读取 daemon 配置，账号操作已停止；请检查 config.json 和权限");
  }
  const configuredHome = process.env.TIETIEZHI_PI_AGENT_DIR || string(configuredEnv.PI_CODING_AGENT_DIR) || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const piHome = configuredHome.startsWith("~/") ? join(homedir(), configuredHome.slice(2)) : configuredHome;
  if (!isAbsolute(piHome)) throw new Error("Pi 授权目录必须是绝对路径，请检查 PI_CODING_AGENT_DIR");
  const home = join(paseoHome, "tietiezhi");
  return {
    auth: join(piHome, "auth.json"),
    archive: join(home, "accounts.json"),
    legacy: [join(paseoHome, "model-quota.json"), join(paseoHome, "ttz.json")],
    backups: join(home, "backups"),
  };
}

/** A host-local Pi default-account switcher. It never refreshes tokens, evaluates key commands, or exposes secrets. */
export class AccountService {
  private readonly paths: AccountPaths;
  constructor(paths: AccountPaths = defaultAccountPaths()) { this.paths = paths; }

  private async registry(): Promise<Registry> {
    const auth = await document(this.paths.auth, "Pi 授权文件");
    const archive = await document(this.paths.archive, "tietiezhi 账号归档");
    if (archive.content && archive.value.version !== 1) throw new Error("账号归档版本不兼容，操作已停止");
    const legacy: Document[] = [];
    for (const path of this.paths.legacy) legacy.push(await document(path, "历史账号文件"));
    const accounts = new Map<string, Candidate>();
    const priorities = new Map<string, number>();
    const deleted = new Set(Array.isArray(archive.value.deleted) ? (archive.value.deleted as string[]) : []);
    const add = (slot: string, credential: RecordValue, metadata: RecordValue = {}, live = false) => {
      const family = familyOfSlot(slot);
      if (!family || !Object.keys(credential).length) return;
      const id = identity(family, credential);
      if (deleted.has(id)) return;
      const existing = accounts.get(id);
      const label = string(metadata.label);
      const usage = record(metadata.usage);
      const preferredLabel = !technicalLabel(label, slot) ? label! : existing?.label ?? accountEmail(credential) ?? `${FAMILY_LABELS[family]} · ${slot}`;
      const priority = live ? (slot === LIVE_SLOTS[family] ? 3 : 2) : 1;
      const previousPriority = priorities.get(id) ?? 0;
      const freshness = (number(credential.expires) ?? 0) - (number(existing?.credential.expires) ?? 0);
      // Prefer the later OAuth expiry; for ties prefer live auth, then the default slot.
      // After a switch, an archived original may be newer than a stale named alias still in auth.json.
      const replace = !existing || freshness > 0 || (freshness === 0 && priority >= previousPriority);
      if (replace) priorities.set(id, priority);
      accounts.set(id, {
        id, family, slot: existing?.slot ?? slot, label: preferredLabel.slice(0, 200),
        credential: replace ? credential : existing.credential,
        plan: string(metadata.plan) ?? string(usage.plan) ?? existing?.plan ?? null,
        subscriptionExpiresAt: number(metadata.subscriptionExpiresAt) ?? existing?.subscriptionExpiresAt ?? null,
        cachedUsage: metadata.cachedUsage ?? metadata.usage ?? existing?.cachedUsage,
        cachedAt: number(metadata.cachedAt) ?? number(metadata.quotaFetchedAt) ?? existing?.cachedAt ?? null,
      });
    };
    const addSaved = (source: RecordValue, canonical: boolean) => {
      if (source.accounts !== undefined && !Array.isArray(source.accounts)) throw new Error("账号文件的 accounts 字段无效，操作已停止");
      for (const raw of Array.isArray(source.accounts) ? source.accounts : []) {
        const account = record(raw);
        add(string(account.slot) ?? string(account.id) ?? "", record(canonical ? account.credential : account.cred), { ...account, quotaFetchedAt: source.fetchedAt });
      }
    };
    // Older files are read-only migration sources. Canonical labels take precedence; live credentials take precedence last.
    for (const source of legacy) addSaved(source.value, false);
    addSaved(archive.value, true);
    for (const [slot, value] of Object.entries(auth.value)) add(slot, record(value), {}, true);
    // Ensure active live base slots always take highest precedence over old stale aliases
    for (const [family, baseSlot] of Object.entries(LIVE_SLOTS)) {
      const liveCred = record(auth.value[baseSlot]);
      if (Object.keys(liveCred).length) {
        const id = identity(family as Family, liveCred);
        const target = accounts.get(id);
        if (target) {
          target.credential = liveCred;
          target.slot = baseSlot;
        }
      }
    }
    const active = new Set<string>();
    for (const [family, slot] of Object.entries(LIVE_SLOTS)) {
      const credential = record(auth.value[slot]);
      if (Object.keys(credential).length) active.add(identity(family as Family, credential));
    }
    const sorted = [...accounts.values()].sort((a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const revision = digest(JSON.stringify([this.paths.auth, auth.content, archive.content, ...legacy.map((item) => item.content)]));
    const warnings = ["切换的是此 Host 的 Pi 默认账号；项目独立授权、API Key 环境变量可能覆盖它。正在执行中的请求不会强制中断。"];
    if (legacy.some((source) => source.content)) warnings.push("已只读合并旧 model-quota / ttz 账号；旧数据不会被修改。额度和套餐为旧缓存，不代表实时查询结果。");
    if (!auth.content) warnings.push("此 Host 尚无 Pi auth.json，请先使用 Pi 登录后再切换。");
    return {
      accounts: sorted, auth, archive,
      snapshot: {
        revision, warnings,
        accounts: sorted.map((account) => {
          const problem = account.family === "go" ? "此渠道已停用" : credentialProblem(account.credential);
          return {
            id: account.id, family: account.family, slot: account.slot, label: account.label,
            active: active.has(account.id), authType: string(account.credential.type) ?? "unknown",
            expiresAt: number(account.credential.expires), subscriptionExpiresAt: account.subscriptionExpiresAt,
            plan: account.plan, canSwitch: auth.content !== null && problem === null, problem,
          };
        }),
      },
    };
  }

  async list(): Promise<AccountSnapshot> { return (await this.registry()).snapshot; }

  /** Login completion archives credentials only. Existing defaults and named routes never change. */
  async addLogin(family: Family, credential: RecordValue, signal?: AbortSignal): Promise<void> {
    const problem = credentialProblem(credential);
    if (problem || credential.type !== "oauth") throw new Error("授权结果不完整，未保存");
    checkAbort(signal);
    await mkdir(dirname(this.paths.auth), { recursive: true, mode: 0o700 });
    // First setup creates an empty store, never automatically selects the new account.
    await writeFile(this.paths.auth, "{}\n", { flag: "wx", mode: 0o600 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("无法创建 Pi 授权文件");
    });
    const stat = await lstat(this.paths.auth);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Pi 授权文件不可安全使用");
    let compromised = false;
    const release = await lockfile.lock(this.paths.auth, {
      realpath: false, stale: 30_000, retries: { retries: 4, minTimeout: 50, maxTimeout: 250 },
      onCompromised() { compromised = true; },
    }).catch(() => { throw new Error("账号文件正在更新，请稍后重试"); });
    try {
      const registry = await this.registry();
      const id = identity(family, credential);
      const previous = registry.accounts.find((item) => item.id === id);
      const account: Candidate = {
        ...previous, id, family, slot: previous?.slot ?? LIVE_SLOTS[family],
        label: accountEmail(credential) ?? previous?.label ?? FAMILY_LABELS[family],
        credential, plan: previous?.plan ?? null, subscriptionExpiresAt: previous?.subscriptionExpiresAt ?? null,
      };
      if (registry.archive.content !== null) await this.backup(this.paths.archive, "accounts");
      checkAbort(signal);
      if (compromised) throw new Error("账号文件锁已失效，未保存");
      await this.atomicWrite(this.paths.archive, {
        ...registry.archive.value, version: 1,
        accounts: [...registry.accounts.filter((item) => item.id !== id), account],
      });
    } finally { await release().catch(() => {}); }
    await this.pruneBackups().catch(() => {});
  }

  /** Server-only input for read-only quota queries. Never register this method directly as an RPC. */
  async quotaCredentials(family: Family, slot: string) {
    if (familyOfSlot(slot) !== family) throw new Error("渠道与账号路由不匹配");
    const registry = await this.registry();
    const credential = record(registry.auth.value[slot]);
    const currentId = Object.keys(credential).length ? identity(family, credential) : null;
    return {
      snapshot: registry.snapshot,
      currentAccountId: registry.accounts.some((a) => a.id === currentId) ? currentId : null,
      entries: registry.accounts.filter((a) => a.family === family),
    };
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tietiezhi-${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }

  private async backup(path: string, kind: "auth" | "accounts"): Promise<void> {
    await mkdir(this.paths.backups, { recursive: true, mode: 0o700 });
    await chmod(this.paths.backups, 0o700);
    const backup = join(this.paths.backups, `${Date.now()}-${randomBytes(8).toString("hex")}-${kind}.json`);
    await copyFile(path, backup);
    await chmod(backup, 0o600);
  }

  private async pruneBackups(): Promise<void> {
    const names = await readdir(this.paths.backups);
    for (const kind of ["auth", "accounts"]) {
      const owned = names.filter((name) => new RegExp(`^\\d{13}-[a-f0-9]{16}-${kind}\\.json$`).test(name)).sort().reverse();
      for (const name of owned.slice(10)) await rm(join(this.paths.backups, name));
    }
  }

  async autoSwitchNextAccount(family: Family): Promise<{ previous: Account; next: Account } | null> {
    const registry = await this.registry();
    const familyAccounts = registry.snapshot.accounts.filter((a) => a.family === family && a.canSwitch);
    if (familyAccounts.length <= 1) return null;
    const currentActive = familyAccounts.find((a) => a.active) ?? familyAccounts[0];
    const candidates = familyAccounts.filter((a) => a.id !== currentActive.id);
    if (!candidates.length) return null;

    const candFull = candidates.map((c) => ({
      account: c,
      target: registry.accounts.find((a) => a.id === c.id),
    }));

    candFull.sort((a, b) => {
      const aUsed = (a.target?.cachedUsage as any)?.primary?.usedPercent ?? (a.target?.cachedUsage as any)?.windows?.[0]?.usedPercent ?? 0;
      const bUsed = (b.target?.cachedUsage as any)?.primary?.usedPercent ?? (b.target?.cachedUsage as any)?.windows?.[0]?.usedPercent ?? 0;
      return aUsed - bUsed;
    });

    const nextAccount = candFull[0].account;
    await this.switch({ id: nextAccount.id, revision: registry.snapshot.revision, confirmed: true });
    return { previous: currentActive, next: nextAccount };
  }

  async switch(input: { id: string; revision: string; confirmed: true }, signal?: AbortSignal) {
    if (input.confirmed !== true) throw new Error("请先确认账号切换的影响范围");
    let release: (() => Promise<void>) | undefined;
    let compromised = false;
    let committed = false;
    let account: Candidate | undefined;
    try {
      checkAbort(signal);
      const stat = await lstat(this.paths.auth).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("Pi 授权文件不存在或是符号链接；请先在目标主机使用 Pi 登录");
      release = await lockfile.lock(this.paths.auth, {
        realpath: false, stale: 30_000,
        retries: { retries: 4, minTimeout: 50, maxTimeout: 250 },
        onCompromised() { compromised = true; },
      }).catch(() => { throw new Error("Pi 授权文件正在被其他进程更新，请稍后重试"); });
      const registry = await this.registry();
      if (input.revision !== registry.snapshot.revision) throw new Error("账号数据已变化，请刷新列表后重新确认切换");
      account = registry.accounts.find((item) => item.id === input.id);
      if (!account) throw new Error("找不到选定账号，请刷新列表");
      const problem = account.family === "go" ? "此渠道已停用" : credentialProblem(account.credential);
      if (problem) throw new Error(problem);
      if (registry.snapshot.accounts.find((item) => item.id === input.id)?.active) {
        return { snapshot: registry.snapshot, backupCreated: false, notice: "此账号已经是当前默认账号" };
      }
      if (compromised) throw new Error("授权文件锁已失效，请重试");
      checkAbort(signal);
      await this.backup(this.paths.auth, "auth");
      if (registry.archive.content !== null) await this.backup(this.paths.archive, "accounts");
      // Archive *all* accounts before changing a mutable base slot, so the original account can always be switched back.
      await this.atomicWrite(this.paths.archive, { ...registry.archive.value, version: 1, accounts: registry.accounts });
      if (compromised) throw new Error("授权文件锁已失效，请重试");
      checkAbort(signal);
      await this.atomicWrite(this.paths.auth, { ...registry.auth.value, [LIVE_SLOTS[account.family]]: account.credential });
      committed = true;
    } finally { await release?.().catch(() => {}); }
    // Once auth is committed, a failed housekeeping/readback must not masquerade as a failed switch.
    await this.pruneBackups().catch(() => {});
    try {
      return {
        snapshot: await this.list(), backupCreated: true,
        notice: `已切换此 Host 的 ${FAMILY_LABELS[account!.family]} 默认账号为 ${account!.label}。新会话使用新账号；现有 Pi 的下一次请求是否重读授权取决于版本，必要时等任务结束后手动重载会话。`,
      };
    } catch {
      if (committed) throw new Error("账号切换已写入，但列表刷新失败；请刷新确认，勿重复切换");
      throw new Error("账号切换未完成，请刷新后重试");
    }
  }

  async updateCredential(id: string, credential: RecordValue): Promise<void> {
    try {
      const registry = await this.registry();
      const target = registry.accounts.find((a) => a.id === id);
      if (!target) return;
      target.credential = { ...target.credential, ...credential };
      await this.atomicWrite(this.paths.archive, { ...registry.archive.value, version: 1, accounts: registry.accounts });
      if (registry.snapshot.accounts.find((a) => a.id === id)?.active) {
        const authValue = { ...registry.auth.value, [LIVE_SLOTS[target.family]]: target.credential };
        await this.atomicWrite(this.paths.auth, authValue);
      }
    } catch {}
  }

  async updateAccountUsage(id: string, quota: { windows: readonly unknown[]; plan: string | null; fetchedAt: number }): Promise<void> {
    try {
      const registry = await this.registry();
      const target = registry.accounts.find((a) => a.id === id);
      if (!target) return;
      target.plan = quota.plan ?? target.plan;
      target.cachedAt = quota.fetchedAt;
      target.cachedUsage = {
        account: target.label,
        plan: target.plan,
        windows: quota.windows,
      };
      await this.atomicWrite(this.paths.archive, { ...registry.archive.value, version: 1, accounts: registry.accounts });
    } catch {}
  }

  async updateAllAccountUsages(updates: Array<{ id: string; quota: { windows: readonly unknown[]; plan: string | null; fetchedAt: number } }>): Promise<void> {
    try {
      const registry = await this.registry();
      let changed = false;
      for (const update of updates) {
        const target = registry.accounts.find((a) => a.id === update.id);
        if (target) {
          target.plan = update.quota.plan ?? target.plan;
          target.cachedAt = update.quota.fetchedAt;
          target.cachedUsage = {
            account: target.label,
            plan: target.plan,
            windows: update.quota.windows,
          };
          changed = true;
        }
      }
      if (changed) {
        await this.atomicWrite(this.paths.archive, { ...registry.archive.value, version: 1, accounts: registry.accounts });
      }
    } catch {}
  }

  async delete(input: { id: string; revision: string }, signal?: AbortSignal) {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.paths.auth, {
        realpath: false, stale: 10_000, update: 1000, retries: { retries: 5, minTimeout: 100, maxTimeout: 500 },
        onCompromised() {},
      }).catch(() => { throw new Error("授权文件正忙，请稍后重试"); });

      const registry = await this.registry();
      if (input.revision !== registry.snapshot.revision) throw new Error("账号数据已变化，请刷新列表");
      const account = registry.accounts.find((item) => item.id === input.id);
      if (!account) throw new Error("找不到选定账号，请刷新列表");
      const active = registry.snapshot.accounts.find((item) => item.id === input.id)?.active;
      if (active) throw new Error("默认账号不允许删除；请先切换为其他账号");
      
      checkAbort(signal);
      if (registry.archive.content !== null) await this.backup(this.paths.archive, "accounts");
      await this.backup(this.paths.auth, "auth");
      
      const previousDeleted = Array.isArray(registry.archive.value.deleted) ? (registry.archive.value.deleted as string[]) : [];
      const updatedDeleted = Array.from(new Set([...previousDeleted, input.id]));
      
      const newAccounts = registry.accounts.filter((item) => item.id !== input.id);
      await this.atomicWrite(this.paths.archive, { ...registry.archive.value, version: 1, accounts: newAccounts, deleted: updatedDeleted });
      
      const authValue = { ...registry.auth.value };
      if (authValue[account.slot]) {
        delete authValue[account.slot];
        await this.atomicWrite(this.paths.auth, authValue);
      }

      for (const legacyPath of this.paths.legacy) {
        try {
          const legDoc = await document(legacyPath, "历史账号文件");
          if (Array.isArray(legDoc.value.accounts)) {
            const filteredLeg = legDoc.value.accounts.filter((raw: any) => {
              const acc = record(raw);
              const slotStr = string(acc.slot) ?? string(acc.id) ?? "";
              const fid = identity(familyOfSlot(slotStr) ?? "codex", record(acc.cred ?? acc.credential));
              return fid !== input.id;
            });
            await this.atomicWrite(legacyPath, { ...legDoc.value, accounts: filteredLeg });
          }
        } catch {}
      }
    } finally {
      await release?.().catch(() => {});
    }
    await this.pruneBackups().catch(() => {});
    return { snapshot: await this.list() };
  }
}
