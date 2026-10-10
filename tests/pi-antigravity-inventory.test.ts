import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PI_ANTIGRAVITY_INVENTORY_SCRIPT } from "../shared/pi-antigravity-inventory.ts";
const execute = promisify(execFile);

test("fixed Pi inventory checks configured package and accounts without exporting credentials or modifying files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tietiezhi-pi-inventory-"));
  try {
    const pi = join(root, "pi"), paseo = join(root, "paseo");
    await mkdir(join(pi, "npm", "node_modules", "pi-antigravity"), { recursive: true });
    await mkdir(join(pi, "extensions"), { recursive: true });
    await mkdir(join(paseo, "tietiezhi"), { recursive: true });
    const oauth = (email: string) => ({ type: "oauth", email, access: "SECRET_ACCESS", refresh: "SECRET_REFRESH", expires: 1 });
    const fixtures = [
      [join(pi, "settings.json"), { packages: ["npm:pi-antigravity", "npm:unrelated"] }],
      [join(pi, "npm", "node_modules", "pi-antigravity", "package.json"), { name: "pi-antigravity", version: "0.10.0" }],
      [join(pi, "auth.json"), { antigravity: oauth("live@example.test"), "antigravity-account-other": oauth("other@example.test"), "openai-codex": { type: "api_key", key: "SECRET_KEY" } }],
      [join(paseo, "config.json"), { agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: pi } } } } }],
      [join(paseo, "tietiezhi", "accounts.json"), { version: 1, accounts: [{ slot: "antigravity", credential: oauth("live@example.test") }] }],
    ] as const;
    for (const [path, value] of fixtures) await writeFile(path, JSON.stringify(value));
    await writeFile(join(pi, "extensions", "antigravity-extra.ts"), "throw Error('must never load extension');");
    const env: NodeJS.ProcessEnv = { ...process.env, PASEO_HOME: paseo, PI_CODING_AGENT_DIR: join(root, "wrong") };
    delete env.TIETIEZHI_PI_AGENT_DIR;
    const { stdout } = await execute(process.execPath, ["-e", PI_ANTIGRAVITY_INVENTORY_SCRIPT], { env });
    const result = JSON.parse(stdout);
    assert.equal(result.piDirectory, pi, "daemon-configured Pi directory wins");
    assert.equal(result.plugin.configured, true); assert.equal(result.plugin.installed, true);
    assert.equal(result.plugin.version, "0.10.0");
    assert.equal(result.accountCount, 2, "archive and live duplicate deduplicated");
    assert.deepEqual(result.accounts.find((a: any) => a.active), { email: "liv***@example.test", authType: "oauth", complete: true, active: true });
    for (const value of ["SECRET_ACCESS", "SECRET_REFRESH", "SECRET_KEY", "live@example.test"]) assert.equal(stdout.includes(value), false);
    for (const [path, value] of fixtures) assert.equal(await readFile(path, "utf8"), JSON.stringify(value));
  } finally { await rm(root, { recursive: true, force: true }); }
});
