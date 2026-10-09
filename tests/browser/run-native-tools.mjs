import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "tietiezhi-native-tools-"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let browser, server;
try {
  await build({
    entryPoints: [join(root, "tests/browser/main.jsx")], outfile: join(temporary, "app.js"),
    bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', global: "globalThis" },
    alias: { "react-native": "react-native-web" },
    plugins: [{ name: "sdk", setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/(react-native|ui))?$/ },
        () => ({ path: join(root, "tests/browser/sdk.jsx") }));
    } }],
  });
  server = createServer(async (request, response) => {
    if (request.url === "/app.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(await readFile(join(temporary, "app.js"))); return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(globalThis.__preview));
  const registrations = await page.evaluate(() => {
    const { transformers, renderers } = globalThis.__preview.timelineRegistrations;
    const reasoning = transformers.find(item => item.query.itemType === "reasoning");
    const assistant = transformers.find(item => item.query.itemType === "assistant_message");
    return {
      types: transformers.map(item => item.query.itemType),
      ordinaryTools: transformers.filter(item => item.query.itemType === "tool_call").map(item => item.transform({
        item: { type: "tool_call", callId: "ordinary-read", name: "Read", status: "completed", error: null, detail: { type: "read", filePath: "src/example.ts" } }, phase: "complete",
      }) ?? null),
      kinds: renderers.map(item => item.kind),
      reasoning: reasoning.transform({ item: { type: "reasoning", text: "Inspect source" }, phase: "streaming" }),
      history: reasoning.transform({ item: { type: "reasoning", text: "Inspect source" }, phase: "complete" }),
      assistant: assistant.transform({ item: { type: "assistant_message", text: "Visible reply", messageId: "reply-1" }, phase: "complete" }),
    };
  });
  assert.equal(registrations.ordinaryTools.every(output => output === null), true, "ordinary native tools must not be claimed by any specialized transformer");
  assert.equal(registrations.kinds.includes("compact-activity-group"), false, "no source-patched grouping adapter may be activated");
  assert.deepEqual(registrations.history.items, [], "completed thoughts are removed before native tool grouping");
  assert.equal(registrations.reasoning.items[0].kind, "live-thinking");
  assert.equal(registrations.reasoning.items[0].data.text, "Inspect source");
  assert.deepEqual(registrations.assistant.items[0].data, { text: "Visible reply", phase: "complete", messageId: "reply-1" });
  assert.equal(registrations.kinds.includes("assistant-reply"), true);
  await page.evaluate(() => globalThis.__preview.stopPlugin());
  assert.deepEqual(await page.evaluate(() => ({
    transformers: globalThis.__preview.timelineRegistrations.transformers.length,
    renderers: globalThis.__preview.timelineRegistrations.renderers.length,
  })), { transformers: 0, renderers: 0 });
  assert.deepEqual(errors, []);
  console.log("Native-tool passthrough passed: real plugin registration does not claim ordinary tools or activate patched grouping; only streaming reasoning displayed, replies retained; teardown clears contributions (mock host, not native Overview UI).");
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
