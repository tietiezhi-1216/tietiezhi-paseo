import { useEffect, useRef } from "react";
import { getPaseoClient, useRpc } from "@getpaseo/plugin/client";
import type { HostSummary } from "../shared/agents.ts";
import { pendingAgentProbes, reportAgentProbe, type ProbeHostResult } from "../shared/agent-probe.ts";
import { probeConnectedHosts } from "./agent-probe-lookup.ts";
import { createForkOperationId } from "../shared/fork.ts";
import { pendingTerminalProbes, claimTerminalProbe, reportTerminalProbe, type TerminalProbeRequest, type TerminalProbeResult } from "../shared/terminal-probe.ts";
import { runTerminalProbe } from "./terminal-probe.ts";

type WorkerSource = () => {
  hosts: readonly HostSummary[];
  pending: (input: Record<string, never>) => Promise<{ requests: { requestId: string; agentId: string; serverId?: string }[] }>;
  report: (input: { requestId: string; hosts: ProbeHostResult[] }) => Promise<{ accepted: boolean }>;
  terminalPending: (input: Record<string, never>) => Promise<{ requests: TerminalProbeRequest[] }>;
  terminalClaim: (input: { requestId: string; claimant: string }) => Promise<{ accepted: boolean }>;
  terminalReport: (input: { claimant: string; result: TerminalProbeResult }) => Promise<{ accepted: boolean }>;
};
const workers = new Map<string, { sources: Set<WorkerSource>; stop: () => void }>();

/** Service the daemon queue while the native Agents pill is mounted; one worker per source Host. */
export function useAgentProbeWorker(sourceHostId: string, hosts: readonly HostSummary[]) {
  const pending = useRpc(pendingAgentProbes);
  const report = useRpc(reportAgentProbe);
  const terminalPending = useRpc(pendingTerminalProbes);
  const terminalClaim = useRpc(claimTerminalProbe);
  const terminalReport = useRpc(reportTerminalProbe);
  const latest = useRef({ hosts, pending, report, terminalPending, terminalClaim, terminalReport });
  latest.current = { hosts, pending, report, terminalPending, terminalClaim, terminalReport };
  useEffect(() => {
    const source: WorkerSource = () => latest.current;
    let worker = workers.get(sourceHostId);
    if (!worker) {
      const sources = new Set<WorkerSource>();
      const lifetime = new AbortController();
      let busy = false;
      const seen = new Set<string>();
      const claimant = createForkOperationId();
      const tick = async () => {
        if (busy || lifetime.signal.aborted) return;
        busy = true;
        try {
          const currentSource = [...sources][0];
          if (!currentSource) return;
          const { requests } = await currentSource().pending({});
          const active = new Set(requests.map(job => job.requestId));
          for (const id of seen) if (!active.has(id)) seen.delete(id);
          for (const job of requests) {
            if (lifetime.signal.aborted || seen.has(job.requestId)) continue;
            const results = await probeConnectedHosts(currentSource().hosts, job.agentId, getPaseoClient, lifetime.signal, job.serverId);
            if (lifetime.signal.aborted) break;
            await currentSource().report({ requestId: job.requestId, hosts: results });
            seen.add(job.requestId);
          }
          if (lifetime.signal.aborted) return;
          const terminalJobs = await currentSource().terminalPending({});
          for (const job of terminalJobs.requests) {
            if (lifetime.signal.aborted) break;
            if (!currentSource().hosts.some(host => host.serverId === job.serverId && host.status === "online")) continue;
            const claimed = await currentSource().terminalClaim({ requestId: job.requestId, claimant });
            if (!claimed.accepted) continue;
            const result = await runTerminalProbe(job, getPaseoClient, lifetime.signal);
            await currentSource().terminalReport({ claimant, result });
          }
        } catch { /* Disconnected source Host: retry without falling back to another daemon. */ }
        finally { busy = false; }
      };
      const timer = setInterval(() => { void tick(); }, 2_000);
      worker = { sources, stop() { lifetime.abort(); clearInterval(timer); } };
      workers.set(sourceHostId, worker);
      void Promise.resolve().then(tick);
    }
    const owned = worker;
    owned.sources.add(source);
    return () => {
      owned.sources.delete(source);
      if (owned.sources.size === 0) {
        owned.stop();
        if (workers.get(sourceHostId) === owned) workers.delete(sourceHostId);
      }
    };
  }, [sourceHostId]);
}
