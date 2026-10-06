import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { LoginService, loadLoginFlow, type OAuthFlow } from "../server/login.ts";
import { LoginStateSchema } from "../shared/login.ts";

const credential = { type: "oauth", access: "fixture-secret-access", refresh: "fixture-secret-refresh", expires: 2e12 };
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await setImmediate(); }
  assert.ok(condition(), "状态未到达");
}
test("设备码登录仅返回公开状态，完成保存但不选择账号", async () => {
  const saved: unknown[] = [];
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const service = new LoginService({
    load: async () => ({ async login(input) {
      assert.equal(await input.prompt({ type: "select", options: [{ id: "browser" }, { id: "device_code" }] }), "device_code");
      input.notify({ type: "device_code", verificationUri: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" });
      await gate; return credential;
    } }),
    save: async (family, value) => { saved.push([family, value]); },
  });
  const initial = service.begin("codex", true);
  await until(() => service.status(initial.id).status === "waiting");
  const pending = LoginStateSchema.parse(service.status(initial.id));
  assert.equal(pending.userCode, "ABCD-EFGH");
  assert.equal(JSON.stringify(pending).includes("fixture-secret"), false);
  assert.equal(saved.length, 0);
  assert.throws(() => service.begin("xai", true), /已有登录流程/);
  finish();
  await until(() => service.status(initial.id).status === "done");
  assert.deepEqual(saved, [["codex", credential]]);
  assert.equal(service.status(initial.id).url, null);
  assert.equal(service.status(initial.id).userCode, null);
  await service.dispose();
});
test("取消与停止拒绝迟到授权，不保存凭据；未知 ID 与未确认登录被拒绝", async () => {
  let finish!: () => void, saved = 0;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const service = new LoginService({
    load: async () => ({ async login(input) {
      input.notify({ type: "device_code", verificationUri: "https://auth.x.ai/device", userCode: "FIXTURE" });
      await gate; return credential;
    } }),
    save: async () => { saved++; },
  });
  assert.throws(() => service.begin("xai", false as true), /确认/);
  const initial = service.begin("xai", true);
  await until(() => service.status(initial.id).status === "waiting");
  assert.throws(() => service.status("unknown"), /失效/);
  assert.equal(service.cancel(initial.id).status, "cancelled");
  finish(); await service.dispose();
  assert.equal(saved, 0);
  assert.throws(() => service.begin("xai", true), /停止/);
});
test("拒绝非官方验证页，错误不回传原始秘密", async () => {
  for (const url of ["http://auth.openai.com/device", "https://evil.invalid/device", "https://fixture-secret@auth.openai.com/device"]) {
    const service = new LoginService({
      load: async () => ({ async login(input) { input.notify({ type: "device_code", verificationUri: url, userCode: "FIXTURE" }); return credential; } }),
      save: async () => { assert.fail("不可保存"); },
    });
    const state = service.begin("codex", true);
    await until(() => service.status(state.id).status === "error");
    assert.equal(JSON.stringify(service.status(state.id)).includes("fixture-secret"), false);
    await service.dispose();
  }
});
test("官方 OAuth 模块可加载，不启动登录或网络请求", async () => {
  for (const family of ["codex", "xai"] as const) {
    const flow: OAuthFlow = await loadLoginFlow(family);
    assert.equal(typeof flow.login, "function");
  }
});
test("停止正在等待的设备码流程，取消定时器和凭据保存", async () => {
  let saved = false;
  const service = new LoginService({
    load: async () => ({ async login(input) {
      await new Promise<void>((_resolve, reject) => {
        if (input.signal.aborted) { reject(new Error("cancel")); return; }
        input.signal.addEventListener("abort", () => reject(new Error("fixture-secret")), { once: true });
      });
      return credential;
    } }),
    save: async () => { saved = true; },
  });
  service.begin("codex", true);
  await setImmediate();
  await service.dispose();
  assert.equal(saved, false);
});
