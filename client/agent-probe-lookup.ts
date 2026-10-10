import type { HostSummary } from "../shared/agents.ts";
import type { ProbeHostResult } from "../shared/agent-probe.ts";

type LookupApi = {
  agents: { list(options: { filter: { includeArchived: boolean }; page: { limit: number; cursor?: string } }): Promise<{
    entries: Array<{ agent: { id: string; title?: string | null; provider: string; status: string; model?: string | null; workspaceId?: string | null } }>;
    pageInfo: { hasMore: boolean; nextCursor?: string | null };
  }> };
};

/** Read native metadata only; no refresh/resume, timeline fetch, prompt, or provider request. */
export async function probeConnectedHosts(hosts: readonly HostSummary[], agentId: string, getApi: (id: string) => LookupApi, signal: AbortSignal, serverId?: string): Promise<ProbeHostResult[]> {
  const targets = serverId ? hosts.filter(host => host.serverId === serverId) : hosts;
  if (serverId && targets.length === 0) return [{ serverId, label: serverId, state: "offline", agent: null }];
  return Promise.all(targets.slice(0, 64).map(async host => {
    const base = { serverId: host.serverId, label: host.label.slice(0, 200), agent: null };
    if (host.status !== "online") return { ...base, state: "offline" as const };
    try {
      const api = getApi(host.serverId);
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 100; page++) {
        if (signal.aborted) throw Error("cancelled");
        const result = await api.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
        const agent = result.entries.find(entry => entry.agent.id === agentId)?.agent;
        if (agent) return { ...base, state: "found" as const, agent: {
          id: agent.id, title: agent.title ?? null, provider: agent.provider, status: agent.status,
          model: agent.model ?? null, workspaceId: agent.workspaceId ?? null,
        } };
        if (!result.pageInfo.hasMore) return { ...base, state: "not_found" as const };
        const next = result.pageInfo.nextCursor;
        if (!next || seen.has(next)) throw Error("invalid cursor");
        seen.add(next); cursor = next;
      }
      throw Error("page limit");
    } catch { return { ...base, state: "error" as const }; }
  }));
}

