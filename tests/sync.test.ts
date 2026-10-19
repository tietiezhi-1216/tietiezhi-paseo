import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountService } from "../server/accounts.ts";
import { SyncService, encryptPayload, decryptPayload } from "../server/sync.ts";

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "tietiezhi-sync-test-"));
  const pi = join(root, "pi");
  const paseo = join(root, "paseo");
  await mkdir(pi, { recursive: true });
  await mkdir(join(paseo, "tietiezhi"), { recursive: true });

  const paths = {
    auth: join(pi, "auth.json"),
    archive: join(paseo, "tietiezhi", "accounts.json"),
    legacy: [],
    backups: join(paseo, "tietiezhi", "backups"),
  };

  await writeFile(paths.auth, JSON.stringify({
    antigravity: {
      type: "oauth",
      access: "token-ag-live-1",
      refresh: "refresh-ag-1",
      expires: 1000,
      projectId: "project-1",
      email: "user1@example.com",
    },
    "openai-codex": {
      type: "oauth",
      access: "token-codex-live-1",
      refresh: "refresh-codex-1",
      expires: 2000,
      email: "user1@example.com",
    },
  }, null, 2));

  await writeFile(paths.archive, JSON.stringify({
    version: 1,
    accounts: [
      {
        id: "antigravity:user1",
        family: "antigravity",
        slot: "antigravity",
        label: "user1@example.com",
        credential: {
          type: "oauth",
          access: "token-ag-live-1",
          refresh: "refresh-ag-1",
          expires: 1000,
          projectId: "project-1",
          email: "user1@example.com",
        },
      },
    ],
  }, null, 2));

  await writeFile(join(pi, "models.json"), JSON.stringify({
    providers: {
      antigravity: {
        modelOverrides: {
          "gemini-3.8-flash": { name: "Gemini 3.8 Flash (Custom)" },
        },
      },
    },
  }, null, 2));

  await writeFile(join(pi, "settings.json"), JSON.stringify({
    packages: ["npm:pi-antigravity@0.10.0"],
  }, null, 2));

  await writeFile(join(paseo, "config.json"), JSON.stringify({
    agents: {
      providers: {
        pi: {
          env: {
            HTTP_PROXY: "http://127.0.0.1:12334",
            HTTPS_PROXY: "http://127.0.0.1:12334",
          },
        },
      },
    },
  }, null, 2));

  const accountSvc = new AccountService(paths);
  const syncSvc = new SyncService(() => accountSvc, () => pi, () => paseo);

  return {
    root,
    pi,
    paseo,
    paths,
    accountSvc,
    syncSvc,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("加解密算法在密码一致时正确还原，错误密码抛出清晰异常", () => {
  const secretData = JSON.stringify({ hello: "world", numbers: [1, 2, 3] });
  const { encrypted, payload } = encryptPayload(secretData, "super-password-123");
  assert.equal(encrypted, true);

  const decrypted = decryptPayload(payload, "super-password-123");
  assert.equal(decrypted, secretData);

  assert.throws(() => decryptPayload(payload, "wrong-password"), /解密失败/);
  assert.throws(() => decryptPayload(payload, ""), /已加密/);

  // 明文测试
  const plain = encryptPayload(secretData);
  assert.equal(plain.encrypted, false);
  assert.equal(decryptPayload(plain.payload), secretData);
});

test("exportBundle 能够完整导出账号凭据、Pi models.json、扩展列表与可选代理配置", async () => {
  const f = await createFixture();
  try {
    const exported = await f.syncSvc.exportBundle({
      options: {
        includeAccounts: true,
        includePiPackages: true,
        includeModelOverrides: true,
        includePaseoProxy: true,
      },
      password: "test-password",
    });

    assert.equal(exported.encrypted, true);
    assert.equal(exported.summary.accountCount >= 1, true);
    assert.equal(exported.summary.hasPiPackages, true);
    assert.equal(exported.summary.hasModelOverrides, true);
    assert.equal(exported.summary.hasPaseoProxy, true);

    const decrypted = JSON.parse(decryptPayload(exported.payload, "test-password"));
    assert.equal(decrypted.version, 1);
    assert.ok(Array.isArray(decrypted.accounts));
    assert.ok(decrypted.accounts.some((a: any) => a.family === "antigravity" && a.credential.email === "user1@example.com"));
    assert.ok(decrypted.piConfig.packages.includes("npm:pi-antigravity@0.10.0"));
    assert.equal(decrypted.piConfig.modelsJson.providers.antigravity.modelOverrides["gemini-3.8-flash"].name, "Gemini 3.8 Flash (Custom)");
    assert.equal(decrypted.paseoConfig.piEnv.HTTP_PROXY, "http://127.0.0.1:12334");
  } finally {
    await f.cleanup();
  }
});

test("importBundle 能够安全合并远端账号，并在目标设备空缺时自动激活主槽位", async () => {
  const fSource = await createFixture();
  const fTarget = await createFixture();
  try {
    // Target 机器清空 auth.json，只保留空对象
    await writeFile(fTarget.paths.auth, "{}\n");
    await writeFile(fTarget.paths.archive, JSON.stringify({ version: 1, accounts: [] }));

    // Source 导出带密码的数据
    const exported = await fSource.syncSvc.exportBundle({ password: "sync-key-456" });

    // Target 导入
    const importRes = await fTarget.syncSvc.importBundle({
      payload: exported.payload,
      password: "sync-key-456",
      confirmed: true,
      strategy: "merge",
    });

    assert.equal(importRes.success, true);
    assert.ok(importRes.importedAccounts >= 1);

    // 验证 Target 机器 accounts.json 写入成功
    const targetAccounts = JSON.parse(await readFile(fTarget.paths.archive, "utf8"));
    assert.equal(targetAccounts.version, 1);
    assert.ok(targetAccounts.accounts.length >= 1);
    assert.ok(targetAccounts.accounts.some((a: any) => a.credential.email === "user1@example.com"));

    // 验证由于 Target 原本 auth.json 空白，已自动将导入的有效账号激活写入 auth.json
    const targetAuth = JSON.parse(await readFile(fTarget.paths.auth, "utf8"));
    assert.equal(targetAuth.antigravity.email, "user1@example.com");
    assert.equal(targetAuth.antigravity.access, "token-ag-live-1");
  } finally {
    await fSource.cleanup();
    await fTarget.cleanup();
  }
});

test("importBundle 未确认或密码错误时拒绝执行，不产生任何副作用", async () => {
  const f = await createFixture();
  try {
    const exported = await f.syncSvc.exportBundle({ password: "secret" });

    await assert.rejects(
      f.syncSvc.importBundle({
        payload: exported.payload,
        password: "wrong",
        confirmed: true,
      }),
      /解密失败/,
    );

    // @ts-expect-error test unconfirmed
    await assert.rejects(f.syncSvc.importBundle({ payload: exported.payload, confirmed: false }), /确认/);
  } finally {
    await f.cleanup();
  }
});
