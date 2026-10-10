import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-links-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/main.jsx")], outfile: join(temporary, "app.js"), bundle: true,
    format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!globalThis.__preview);
  await page.evaluate(() => {
    globalThis.__testOpenExternalUrls = true;
    globalThis.__preview.showReply({ text: "[源码与安装包](https://example.com/tietiezhi-link-test)", phase: "complete" });
  });
  const link = page.getByRole("link", { name: "源码与安装包" });
  await link.waitFor();
  assert.equal(await link.evaluate(el => el.tagName), "A");
  assert.equal(await link.getAttribute("href"), "https://example.com/tietiezhi-link-test");
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  assert.notEqual(await link.evaluate(el => getComputedStyle(el).color), await link.evaluate(el => getComputedStyle(el.parentElement).color), "links must be distinguishable from body text");
  await page.context().route("https://example.com/tietiezhi-link-test", route => route.fulfill({ contentType: "text/html", body: "Link destination" }));
  const chatUrl = page.url();
  for (const mode of ["click", "middle", "modified", "keyboard"]) {
    const opened = page.context().waitForEvent("page");
    if (mode === "keyboard") { await link.focus(); await page.keyboard.press("Enter"); }
    else await link.click(mode === "middle" ? { button: "middle" } : mode === "modified" ? { modifiers: [process.platform === "darwin" ? "Meta" : "Control"] } : {});
    const tab = await opened;
    await tab.waitForURL("https://example.com/tietiezhi-link-test");
    assert.equal(page.url(), chatUrl);
    assert.equal(await tab.evaluate(() => window.opener === null), true);
    await tab.close();
  }
  assert.equal(await page.evaluate(() => globalThis.__preview.calls.filter(call => call.kind === "external").length), 3, "plain click, modified click and Enter use host opener; middle uses native anchor");
  assert.deepEqual(errors, []);
  console.log("Markdown links passed: real anchors, click/modified/middle/Enter open new tabs without leaving chat; noopener. Paseo opener is mocked, not a real Electron test.");
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
