import { randomUUID } from "node:crypto";
import type { TerminalProbeResult } from "../shared/terminal-probe.ts";

/** Fixed benign diagnostics only; at-most-once claim, never an arbitrary remote-shell gateway. */
export function createTerminalProbeBroker(now = Date.now) {
  const jobs = new Map<string, { result: TerminalProbeResult; claimant?: string; expires: number }>();
  const prune = () => { for (const [id, j] of jobs) if (j.expires + 60_000 <= now()) jobs.delete(id); };
  return {
    request(serverId: string, workspaceId: string, kind?: "system" | "pi-antigravity") {
      prune();
      if (jobs.size >= 16 || [...jobs.values()].filter(j => j.expires > now()).length >= 8) throw Error("终端测试过多");
      const requestId = randomUUID();
      jobs.set(requestId, { expires: now() + 30_000, result: {
        requestId, serverId, workspaceId, ...(kind ? { kind } : {}), state: "pending", terminalId: null,
        existingTerminals: [], output: "", cleanedUp: false, error: null,
      } });
      return { requestId };
    },
    pending() {
      prune();
      return { requests: [...jobs.values()].filter(j => !j.claimant && j.expires > now()).map(({ result: r }) => ({
        requestId: r.requestId, serverId: r.serverId, workspaceId: r.workspaceId, ...(r.kind ? { kind: r.kind } : {}),
      })) };
    },
    claim(requestId: string, claimant: string) {
      const j = jobs.get(requestId);
      if (!j || j.claimant || j.expires <= now()) return { accepted: false };
      j.claimant = claimant; j.result.state = "running";
      return { accepted: true };
    },
    report(claimant: string, result: TerminalProbeResult) {
      const j = jobs.get(result.requestId);
      if (!j || j.claimant !== claimant) return { accepted: false };
      if (j.result.serverId !== result.serverId || j.result.workspaceId !== result.workspaceId || j.result.kind !== result.kind) throw Error("终端测试设备或工作区不匹配");
      if (!["completed", "failed"].includes(result.state) || ["completed", "failed"].includes(j.result.state)) return { accepted: false };
      j.result = result;
      return { accepted: true };
    },
    collect(requestId: string) {
      prune(); const j = jobs.get(requestId);
      if (!j) throw Error("终端测试不存在或已清理");
      return j.expires <= now() && ["pending", "running"].includes(j.result.state) ? { ...j.result, state: "expired" as const } : j.result;
    },
    dispose() { jobs.clear(); },
  };
}
