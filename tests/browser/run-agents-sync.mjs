import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-agents-sync-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/agents-sync.jsx")], outfile: join(temporary, "app.js"), bundle: true,
    format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "react-native": "react-native-web" },
    plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/agents-sync-sdk.jsx") })); } }],
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (mobile) await page.evaluate(() => globalThis.__agentsSync.light(true));
    const label = page.getByTestId("agents-pill-label");
    const pill = page.getByTestId("agents-pill");
    async function matches(done, working) {
      const expected = done > 0 ? `done · ${done}` : `working · ${working}`;
      await label.getByText(expected, { exact: true }).waitFor();
      await page.getByTestId("agents-section-working").getByText(`working · ${working}`, { exact: true }).waitFor();
      if (done) await page.getByTestId("agents-section-done").getByText(`done · ${done}`, { exact: true }).waitFor();
      else assert.equal(await page.getByTestId("agents-section-done").count(), 0);
      const color = await page.getByTestId("agents-pill-status-dot").evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(color, done ? "rgb(86, 170, 136)" : "rgb(170, 136, 68)");
      assert.equal(await label.innerText(), expected, "No session-name prefix or unrelated local-only count");
    }
    // CLOSED popover: connected Host's done must already drive both label and dot.
    await label.getByText("done · 1", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.__agentsSync.calls.filter(call => call.kind === "direct-rpc").length), 0);
    await pill.click(); await matches(1, 6);
    await page.evaluate(() => globalThis.__agentsSync.unrelatedRemoval("a", "a3"));
    await matches(1, 6);
    await page.evaluate(() => globalThis.__agentsSync.emit("b", "completed", "running"));
    await matches(0, 7);
    await page.evaluate(() => { globalThis.__agentsSync.emit("a", "a2", "idle", "finished"); globalThis.__agentsSync.emit("b", "new-done", "idle", "finished"); });
    await matches(2, 6);
    await page.evaluate(() => globalThis.__agentsSync.archive("a", "a2"));
    await matches(1, 6);
    // Switch Hosts with an old list in flight. A newer done event must survive it.
    await page.evaluate(() => { globalThis.__agentsSync.gateList("a"); globalThis.__agentsSync.setHost("b"); });
    await page.waitForFunction(() => typeof globalThis.__agentsSync.releaseList === "function");
    await label.getByText("done · 1", { exact: true }).waitFor();
    await pill.click(); await matches(1, 6);
    await page.evaluate(() => globalThis.__agentsSync.emit("a", "shared-id", "idle", "finished"));
    await matches(2, 5);
    await page.evaluate(() => globalThis.__agentsSync.releaseList());
    await matches(2, 5);
    // The previous Host's late configured RPC contains a phantom done.
    // It must never leak into the next Host's cache or text.
    await page.evaluate(() => { globalThis.__agentsSync.gateRpc(); void globalThis.__agentsSync.refresh(); });
    await page.waitForFunction(() => typeof globalThis.__agentsSync.releaseRpc === "function");
    await page.evaluate(() => globalThis.__agentsSync.setHost("a"));
    await label.getByText("done · 2", { exact: true }).waitFor();
    await pill.click(); await matches(2, 5);
    await page.evaluate(() => globalThis.__agentsSync.releaseRpc());
    await matches(2, 5);
    await mkdir(join(root, ".artifacts/ui"), { recursive: true });
    await page.screenshot({ path: join(root, `.artifacts/ui/agents-sync-${mobile ? "mobile-light" : "desktop-dark"}.png`) });
    await page.evaluate(() => globalThis.__agentsSync.stop());
    await pill.waitFor({ state: "hidden" });
    await page.waitForFunction(() => Object.values(globalThis.__agentsSync.watcherCounts()).every(count => count === 0));
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Agents sync UI passed: actual pill registration + rendered icon/popover, same-source done/working counts, duplicate Host IDs, children/archive exclusion, scoped live events, unrelated-filter removal isolation, late list/RPC protection, Host switch, closed-popover updates, desktop/mobile, subscription cleanup (mock APIs).");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true }); }
