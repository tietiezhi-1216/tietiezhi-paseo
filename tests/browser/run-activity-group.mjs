import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const source = process.env.PASEO_ACTIVITY_SOURCE;
if (!source) throw new Error("Set PASEO_ACTIVITY_SOURCE to the patched Paseo v0.11.0 source copy.");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-group-ui-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/activity-group.jsx")], outfile: join(temporary, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } }, define: { "process.env.NODE_ENV": '"development"', global: "globalThis" }, alias: { "react-native": "react-native-web", "@": join(source, "packages/app/src"), "markdown-it": join(source, "node_modules/markdown-it/dist/markdown-it.js"), "@paseo-prototype/presentation": join(source, "packages/app/src/agent-stream/presentation.ts") }, plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }] });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", error => errors.push(String(error)));
  for (const viewport of [{ width: 1100, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto(`http://127.0.0.1:${server.address().port}`);
    const group = page.getByTestId("tietiezhi-activity-group"); await group.waitFor();
    assert.equal(await page.getByTestId("host-frame").count(), 3, "two prose frames plus one activity frame, no placeholders");
    assert.deepEqual(await page.evaluate(() => ({ sources: globalThis.__group.sourceCount, rows: globalThis.__group.rowCount })), { sources: 52, rows: 3 });
    assert.match(await group.innerText(), /25 次工具调用.*25 段思考/s);
    assert.equal(await group.getByTestId("tietiezhi-compact-tool").count(), 0);
    const [firstBody, nextBody] = await Promise.all([page.getByText("正文一", { exact: true }).boundingBox(), page.getByText("正文二", { exact: true }).boundingBox()]);
    assert.ok(nextBody.y - firstBody.y < 120, "collapsed activities must not leave source-row spacing");
    await page.getByTestId("tietiezhi-running-sweep-glyph").first().waitFor();
    await group.getByRole("button", { name: "展开执行过程（执行中）", exact: true }).click();
    assert.equal(await group.getByTestId("tietiezhi-compact-tool").count(), 25);
    assert.equal(await group.getByTestId("tietiezhi-compact-reasoning").count(), 25);
    await page.evaluate(() => globalThis.__group.fail());
    await group.getByText("1 次失败", { exact: true }).waitFor();
    await group.getByText("permission denied", { exact: true }).waitFor();
    assert.equal(await group.getByRole("button", { name: "收起执行过程", exact: true }).count(), 1, "live updates preserve expansion");
    await group.getByRole("button", { name: "收起执行过程", exact: true }).click();
    await page.getByTestId("tietiezhi-running-sweep").waitFor({ state: "hidden" });
    assert.equal(await page.getByTestId("host-frame").count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir(join(root, ".artifacts/ui"), { recursive: true });
    await page.screenshot({ path: join(root, `.artifacts/ui/grouped-activities-${viewport.width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log("Activity group UI passed: real patched Paseo presentation pipeline, 50 activities -> 1 frame, no accumulated gaps, expandable details, live failure/sweep updates and desktop/mobile widths. Viewport shell is a fixture, not the installed App.");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true }); }
