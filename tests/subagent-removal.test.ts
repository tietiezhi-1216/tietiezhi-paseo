import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";

const file = (path: string) => new URL(`../${path}`, import.meta.url);
test("only native Paseo subagents are exposed; no legacy adapter or duplicate composer entrance", () => {
  const client = readFileSync(file("index.client.tsx"), "utf8");
  assert.doesNotMatch(client, /contributeSubagentPills|contributeSubagentComposer|pi-subagent-pill/);
  for (const path of ["client/subagents.tsx", "client/subagents-store.ts", "shared/subagents.ts"]) assert.equal(existsSync(file(path)), false);
  const manifest = JSON.parse(readFileSync(file("package.json"), "utf8"));
  assert.ok(manifest.pi.extensions.includes("./pi-extensions/paseo-subagents/index.ts"));
  assert.ok(manifest.pi.extensions.includes("./pi-extensions/turn-timing/index.ts"));
  const bridge = readFileSync(file("pi-extensions/paseo-subagents/index.ts"), "utf8");
  assert.match(bridge, /name: "paseo_subagent"/);
});
