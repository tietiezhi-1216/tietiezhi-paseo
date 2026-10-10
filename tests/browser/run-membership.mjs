import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-membership-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/membership.jsx")], outfile: join(temporary, "app.js"), bundle: true,
    format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "react-native": "react-native-web" },
    plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }],
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
    await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-09T12:01:00Z"));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (mobile) await page.evaluate(() => globalThis.__membership.light(true));
    const hours = page.getByTestId("membership-expiry-hours");
    await hours.getByText("会员记录 3小时20分后到期", { exact: true }).waitFor();
    await page.getByTestId("membership-expiry-days").getByText("会员记录 13天4小时后到期", { exact: true }).waitFor();
    await page.getByTestId("membership-expiry-soon").getByText("会员记录 不到1分钟后到期", { exact: true }).waitFor();
    await page.getByTestId("membership-expiry-past").getByText("会员日期已过 · 待核实", { exact: true }).waitFor();
    assert.match(await page.getByTestId("membership-expiry-past").getAttribute("aria-label"), /当前会员状态尚未核实/);
    assert.equal(await page.getByTestId("membership-expiry-missing").count(), 0);
    await page.getByTestId("membership-expiry-ag").getByText(/会员记录 3小时20分后到期/).waitFor();
    assert.match(await page.getByTestId("membership-card-hours").innerText(), /重置 \(/);
    assert.doesNotMatch(await page.locator("main").innerText(), /到期到期|会员已到期|需登录/);
    assert.equal(await hours.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, "长小时/分钟记录不被窄布局裁切");
    // Advance without a provider query or unrelated React update; verify the actual boundary, not the next 30s tick.
    await page.clock.runFor(39_999);
    await page.getByTestId("membership-expiry-soon").getByText("会员记录 不到1分钟后到期", { exact: true }).waitFor();
    await page.clock.runFor(2);
    await page.getByTestId("membership-expiry-soon").getByText("会员日期已过 · 待核实", { exact: true }).waitFor();
    await page.clock.runFor(24_999);
    await hours.getByText("会员记录 3小时19分后到期", { exact: true }).waitFor();
    await page.getByTestId("membership-expiry-soon").getByText("会员日期已过 · 待核实", { exact: true }).waitFor();
    await page.evaluate(() => globalThis.__membership.renew());
    await hours.getByText("会员记录 2小时后到期", { exact: true }).waitFor();
    // Narrow layouts must wrap rather than ellipsize the membership countdown.
    const geometry = await hours.evaluate(el => ({ clipped: el.scrollWidth > el.clientWidth + 1, ellipsis: getComputedStyle(el).textOverflow }));
    assert.equal(geometry.clipped, false); assert.notEqual(geometry.ellipsis, "ellipsis");
    await mkdir(join(root, ".artifacts/ui"), { recursive: true });
    await page.screenshot({ path: join(root, `.artifacts/ui/membership-${mobile ? "mobile-light" : "desktop-dark"}.png`) });
    await page.evaluate(() => globalThis.__membership.stop());
    await hours.waitFor({ state: "hidden" });
    await page.waitForFunction(() => globalThis.__membership.timers() === 0);
    await page.clock.runFor(60_000);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Membership UI passed: actual quota details, hour/minute live countdown, precise expiry boundary, saved-date provenance, historical expiry is unverified, grouped/flat/missing records, token/weekly-reset separation, record renewal, no narrow-screen ellipsis and timer cleanup (mock metadata).");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true }); }
