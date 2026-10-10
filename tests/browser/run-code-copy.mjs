import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-code-copy-"));
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/code-copy.jsx")], outfile: join(temporary, "app.js"), bundle: true,
    format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "react-native": "react-native-web" },
    plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/code-copy-sdk.jsx") })); } }],
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  await mkdir(".artifacts/ui", { recursive: true });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, hasTouch: mobile });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (mobile) await page.evaluate(() => globalThis.__codeCopy.light(true));
    const blocks = page.getByTestId("tietiezhi-markdown-code");
    assert.equal(await blocks.count(), 2);
    const first = blocks.first().getByRole("button", { name: "复制代码块", exact: true });
    await first.waitFor();
    assert.equal(await first.isVisible(), true, "visible without hover");
    if (mobile) await first.tap(); else await first.click();
    assert.equal(await page.evaluate(() => globalThis.__codeClipboard.calls.at(-1)), await page.evaluate(() => globalThis.__codeCopy.original));
    await first.getByText("已复制", { exact: true }).waitFor();
    await blocks.nth(1).getByRole("button", { name: "复制代码块", exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.__codeClipboard.calls.at(-1)), 'printf "second block"');

    await page.evaluate(() => { globalThis.__codeClipboard.mode = "fail"; });
    await first.click();
    await first.getByText("复制失败，重试", { exact: true }).waitFor();
    await page.evaluate(() => { globalThis.__codeClipboard.mode = "ok"; });
    await first.click();
    await first.getByText("已复制", { exact: true }).waitFor();

    await page.evaluate(() => { globalThis.__codeClipboard.mode = "defer"; });
    await first.click();
    await first.getByText("复制中…", { exact: true }).waitFor();
    assert.equal(await first.isDisabled(), true);
    await page.evaluate(() => globalThis.__codeCopy.source('stream changed\n  preserving new indentation'));
    await page.evaluate(() => globalThis.__codeClipboard.finish());
    await first.getByText("复制", { exact: true }).waitFor();
    assert.equal(await first.getByText("已复制", { exact: true }).count(), 0, "old copy must not claim updated text copied");
    await page.evaluate(() => { globalThis.__codeClipboard.mode = "ok"; });
    await first.click();
    assert.equal(await page.evaluate(() => globalThis.__codeClipboard.calls.at(-1)), 'stream changed\n  preserving new indentation');

    await page.evaluate(() => globalThis.__codeCopy.source('long line ' + 'abcdefghijklmnop'.repeat(80)));
    await first.getByText("复制", { exact: true }).waitFor();
    const bounds = await first.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1100), "copy stays visible for wide code");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `.artifacts/ui/code-copy-${mobile ? "mobile-light" : "desktop-dark"}.png`, fullPage: true });
    await page.evaluate(() => { globalThis.__codeClipboard.mode = "defer"; });
    await first.click();
    await page.evaluate(() => globalThis.__codeCopy.shown(false));
    await page.evaluate(() => globalThis.__codeClipboard.finish());
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Code-block copy passed: exact text, multiple blocks, touch, failure/retry, streaming, overflow and teardown (mock clipboard).");
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
