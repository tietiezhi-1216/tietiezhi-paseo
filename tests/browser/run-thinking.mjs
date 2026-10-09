import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-thinking-ui-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/thinking.jsx")], outfile: join(temporary, "app.js"), bundle: true,
    format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', global: "globalThis" },
    alias: { "react-native": "react-native-web" }, plugins: [{ name: "sdk", setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") }));
    } }],
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const row = page.getByTestId("tietiezhi-live-thinking");
  await row.getByText("Inspect source", { exact: true }).waitFor();
  assert.equal(await row.getByRole("button").count(), 0);
  assert.ok((await row.boundingBox()).height <= 24);
  const original = await row.elementHandle();
  await page.evaluate(() => globalThis.__thinking.text("**Testing files**\n\nOther body"));
  await row.getByText("Testing files", { exact: true }).waitFor();
  assert.equal(await row.count(), 1);
  assert.equal(await original.evaluate(node => node.isConnected), true, "update the mounted row, not an accumulated record");
  assert.equal(await row.getByText("Inspect source", { exact: true }).count(), 0);
  assert.equal(await row.getByText("Other body", { exact: false }).count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await row.getByTestId("tietiezhi-running-sweep-glyph").first().waitFor();
  await page.evaluate(() => globalThis.__thinking.phase("complete"));
  await row.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => globalThis.__thinking.project("Old thinking", "complete")), { items: [] });
  await page.evaluate(() => { globalThis.__thinking.text("New thought"); globalThis.__thinking.phase("streaming"); });
  await row.waitFor(); assert.equal(await row.count(), 1);
  await page.evaluate(() => globalThis.__thinking.toggle());
  assert.equal((await page.evaluate(() => globalThis.__thinking.project("Full thought", "complete"))).items[0].kind, "compact-reasoning");
  await page.evaluate(() => globalThis.__thinking.toggle());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => globalThis.__thinking.light(true));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(join(root, ".artifacts/ui"), { recursive: true });
  await page.screenshot({ path: join(root, ".artifacts/ui/thinking-live-mobile.png") });
  await page.evaluate(() => globalThis.__thinking.teardown());
  assert.equal(await page.evaluate(() => globalThis.__thinking.count()), 0);
  assert.equal(await row.count(), 0);
  assert.deepEqual(errors, []);
  console.log("Live thinking preview passed: one updating text row, no controls or history, complete-phase filtering, glyph sweep, reduced motion, mobile/light and teardown (mock host phase transitions).");
} finally {
  await browser?.close(); if (server) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
