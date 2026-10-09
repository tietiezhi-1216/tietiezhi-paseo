import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve("."), temp = await mkdtemp(join(tmpdir(), "tietiezhi-subagent-composer-"));
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/subagents-composer.jsx")], outfile: join(temp, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', global: "globalThis" }, alias: { "react-native": "react-native-web" }, plugins: [{ name: "sdk", setup(b) { b.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }] });
  server = createServer(async (req, res) => { res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/app.js" ? await readFile(join(temp, "app.js")) : '<meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger = page.getByTestId("composer-subagents");
  await page.waitForFunction(() => globalThis.__composer?.stats().subscriptions === 1);
  assert.equal(await trigger.count(), 0, "no child records means no capsule, including while history loads");
  await page.evaluate(() => globalThis.__composer.emit("running")); await page.waitForFunction(() => document.querySelector('[data-testid="composer-subagents"]').textContent.endsWith("子代理 · 执行中 · 1"));
  await trigger.click(); await page.getByTestId("native-subagent-row").waitFor();
  assert.equal(await page.evaluate(() => globalThis.__composer.stats().subscriptions), 1, "popover shares agent directory observation");
  assert.equal(await page.getByTestId("subagent-pill").count(), 0, "raw Pi logs are not shown in native child list");
  await page.evaluate(() => globalThis.__composer.emit("completed")); await page.waitForFunction(() => document.querySelector('[data-testid="composer-subagents"]').textContent.endsWith("子代理 · 1")); await page.getByTestId("native-subagent-row").getByText("完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "打开子代理 审查登录", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => globalThis.__composer.stats().opened), { agentId: "child" });
  await page.getByTestId("native-subagent-row").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Archived/removed children must disappear; no phantom pending Run ids.
  await page.evaluate(() => globalThis.__composer.clear());
  await trigger.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => globalThis.__composer.stats().subscriptions), 1, "hidden capsule still discovers the next child");
  await page.evaluate(() => globalThis.__composer.emit("running")); await trigger.waitFor();
  await page.evaluate(() => globalThis.__composer.stop()); await trigger.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => globalThis.__composer.stats().subscriptions), 0);
  assert.deepEqual(errors, []); console.log("Subagent composer passed: registration, live counts/status, native child conversation navigation, no raw logs, shared subscription, mobile width and teardown (mock host).");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temp, { recursive: true, force: true }); }
