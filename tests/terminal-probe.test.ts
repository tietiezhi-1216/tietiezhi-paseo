import assert from "node:assert/strict";
import { test } from "node:test";
import { createTerminalProbeBroker } from "../server/terminal-probe.ts";
import { runTerminalProbe } from "../client/terminal-probe.ts";
import { TerminalProbeResultSchema } from "../shared/terminal-probe.ts";

const job = { requestId: "00000000-0000-4000-8000-000000000001", serverId: "remote", workspaceId: "workspace" };
function fixture() {
  const calls: any[] = [];
  let written = "", captures = 0;
  const terminal = {
    id: "owned", current: () => ({ id: "owned", workspaceId: "workspace", name: "test", cwd: "/repo" }),
    write(data: string) { calls.push(["write", "owned", data]); written = data; return data.length; },
    async capture() {
      captures++; calls.push(["capture", "owned"]);
      return { terminalId: "owned", requestId: "capture", totalLines: 5, lines: captures === 1 ? [written] : [
        `TIETIEZHI-BEGIN:${job.requestId}`, "macmini-worker-1", "Darwin", "/repo", `TIETIEZHI-END:${job.requestId}`,
      ] };
    },
  };
  const api = { terminals: {
    async list(options: unknown) { calls.push(["list", options]); return { entries: [{ id: "existing", workspaceId: "workspace" }], requestId: "list" }; },
    async create(options: unknown) { calls.push(["create", options]); return terminal; },
    ref(id: string) { return { async kill() { calls.push(["kill", id]); } }; },
  } };
  return { api, terminal, calls };
}

test("remote terminal diagnostic creates/writes/captures/cleans only its own terminal", async () => {
  const f = fixture();
  const result = await runTerminalProbe(job, id => { assert.equal(id, "remote"); return f.api as any; }, new AbortController().signal);
  assert.equal(result.state, "completed");
  assert.equal(result.cleanedUp, true);
  assert.equal(result.output, "macmini-worker-1\nDarwin\n/repo");
  assert.deepEqual(result.existingTerminals, ["existing"]);
  assert.equal(TerminalProbeResultSchema.safeParse(result).success, true);
  assert.deepEqual(f.calls.filter(call => call[0] === "kill"), [["kill", "owned"]]);
  assert.equal(f.calls.filter(call => call[0] === "capture").length, 2, "echoed command is not execution evidence");
  assert.deepEqual(f.calls.find(call => call[0] === "create")[1].args, ["/dev/stdin"], "non-interactive shell avoids user startup/history hooks");
  const input = f.calls.find(call => call[0] === "write")[2];
  assert.match(input, /\/bin\/hostname; \/usr\/bin\/uname -s; \/bin\/pwd/);
  assert.match(input, /\/bin\/sleep 45; exit/);
});

test("input failure still cleans its newly created terminal; existing terminal never touched", async () => {
  const f = fixture(); f.terminal.write = () => { throw Error("transport sensitive error"); };
  const result = await runTerminalProbe(job, () => f.api as any, new AbortController().signal);
  assert.equal(result.state, "failed"); assert.equal(result.cleanedUp, true);
  assert.deepEqual(f.calls.filter(call => call[0] === "kill"), [["kill", "owned"]]);
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
});

test("an existing terminal returned by create is never written or killed", async () => {
  const f = fixture(); f.terminal.id = "existing";
  const result = await runTerminalProbe(job, () => f.api as any, new AbortController().signal);
  assert.equal(result.state, "failed");
  assert.equal(f.calls.some(call => ["write", "kill"].includes(call[0])), false);
});

test("broker permits only one App claimant and rejects different Host or workspace", () => {
  const b = createTerminalProbeBroker(); const { requestId } = b.request("remote", "workspace");
  assert.equal(b.claim(requestId, "one").accepted, true);
  assert.equal(b.claim(requestId, "one").accepted, false);
  assert.equal(b.claim(requestId, "two").accepted, false);
  assert.deepEqual(b.pending().requests, []);
  const result = { ...b.collect(requestId), state: "completed" as const, terminalId: "owned", cleanedUp: true };
  assert.equal(b.report("two", result).accepted, false);
  assert.throws(() => b.report("one", { ...result, serverId: "other" }));
  assert.throws(() => b.report("one", { ...result, workspaceId: "other" }));
  assert.equal(b.report("one", result).accepted, true);
  assert.equal(b.report("one", result).accepted, false);
});

test("expired jobs do not retry a terminal creation and teardown clears pending requests", () => {
  let now = 0; const b = createTerminalProbeBroker(() => now);
  const { requestId } = b.request("remote", "workspace"); now = 30_000;
  assert.equal(b.collect(requestId).state, "expired");
  assert.equal(b.claim(requestId, "one").accepted, false);
  assert.deepEqual(b.pending().requests, []);
  b.dispose(); assert.throws(() => b.collect(requestId));
});
