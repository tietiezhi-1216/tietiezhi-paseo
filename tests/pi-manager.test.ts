import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiPackageSource, piPackageChange } from "../shared/pi-manager.ts";
import { PiManager, npmPackageName } from "../server/pi-manager.ts";

test("Pi npm sources reject paths, shell fragments and option injection", () => {
  for (const source of ["npm:pi-foo@1.2.3", "npm:@scope/foo@latest", "npm:foo"]) assert.equal(PiPackageSource.safeParse(source).success, true);
  for (const source of ["--all", "npm:foo;echo secret", "npm:../foo", "npm:foo --force", "https://github.com/foo/bar", "npm:foo\nbar"]) assert.equal(PiPackageSource.safeParse(source).success, false);
  assert.equal(npmPackageName("npm:@scope/foo@1.2.3"), "@scope/foo");
  assert.equal(npmPackageName("npm:foo"), "foo");
  assert.equal(piPackageChange.input.safeParse({ operation: "remove", source: "npm:foo", revision: "a".repeat(64), confirmed: false }).success, false);
});

test("Pi inventory is host-local, reports actual versions; changes require matching revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-manager-"));
  try {
    await mkdir(join(dir, "npm/node_modules/foo"), { recursive: true });
    await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:foo@1.0.0", "./local-package"] }));
    await writeFile(join(dir, "npm/node_modules/foo/package.json"), JSON.stringify({ version: "1.0.0" }));
    const calls: { args: string[]; cwd?: string }[] = [];
    const run = async (_command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ args, cwd: options.cwd });
      return { stdout: "1.0.0", stderr: "" };
    };
    const manager = new PiManager(() => dir, run as never);
    const inventory = await manager.inventory();
    assert.equal(inventory.version, "1.0.0");
    assert.equal(inventory.packages[0].version, "1.0.0");
    assert.equal(inventory.packages[1].managed, false);
    await assert.rejects(manager.change({ operation: "remove", source: "npm:foo@1.0.0", revision: "0".repeat(64), confirmed: true }), /配置已变更/);
    assert.equal(calls.some((call) => call.args[0] === "remove"), false);
    await manager.change({ operation: "remove", source: "npm:foo@1.0.0", revision: inventory.revision, confirmed: true });
    assert.deepEqual(calls.find((call) => call.args[0] === "remove")?.args, ["remove", "npm:foo@1.0.0", "--no-approve"]);
    assert.ok(calls.every((call) => call.cwd === dir));

    await manager.change({ operation: "update-pi", revision: inventory.revision, confirmed: true });
    assert.deepEqual(calls.find((call) => call.args[0] === "update" && call.args[1] === "pi")?.args, ["update", "pi"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
