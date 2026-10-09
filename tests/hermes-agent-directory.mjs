import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const platformDirectory = { darwin: "osx-bin", linux: "linux64-bin", win32: "win64-bin" }[process.platform];
const hermes = process.env.HERMES_BIN ?? resolve(`node_modules/react-native/sdks/hermesc/${platformDirectory}/hermes${process.platform === "win32" ? ".exe" : ""}`);
const directory = mkdtempSync(join(tmpdir(), "tietiezhi-hermes-"));
try {
  const result = await build({
    stdin: { contents: `
      import { createAgentDirectory } from "./shared/agents-directory.ts";
      function check(condition, label) { if (!condition) throw Error(label); }
      const directory = createAgentDirectory();
      const other = createAgentDirectory();
      const row = { id: "same", name: "same", status: "running", archivedAt: null, parentAgentId: null };
      directory.replace("a", [row]);
      directory.replace("b", [row]);
      check(directory.get("a").agents[0].serverId === "a", "host a identity");
      check(directory.get("b").agents[0].serverId === "b", "host b identity");
      check(other.get("a").agents.length === 0, "independent directory");
      const snapshot = directory.get("a");
      check(directory.get("a") === snapshot, "stable snapshot");
      const revision = directory.revision("a");
      directory.patch("a", "same", { status: "idle" });
      directory.replace("a", [row], revision);
      check(directory.get("a").agents[0].status === "idle", "stale list preserves event");
      directory.upsert("a", { ...row, id: "child", parentAgentId: "same" });
      check(directory.get("a").agents.length === 1, "native child excluded");
      const { getVersion, subscribeAll } = directory;
      let notifications = 0;
      const stop = subscribeAll(() => { notifications++; });
      const before = getVersion();
      directory.archive("a", "same", "2026-10-09T00:00:00Z");
      check(getVersion() === before + 1 && notifications === 1, "detached subscriptions");
      stop();
      directory.fail("b");
      check(notifications === 1 && directory.get("b").failed, "teardown and failure");
      print("hermes directory regression passed");
    `, resolveDir: process.cwd(), sourcefile: "hermes-agent-directory.ts", loader: "ts" },
    bundle: true, write: false, platform: "neutral", target: "es2017", format: "iife",
  });
  const file = join(directory, "eval.js");
  // Match Paseo's loader: evaluate the untransformed bundle, not Metro/Babel output.
  writeFileSync(file, `(0, eval)(${JSON.stringify(result.outputFiles[0].text)});`);
  const execution = spawnSync(hermes, [file], { encoding: "utf8", timeout: 15_000 });
  if (execution.error) throw execution.error;
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /hermes directory regression passed/);
  console.log(execution.stdout.trim());
} finally {
  rmSync(directory, { recursive: true, force: true });
}
