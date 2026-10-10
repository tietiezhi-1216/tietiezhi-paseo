import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-agent-reference-"));
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/agents-sync.jsx")], outfile: join(temporary, "app.js"),
    bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' }, alias: { "react-native": "react-native-web" },
    plugins: [{ name: "sdk", setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/agent-reference-sdk.jsx") }));
    } }],
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  await mkdir(".artifacts/ui", { recursive: true });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByTestId("agents-pill-label").getByText("插件开发 · done · 1", { exact: true }).waitFor();
    await page.getByTestId("agents-pill").click();
    // Let the popover's 50/150 ms search-focus effects settle before a held touch.
    await page.waitForTimeout(250);
    const copy = page.getByRole("button", { name: "复制 Agent 引用 completed", exact: true });
    await copy.click();
    assert.equal(await page.evaluate(() => globalThis.__agentReferenceClipboard),
      "DEVICE: 远端 B\nHOST: b\nAGENT: completed\nTITLE: completed\nWORKSPACE: workspace");
    if (mobile) {
      const bounds = await copy.boundingBox();
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
      await page.waitForFunction(() => globalThis.__agentReferenceClipboard === "completed", null, { timeout: 3000 });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.equal(await page.evaluate(() => globalThis.__agentReferenceClipboard), "completed", "touch long press copies only the raw Agent ID");
      await session.detach();
    }
    await page.getByTestId("agents-popover-footer").waitFor();
    await page.getByRole("button", { name: "复制当前 Agent 引用", exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.__agentReferenceClipboard),
      "DEVICE: 本机 A\nHOST: a\nAGENT: current\nTITLE: 插件开发\nWORKSPACE: workspace");
    const twins = page.getByRole("button", { name: "复制 Agent 引用 shared-id", exact: true });
    assert.equal(await twins.count(), 2);
    await twins.nth(0).click();
    const first = await page.evaluate(() => globalThis.__agentReferenceClipboard);
    await twins.nth(1).click();
    const second = await page.evaluate(() => globalThis.__agentReferenceClipboard);
    assert.notEqual(first, second, "same Agent ID retains different Host identities");
    assert.ok(first.includes("HOST: a") && second.includes("HOST: b"));
    await page.screenshot({ path: `.artifacts/ui/agent-reference-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Agent reference clipboard + footer + Host isolation browser regressions passed (mock host, not native App).");
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
