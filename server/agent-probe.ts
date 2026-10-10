import { randomUUID } from "node:crypto";
import type { ProbeHostResult } from "../shared/agent-probe.ts";

/** Short-lived, metadata-only requests. No network credentials or messages cross this bridge. */
export function createAgentProbeBroker(now = Date.now) {
  const jobs = new Map<string, { agentId: string; expires: number; hosts: Map<string, ProbeHostResult> }>();
  function prune() {
    for (const [id, job] of jobs) if (job.expires + 60_000 <= now()) jobs.delete(id);
  }
  return {
    request(agentId: string) {
      prune();
      if (jobs.size >= 64 || [...jobs.values()].filter(j => j.expires > now()).length >= 16) throw Error("只读查询过多，请稍后重试");
      const requestId = randomUUID();
      jobs.set(requestId, { agentId, expires: now() + 20_000, hosts: new Map() });
      return { requestId };
    },
    pending() {
      prune();
      return { requests: [...jobs.entries()].filter(([, j]) => j.expires > now() && ![...j.hosts.values()].some(h => h.state === "found"))
        .map(([requestId, j]) => ({ requestId, agentId: j.agentId })) };
    },
    report(requestId: string, hosts: ProbeHostResult[]) {
      const job = jobs.get(requestId);
      if (!job || job.expires <= now()) return { accepted: false };
      for (const host of hosts) {
        if ((host.state === "found") !== Boolean(host.agent) || (host.agent && host.agent.id !== job.agentId)) throw Error("查询回复身份不匹配");
      }
      if (new Set([...job.hosts.keys(), ...hosts.map(h => h.serverId)]).size > 64) throw Error("查询回复设备过多");
      for (const host of hosts) {
        const previous = job.hosts.get(host.serverId);
        if (previous?.state === "found") continue;
        if (previous?.state === "not_found" && ["offline", "error"].includes(host.state)) continue;
        job.hosts.set(host.serverId, host);
      }
      return { accepted: true };
    },
    collect(requestId: string) {
      prune();
      const job = jobs.get(requestId);
      if (!job) throw Error("查询已清理或不存在");
      const hosts = [...job.hosts.values()];
      return { requestId, agentId: job.agentId,
        state: hosts.some(h => h.state === "found") ? "found" as const : job.expires <= now() ? "expired" as const : "pending" as const, hosts };
    },
    dispose() { jobs.clear(); },
  };
}
