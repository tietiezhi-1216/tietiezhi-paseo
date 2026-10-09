import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-fork-ui-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({ entryPoints: [join(root, "tests/browser/fork.jsx")], outfile: join(temporary, "app.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "react-native": "react-native-web" }, plugins: [{ name: "sdk", setup(builder) { builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ }, () => ({ path: join(root, "tests/browser/sdk.jsx") })); } }] });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(join(temporary, "app.js"))); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end('<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const fork = page.getByRole("button", { name: "分叉回复", exact: true });
  for (const target of ["tab", "workspace"]) {
    const buttonBox = await fork.boundingBox();
    await fork.click();
    const menu = page.getByTestId("tietiezhi-fork-menu");
    await menu.waitFor();
    assert.equal(await page.getByRole("textbox", { name: "分叉后的第一条任务" }).count(), 0);
    assert.equal(await page.getByText("从选中的回复分叉", { exact: true }).count(), 0);
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox.width <= 140, "destination menu must not reserve prompt-sized width");
    assert.ok(menuBox.height <= 80, "two compact destination rows should fit within 80px");
    assert.ok(Math.abs(buttonBox.x - menuBox.x) < 20, "menu must anchor beside the footer button");
    assert.ok(menuBox.y > buttonBox.y, "menu must open below the button on a wide viewport");
    await page.getByRole("button", { name: target === "tab" ? "分叉到新标签页" : "分叉到新工作区", exact: true }).click();
    await page.getByRole("textbox", { name: "分叉后的第一条任务" }).fill("continue task");
    const promptBox = await menu.boundingBox();
    assert.ok(promptBox.width >= 240 && promptBox.width <= 280, "only the task form gets the wider layout");
    await page.getByRole("button", { name: "确认分叉并开始任务", exact: true }).click();
    await page.getByTestId("tietiezhi-fork-menu").waitFor({ state: "hidden" });
    const call = await page.evaluate(() => globalThis.__fork.calls.filter(c => c.kind === "fork").at(-1));
    assert.equal(call.input.target, target); assert.equal(call.input.recordId, "record"); assert.equal(call.input.replyAt, 1000); assert.equal(call.input.serverId, "host");
    assert.deepEqual(await page.evaluate(() => globalThis.__fork.calls.filter(c => c.kind === "navigate").at(-1).input), { agentId: "created", serverId: "host", workspaceId: target === "tab" ? "original" : "new-workspace" });
  }
  await page.evaluate(() => globalThis.__fork.fail(true));
  await fork.click();
  await page.getByRole("button", { name: "分叉到新标签页", exact: true }).click();
  await page.getByRole("textbox", { name: "分叉后的第一条任务" }).fill("continue");
  await page.getByRole("button", { name: "确认分叉并开始任务" }).click();
  await page.getByText("测试分叉失败", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭分叉菜单" }).click({ position: { x: 2, y: 2 } });
  await page.evaluate(() => { globalThis.__fork.fail(false); globalThis.__fork.navigationFails(true); });
  await fork.click(); await page.getByRole("textbox", { name: "分叉后的第一条任务" }).fill("continue");
  await page.getByRole("button", { name: "确认分叉并开始任务" }).click();
  await page.getByText("分叉已创建，自动打开失败；可点击下方重试打开。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "确认分叉并开始任务", exact: true }).count(), 0);
  // A footer near the bottom must flip upward by its real height, not a fixed reservation.
  await page.goto(`http://127.0.0.1:${server.address().port}/?bottom`);
  const bottomButton = await fork.boundingBox();
  await fork.click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="分叉回复"]').getBoundingClientRect();
    const menu = document.querySelector('[data-testid="tietiezhi-fork-menu"]')?.getBoundingClientRect();
    return menu && Math.abs(button.top - menu.bottom - 6) < 2;
  });
  let menuBox = await page.getByTestId("tietiezhi-fork-menu").boundingBox();
  assert.ok(menuBox.y < bottomButton.y);
  assert.ok(Math.abs(bottomButton.y - menuBox.y - menuBox.height - 6) < 2, "upward menu must hug the button");
  await mkdir(join(root, ".artifacts/ui"), { recursive: true });
  await page.screenshot({ path: join(root, ".artifacts/ui/compact-fork-menu-desktop.png") });
  await page.getByRole("button", { name: "分叉到新工作区", exact: true }).click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="分叉回复"]').getBoundingClientRect();
    const menu = document.querySelector('[data-testid="tietiezhi-fork-menu"]').getBoundingClientRect();
    return menu.height > 150 && Math.abs(button.top - menu.bottom - 6) < 2;
  });
  menuBox = await page.getByTestId("tietiezhi-fork-menu").boundingBox();
  assert.ok(Math.abs(bottomButton.y - menuBox.y - menuBox.height - 6) < 2, "expanded menu must remain anchored");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${server.address().port}/?bottom`);
  await fork.click();
  const mobileMenu = await page.getByTestId("tietiezhi-fork-menu").boundingBox();
  assert.ok(mobileMenu.width <= 140);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(root, ".artifacts/ui/compact-fork-menu-mobile.png") });
  assert.deepEqual(errors, []);
  console.log("Fork UI passed: compact destination and prompt widths, desktop/mobile, anchored dropdown, no new panel, two destinations, exact boundary inputs, explicit prompt, outside-dismiss, errors, duplicate-creation guard and measured upward positioning (mock backend).");
} finally { await browser?.close(); if (server) await new Promise(done => server.close(done)); await rm(temporary, { recursive: true, force: true }); }
