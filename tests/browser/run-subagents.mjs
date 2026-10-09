import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve("."), temp = await mkdtemp(join(tmpdir(), "tietiezhi-subagents-"));
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/subagents.jsx")], outfile: join(temp, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', global: "globalThis" }, alias: { "react-native": "react-native-web" }, plugins: [{ name: "sdk", setup(b) { b.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }] });
  server = createServer(async (req, res) => { res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : "text/html; charset=utf-8"); res.end(req.url === "/app.js" ? await readFile(join(temp, "app.js")) : '<meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const width of [1024, 390]) for (const light of [false, true]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(v => globalThis.__subagents.light(v), light);
    const pill = page.getByTestId("subagent-pill");
    await pill.getByRole("button").click(); await pill.getByText("Run · run-123").waitFor(); await pill.getByText("真实工具输出").waitFor();
    await pill.getByRole("button").click();
    for (const [state, label] of [["submitted", "已提交 · 后台"], ["done", "完成"], ["canceled", "已取消"], ["failed", "失败"], ["running", "执行中"]]) {
      await page.evaluate(v => globalThis.__subagents.state(v), state);
      await pill.getByRole("button", { name: new RegExp(label.replace("·", "·")) }).waitFor();
      if (state === "failed") await pill.getByRole("alert").getByText("运行失败").waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("Subagent capsule UI passed: dark/light, desktop/mobile, expand/collapse, async submitted state, visible failures.");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temp, { recursive: true, force: true }); }
