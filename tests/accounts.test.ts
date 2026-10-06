import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountService, type AccountPaths } from "../server/accounts.ts";
import { AccountSnapshotSchema, switchAccount } from "../shared/accounts.ts";

const oauth = (accountId: string, expires = 2_000_000_000_000) => ({
  type: "oauth", accountId, email: `${accountId}@example.invalid`,
  access: `fixture-access-${accountId}`, refresh: `fixture-refresh-${accountId}`, expires, extraProviderField: "preserve-me",
});
async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "tietiezhi-accounts-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths: AccountPaths = {
    auth: join(home, "pi", "auth.json"), archive: join(home, "plugin", "accounts.json"),
    legacy: [join(home, "model-quota.json"), join(home, "ttz.json")], backups: join(home, "plugin", "backups"),
  };
  await mkdir(join(home, "pi"));
  return { paths, service: new AccountService(paths) };
}
const save = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
const load = async (path: string) => JSON.parse(await readFile(path, "utf8"));

test("登录只存私有归档，保留默认/独立槽位和其他厂商，重复登录去重", async (t) => {
  const { paths, service } = await fixture(t);
  const auth = { "openai-codex": oauth("a"), "openai-codex-account-2": oauth("b"), anthropic: { type: "api_key", key: "fixture-other" } };
  await save(paths.auth, auth);
  const bytes = await readFile(paths.auth, "utf8");
  const before = await service.list();
  await service.addLogin("codex", oauth("c"));
  await service.addLogin("codex", oauth("c", 2_000_000_100_000));
  assert.equal(await readFile(paths.auth, "utf8"), bytes);
  const after = await service.list();
  assert.equal(after.accounts.length, 3);
  assert.equal(after.accounts.find((item) => item.label === "c@example.invalid")?.active, false);
  assert.equal(after.accounts.find((item) => item.label === "a@example.invalid")?.active, true);
  assert.notEqual(after.revision, before.revision);
  assert.equal(JSON.stringify(after).includes("fixture-access"), false);
  assert.equal((await stat(paths.archive)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.backups)).mode & 0o777, 0o700);
  await assert.rejects(service.switch({ id: after.accounts[0].id, revision: before.revision, confirmed: true }), /已变化/);
});
test("首次登录不自动设置默认；取消/无效凭据不写账号文件", async (t) => {
  const { paths, service } = await fixture(t);
  await assert.rejects(service.addLogin("codex", { type: "oauth", access: "fixture-invalid" }), /不完整/);
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(service.addLogin("codex", oauth("a"), cancel.signal), /取消/);
  await assert.rejects(stat(paths.auth), { code: "ENOENT" });
  await service.addLogin("codex", oauth("a"));
  assert.deepEqual(await load(paths.auth), {});
  const result = await service.list();
  assert.equal(result.accounts[0].active, false);
  assert.equal(result.accounts[0].canSwitch, true);
  await service.switch({ id: result.accounts[0].id, revision: result.revision, confirmed: true });
  assert.deepEqual((await load(paths.auth))["openai-codex"], oauth("a"));
});

test("Go 停用但保留旧授权；列表标记不可切换且拒绝写入", async (t) => {
  const { service, paths } = await fixture(t);
  const auth = { "opencode-go": { type: "api_key", key: "fixture-preserved-go" }, "openai-codex": oauth("a") };
  await save(paths.auth, auth);
  const snapshot = await service.list();
  const go = snapshot.accounts.find((account) => account.family === "go")!;
  assert.equal(go.canSwitch, false);
  assert.match(go.problem!, /停用/);
  await assert.rejects(service.switch({ id: go.id, revision: snapshot.revision, confirmed: true }), /停用/);
  assert.deepEqual(await load(paths.auth), auth);
});

test("列表只读合并旧账号和 auth，去重并且绝不返回凭据", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { "openai-codex": oauth("a"), "openai-codex-account-2": oauth("b") });
  await save(paths.legacy[0], { accounts: [
    { id: "openai-codex", family: "codex", label: "账号 A", cred: oauth("a"), usage: { plan: "Plus" } },
    { id: "openai-codex-account-2", family: "codex", label: "账号 B", cred: oauth("b") },
  ] });
  const result = AccountSnapshotSchema.parse(await service.list());
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts.find((a) => a.label === "账号 A")?.active, true);
  assert.equal(result.accounts.find((a) => a.label === "账号 B")?.active, false);
  assert.equal(result.accounts.find((a) => a.label === "账号 A")?.plan, "Plus");
  const wire = JSON.stringify(result);
  for (const secret of ["fixture-access", "fixture-refresh", "extraProviderField", '"credential"', '"key"']) assert.equal(wire.includes(secret), false);
  assert.equal((await readdir(join(paths.auth, ".."))).length, 1);
  await assert.rejects(stat(paths.archive), { code: "ENOENT" });
});

test("切换备份、保留其他 provider / 元数据，并可切回原始默认槽位", async (t) => {
  const { service, paths } = await fixture(t);
  const auth = { "openai-codex": oauth("a"), "openai-codex-account-2": oauth("b"), anthropic: { type: "api_key", key: "fixture-other-key", extra: 1 } };
  await save(paths.auth, auth);
  const initial = await service.list();
  const target = initial.accounts.find((a) => a.label.includes("b@"))!;
  const switched = await service.switch({ id: target.id, revision: initial.revision, confirmed: true });
  assert.equal(switched.backupCreated, true);
  const after = await load(paths.auth);
  assert.deepEqual(after["openai-codex"], auth["openai-codex-account-2"]);
  assert.deepEqual(after.anthropic, auth.anthropic);
  assert.deepEqual(after["openai-codex-account-2"], auth["openai-codex-account-2"]);
  assert.equal((await stat(paths.auth)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.archive)).mode & 0o777, 0o600);
  const backups = await readdir(paths.backups);
  const authBackup = backups.find((name) => name.endsWith("-auth.json"))!;
  assert.deepEqual(await load(join(paths.backups, authBackup)), auth);
  assert.equal((await stat(join(paths.backups, authBackup))).mode & 0o777, 0o600);
  const original = switched.snapshot.accounts.find((a) => a.label.includes("a@"))!;
  assert.equal(original.active, false);
  assert.equal(switched.snapshot.accounts.filter((a) => a.active).length, 1);
  await service.switch({ id: original.id, revision: switched.snapshot.revision, confirmed: true });
  assert.deepEqual((await load(paths.auth))["openai-codex"], auth["openai-codex"]);
});

test("历史 store 中不在 auth.json 的账号也能切换，旧文件不变", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { antigravity: oauth("current") });
  await save(paths.legacy[0], { accounts: [
    { id: "antigravity-account-2", cred: oauth("archived"), label: "旧账号" },
  ], unrecognizedLegacyField: "unchanged" });
  const legacyBytes = await readFile(paths.legacy[0], "utf8");
  const initial = await service.list();
  const target = initial.accounts.find((a) => a.label === "旧账号")!;
  await service.switch({ id: target.id, revision: initial.revision, confirmed: true });
  assert.deepEqual((await load(paths.auth)).antigravity, oauth("archived"));
  assert.equal(await readFile(paths.legacy[0], "utf8"), legacyBytes);
});

test("CLI 最新凭据优先于旧缓存，身份不因 token 轮换改变", async (t) => {
  const { service, paths } = await fixture(t);
  const old = oauth("same");
  const rotated = { ...old, access: "fixture-rotated", expires: old.expires + 10 };
  await save(paths.legacy[0], { accounts: [{ id: "openai-codex", cred: old, label: "Original" }] });
  await save(paths.auth, { "openai-codex": rotated, "openai-codex-account-2": oauth("target") });
  const initial = await service.list();
  const original = initial.accounts.find((a) => a.label === "Original")!;
  const target = initial.accounts.find((a) => a.label.includes("target@"))!;
  const result = await service.switch({ id: target.id, revision: initial.revision, confirmed: true });
  const saved = (await load(paths.archive)).accounts.find((a: { id: string }) => a.id === original.id);
  assert.deepEqual(saved.credential, rotated);
  assert.equal(result.snapshot.accounts.find((a) => a.id === original.id)?.active, false);
});

test("同账号的旧命名槽位不能覆盖默认槽位中的新 token", async (t) => {
  const { service, paths } = await fixture(t);
  const old = oauth("same", 1_900_000_000_000);
  const fresh = { ...old, access: "fixture-newest", expires: old.expires + 100 };
  await save(paths.auth, { "openai-codex": fresh, "openai-codex-account-2": old, "openai-codex-account-3": oauth("target") });
  const initial = await service.list();
  assert.equal(initial.accounts.length, 2);
  const target = initial.accounts.find((a) => !a.active)!;
  const changed = await service.switch({ id: target.id, revision: initial.revision, confirmed: true });
  const original = changed.snapshot.accounts.find((a) => a.label.includes("same@"))!;
  await service.switch({ id: original.id, revision: changed.snapshot.revision, confirmed: true });
  assert.deepEqual((await load(paths.auth))["openai-codex"], fresh);
});

test("陈旧确认被拒绝，不覆盖 CLI 后续更新", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { xai: oauth("a"), "xai-account-2": oauth("b") });
  const initial = await service.list();
  const updated = { xai: oauth("a"), "xai-account-2": oauth("b"), newProvider: { key: "fixture-new" } };
  await save(paths.auth, updated);
  const target = initial.accounts.find((a) => !a.active)!;
  await assert.rejects(service.switch({ id: target.id, revision: initial.revision, confirmed: true }), /已变化/);
  assert.deepEqual(await load(paths.auth), updated);
});

test("并发切换只有一项提交，第二项必须重新确认", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { xai: oauth("a"), "xai-account-2": oauth("b"), "xai-account-3": oauth("c") });
  const initial = await service.list();
  const targets = initial.accounts.filter((a) => !a.active);
  const results = await Promise.allSettled(targets.map((a) => service.switch({ id: a.id, revision: initial.revision, confirmed: true })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await service.list()).accounts.filter((a) => a.active).length, 1);
});

test("损坏 JSON 和未知归档版本会中止，不静默覆盖", async (t) => {
  const { service, paths } = await fixture(t);
  await writeFile(paths.auth, "{BROKEN private content}");
  await assert.rejects(service.list(), (error: Error) => error.message.includes("不是有效 JSON") && !error.message.includes("private content"));
  assert.equal(await readFile(paths.auth, "utf8"), "{BROKEN private content}");
  await save(paths.auth, { xai: oauth("a") });
  await mkdir(join(paths.archive, ".."));
  await save(paths.archive, { version: 999, accounts: [] });
  await assert.rejects(service.list(), /版本不兼容/);
});

test("API Key 账号可列出切换，空凭据不可切换", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { xai: { type: "api_key", key: "fixture-xai-a" }, "xai-account-2": { type: "api_key", key: "fixture-xai-b" }, "xai-account-3": { type: "api_key" } });
  const initial = await service.list();
  assert.equal(initial.accounts.find((a) => a.slot === "xai-account-3")?.canSwitch, false);
  const target = initial.accounts.find((a) => !a.active && a.canSwitch)!;
  await service.switch({ id: target.id, revision: initial.revision, confirmed: true });
  assert.equal((await load(paths.auth)).xai.key, "fixture-xai-b");
  assert.equal(JSON.stringify(await service.list()).includes("fixture-xai"), false);
});

test("已经选中的账号是无写入幂等操作；停止插件后不切换", async (t) => {
  const { service, paths } = await fixture(t);
  await save(paths.auth, { xai: oauth("a"), "xai-account-2": oauth("b") });
  const initial = await service.list();
  const active = initial.accounts.find((a) => a.active)!;
  const bytes = await readFile(paths.auth, "utf8");
  const result = await service.switch({ id: active.id, revision: initial.revision, confirmed: true });
  assert.equal(result.backupCreated, false);
  assert.equal(await readFile(paths.auth, "utf8"), bytes);
  const lifetime = new AbortController(); lifetime.abort();
  await assert.rejects(service.switch({ id: initial.accounts.find((a) => !a.active)!.id, revision: initial.revision, confirmed: true }, lifetime.signal), /已取消/);
});

test("RPC 拒绝未确认、路径形式 ID 和无效 revision", () => {
  assert.equal(switchAccount.input.safeParse({ id: "../../auth.json", revision: "x", confirmed: true }).success, false);
  assert.equal(switchAccount.input.safeParse({ id: `codex:${"a".repeat(24)}`, revision: "a".repeat(64), confirmed: false }).success, false);
});
