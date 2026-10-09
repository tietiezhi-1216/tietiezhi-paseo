// Native Pi resource loader + ExtensionRunner validation. No model call or credentials.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Usage: node tests/pi-timing-sdk.mjs /absolute/path/to/pi-coding-agent");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const cwd = await mkdtemp(join(tmpdir(), "pi-timing-sdk-"));
try {
  const file = resolve("pi-extensions/turn-timing/index.ts");
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: cwd,
    settingsManager: sdk.SettingsManager.inMemory({ packages: [resolve(".")] }),
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  // A personal package must load in another workspace without project approval.
  await loader.reload({ resolveProjectTrust: async () => false });
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.filter(e => e.path === file).length, 1, "Personal package discovers exactly one collector without project trust");
  const manager = sdk.SessionManager.inMemory(cwd);
  result.runtime.appendEntry = (kind, data) => manager.appendCustomEntry(kind, data);
  // This fixture never resolves a model; model registry is deliberately inert.
  const runner = new sdk.ExtensionRunner(result.extensions, result.runtime, cwd, manager, {});
  const errors = []; runner.onError(e => errors.push(e));
  await runner.emit({ type: "session_start" });
  await runner.emit({ type: "turn_start" });
  const payload = { untouched: true };
  assert.equal(await runner.emitBeforeProviderRequest(payload), payload);
  const message = { role: "assistant", timestamp: Date.now(), provider: "fixture", api: "fixture", model: "fixture", responseId: "fixture-1", stopReason: "stop" };
  await runner.emit({ type: "message_update", message, assistantMessageEvent: { type: "thinking_delta", delta: "not persisted", contentIndex: 0, partial: message } });
  assert.equal(await runner.emitMessageEnd({ type: "message_end", message }), undefined);
  await runner.emit({ type: "turn_end", message, toolResults: [] });
  assert.deepEqual(errors, []);
  const metadata = manager.getEntries().filter(e => e.type === "custom" && e.customType === "tietiezhi.response-timing");
  assert.equal(metadata.length, 1);
  assert.ok(Number.isFinite(metadata[0].data.ttftMs) && metadata[0].data.ttftMs >= 0);
  assert.equal(metadata[0].data.responseId, "fixture-1");
  assert.doesNotMatch(JSON.stringify(metadata), /not persisted/);
  await runner.emit({ type: "session_shutdown" });
  console.log("Native Pi loader/runner passed; TTFT metadata persisted without model request, payload mutation or transcript content.");
} finally { await rm(cwd, { recursive: true, force: true }); }
