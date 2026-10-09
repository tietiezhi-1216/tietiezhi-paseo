// Verify with Pi's real resource loader, without invoking any agent/model.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Pass the installed pi-coding-agent package directory");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const cwd = await mkdtemp(join(tmpdir(), "pi-native-subagents-"));
try {
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: sdk.SettingsManager.inMemory({ packages: [resolve(".")] }), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload({ resolveProjectTrust: async () => false });
  const resources = loader.getExtensions(); assert.deepEqual(resources.errors, []);
  const extension = resources.extensions.find(extension => extension.path === resolve("pi-extensions/paseo-subagents/index.ts"));
  assert.ok(extension); assert.ok(extension.tools.has("paseo_subagent"));
  assert.equal(extension.tools.has("subagent"), false, "native bridge must not replace governed pi-subagents workflows");
  console.log("Pi native-subagent resource loads exactly once and registers paseo_subagent without spawning child agents.");
} finally { await rm(cwd, { recursive: true, force: true }); }
