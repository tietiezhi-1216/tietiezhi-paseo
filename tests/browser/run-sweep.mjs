import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-sweep-ui-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/sweep.jsx")], outfile: join(temporary, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', global: "globalThis" }, alias: { "react-native": "react-native-web" }, plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }] });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage(); const errors = []; page.on("pageerror", error => { errors.push(String(error)); console.error(String(error)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const band = page.getByTestId("tietiezhi-running-sweep-glyph").first();
  const tool = page.getByTestId("tietiezhi-compact-tool");
  for (const light of [false, true]) {
    await page.emulateMedia({ reducedMotion: "no-preference" }); await page.goto(url);
    await page.evaluate(value => globalThis.__sweep.light(value), light);
    await band.waitFor();
    const before = await tool.boundingBox();
    assert.equal(await page.getByText("执行中", { exact: true }).count(), 0);
    assert.equal(await tool.getByRole("button").getAttribute("aria-busy"), "true");
    const color = await band.evaluate(node => getComputedStyle(node).color);
    await page.waitForFunction(old => {
      const node = document.querySelector('[data-testid="tietiezhi-running-sweep-glyph"]');
      return node && getComputedStyle(node).color !== old;
    }, color);
    assert.equal(await tool.evaluate(node => [...node.querySelectorAll('*')].every(child => {
      const style = getComputedStyle(child);
      return style.backgroundImage === 'none' && ['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
    })), true, "only glyph colors may animate, never a row or text background");
    await tool.getByRole("button").click();
    await tool.getByText(/"command": "inspect project"/).waitFor();
    await tool.getByRole("button").click();
    await page.evaluate(() => globalThis.__sweep.status("completed"));
    await band.waitFor({ state: "hidden" });
    const after = await tool.boundingBox();
    assert.equal(before.height, after.height, "sweep must not change row height");
    assert.equal(await tool.getByRole("button").getAttribute("aria-busy"), "false");
    await page.evaluate(() => globalThis.__sweep.status("running")); await band.waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("tietiezhi-running-static").waitFor();
    assert.equal(await band.count(), 0, "reduced motion disables the animation");
    await page.emulateMedia({ reducedMotion: "no-preference" }); await band.waitFor();
    await page.evaluate(() => globalThis.__sweep.status("failed"));
    await page.getByTestId("tietiezhi-running-sweep").waitFor({ state: "hidden" });
    await tool.getByText("失败", { exact: true }).waitFor();
    await tool.getByRole("button", { name: "展开工具 codemode", exact: true }).click();
    await tool.getByText("failure detail", { exact: true }).waitFor();
  }
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(url);
  await page.getByTestId("tietiezhi-running-static").waitFor(); assert.equal(await band.count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await band.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="tietiezhi-running-sweep"]');
    const base = getComputedStyle(root).color;
    const baseRed = Number(base.match(/\d+/)[0]);
    return [...root.querySelectorAll('[data-testid="tietiezhi-running-sweep-glyph"]')].some(node => {
      const red = Number(getComputedStyle(node).color.match(/\d+/)[0]);
      return node.textContent.trim() && red - baseRed > 50 && node.getBoundingClientRect().left > 80 && node.getBoundingClientRect().left < 220;
    });
  });
  await mkdir(join(root, ".artifacts/ui"), { recursive: true });
  await page.screenshot({ path: join(root, ".artifacts/ui/running-sweep-mobile.png") });
  assert.deepEqual(errors, []);
  console.log("Running sweep UI passed: animated glyph colors with transparent backgrounds, dark/light, stable row height, clickable details, completion/failure teardown, reduced motion and mobile width (mock host).");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true }); }
