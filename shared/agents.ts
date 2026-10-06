export type AgentSection = "error" | "permission" | "working" | "done" | "idle";
export const SECTION_LABELS: Record<AgentSection, string> = {
  error: "失败", permission: "等待授权", working: "工作中", done: "完成", idle: "空闲",
};
export const SECTION_ORDER: AgentSection[] = ["error", "permission", "working", "done", "idle"];
export type AgentRow = {
  serverId: string;
  id: string;
  title: string;
  workspace: string;
  workspaceId: string | null;
  provider: string;
  model: string | null;
  status: string;
  section: AgentSection;
  lastActivityAt: string | null;
  parentAgentId: string | null;
};
export type HostSummary = {
  serverId: string;
  label: string;
  status: "idle" | "connecting" | "online" | "offline" | "error";
};

export function agentKey(agent: Pick<AgentRow, "serverId" | "id">): string {
  return JSON.stringify([agent.serverId, agent.id]);
}

export function agentSection(agent: {
  status: string; requiresAttention?: boolean; attentionReason?: string | null;
}): AgentSection {
  if (agent.status === "error" || (agent.requiresAttention && agent.attentionReason === "error")) return "error";
  if (agent.requiresAttention && agent.attentionReason === "permission") return "permission";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "done";
  return "idle";
}

export function filterAgents(
  agents: readonly AgentRow[], hosts: readonly HostSummary[], query: string, serverId: string, includeChildren: boolean,
): AgentRow[] {
  const labels = new Map(hosts.map((host) => [host.serverId, host.label]));
  const needle = query.trim().toLocaleLowerCase();
  return agents.filter((agent) => (
    (!serverId || agent.serverId === serverId) &&
    (includeChildren || !agent.parentAgentId) &&
    (!needle || [agent.title, agent.id, agent.workspace, agent.provider, agent.model ?? "", labels.get(agent.serverId) ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(needle)))
  )).sort((a, b) => (
    (Date.parse(b.lastActivityAt ?? "") || 0) - (Date.parse(a.lastActivityAt ?? "") || 0) ||
    agentKey(a).localeCompare(agentKey(b))
  ));
}
