import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { resolveLoginModulePath } from "../server/login-module.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("源码运行时从当前模块解析 Codex/xAI 登录文件", async () => {
  for (const family of ["codex", "xai"] as const) {
    const file = await resolveLoginModulePath(family, { moduleUrl: import.meta.url });
    assert.match(file, family === "codex" ? /openai-codex\.js$/ : /xai\.js$/);
    assert.equal((await readFile(file, "utf8")).includes(family === "codex" ? "openaiCodexOAuth" : "xaiOAuth"), true);
  }
});

test("Paseo CJS 包没有 import.meta 时，从插件安装目录解析，不调用 import.meta.resolve", async () => {
  const bundled = await build({
    entryPoints: [join(root, "server/login-module.ts")],
    bundle: true, format: "cjs", platform: "node", target: "node20", write: false, logLevel: "silent",
  });
  const code = bundled.outputFiles[0]!.text;
  assert.match(code, /var import_meta = \{\}/);
  assert.doesNotMatch(code, /import_meta\.resolve|import\.meta\.resolve/);
  const home = await mkdtemp(join(tmpdir(), "tietiezhi-login-"));
  const previous = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  try {
    await writeFile(join(home, "config.json"), JSON.stringify({ plugins: { tietiezhi: { path: root } } }));
    const exported = new Function("require", "module", "exports", `${code}\nreturn module.exports;`)(require, { exports: {} }, {});
    const file = await exported.resolveLoginModulePath("codex");
    assert.match(file, /openai-codex\.js$/);
    await assert.rejects(exported.resolveLoginModulePath("codex", { moduleUrl: "file:///missing.mjs", pluginDirectory: home }), /缺少登录依赖/);
  } finally {
    if (previous === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("登录实现不再使用会被 Paseo 编译清空的 import.meta.resolve", async () => {
  const source = await readFile(join(root, "server/login.ts"), "utf8");
  assert.doesNotMatch(source, /import\.meta\.resolve/);
});
