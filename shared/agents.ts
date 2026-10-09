import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

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

// ---------------- SlotGame Agents Pill Protocol ----------------

export const AgentHostSchema = z.object({
  id: z.string(),
  name: z.string(),
  target: z.string(),
  password: z.string(),
  workspace: z.string().optional(),
  serverId: z.string().min(1).optional(),
});
export const AgentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed", "offline"]);

export function buildAgentRoute(serverId: string | null | undefined, agentId: string | null | undefined): string | null {
  const host = typeof serverId === "string" ? serverId.trim() : "";
  const agent = typeof agentId === "string" ? agentId.trim() : "";
  if (!host || !agent) return null;
  return `/h/${encodeURIComponent(host)}/agent/${encodeURIComponent(agent)}`;
}

export function buildAgentDeepLink(serverId: string | null | undefined, agentId: string | null | undefined): string | null {
  const route = buildAgentRoute(serverId, agentId);
  return route ? `paseo://${route.slice(1)}` : null;
}

export function buildAgentWorkspaceRoute(
  serverId: string | null | undefined,
  workspaceId: string | null | undefined,
  agentId: string | null | undefined,
): string | null {
  const host = typeof serverId === "string" ? serverId.trim() : "";
  const workspace = typeof workspaceId === "string" ? workspaceId.trim() : "";
  const agent = typeof agentId === "string" ? agentId.trim() : "";
  if (!host || !workspace || !agent) return null;
  return `/h/${encodeURIComponent(host)}/workspace/${encodeURIComponent(workspace)}?open=${encodeURIComponent(`agent:${agent}`)}`;
}

export const AGENT_NAVIGATION_EVENT = "paseo:web-notification-click";
export type AgentNavigationTarget = { serverId: string; workspaceId: string; agentId: string };
export type AgentNavigationEnvironment = {
  platform: "ios" | "android" | "web";
  currentServerId: string;
  navigation?: { openAgent(input: { agentId: string; serverId?: string }): void };
  dispatchWebTarget?: (target: AgentNavigationTarget) => boolean;
  nativeLinking?: {
    emit(event: string, payload: { url: string }): void;
    listenerCount(event: string): number;
  };
};

export function prepareAgentNavigation(
  agent: { serverId: string | null; workspaceId: string | null; id: string },
  environment: AgentNavigationEnvironment,
): () => void {
  const serverId = agent.serverId?.trim();
  const agentId = agent.id.trim();
  if (!serverId || !agentId) throw new Error("缺少 Agent 的主机信息，请刷新列表后重试。");
  const navigation = environment.navigation;
  if (navigation) {
    return () => navigation.openAgent(serverId === environment.currentServerId
      ? { agentId }
      : { agentId, serverId });
  }
  const workspaceId = agent.workspaceId?.trim();
  if (environment.platform === "web") {
    const dispatch = environment.dispatchWebTarget;
    if (!workspaceId || !dispatch) throw new Error("当前客户端暂不能在应用内打开此 Agent，请检查 Host 连接或更新 Paseo。");
    return () => {
      if (!dispatch({ serverId, workspaceId, agentId })) {
        throw new Error("Paseo 导航尚未就绪，请稍后重试。未打开外部页面。");
      }
    };
  }
  const linking = environment.nativeLinking;
  if (!linking || linking.listenerCount("url") === 0) {
    throw new Error("Paseo 手机端导航尚未就绪，请稍后重试或更新客户端。");
  }
  const route = buildAgentWorkspaceRoute(serverId, workspaceId, agentId) ?? buildAgentRoute(serverId, agentId)!;
  return () => {
    if (linking.listenerCount("url") === 0) throw new Error("Paseo 手机端导航已断开，请重新打开面板。");
    linking.emit("url", { url: `paseo://${route.slice(1)}` });
  };
}

export function resolveHostServerId(
  connected: string | null | undefined,
  configured: string | null | undefined,
): string | null {
  const live = typeof connected === "string" ? connected.trim() : "";
  if (live) return live;
  const fallback = typeof configured === "string" ? configured.trim() : "";
  return fallback || null;
}

export function isAgentOnServer(
  agent: { serverId: string | null | undefined },
  serverId: string | null | undefined,
): boolean {
  return typeof serverId === "string" && serverId.length > 0 && agent.serverId === serverId;
}

export const AGENT_ACTIVITY_QUERY_KEY = "slotgame-agent-activity";

export function agentIdClipboardText(id: string): string {
  return `AGENT: ${id.trim()}`;
}

export function paseoAgentIdClipboardText(id: string): string {
  return `Paseo Agent ID: ${id.trim()}`;
}

export const RemoteAgentSchema = z.object({
  hostId: z.string(),
  hostName: z.string(),
  serverId: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  status: AgentStatusSchema,
  requiresAttention: z.boolean(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lastUserMessageAt: z.string().nullable(),
  workspaceId: z.string().nullable(),
  workspace: z.string().nullable(),
  archivedAt: z.string().nullable(),
  parentAgentId: z.string().nullable(),
});
export type RemoteAgent = z.infer<typeof RemoteAgentSchema>;
export type AgentDisplaySection = "error" | "working" | "done" | "idle" | "closed" | "archived";

export function agentMatchesQuery(
  agent: Pick<RemoteAgent, "id" | "name" | "hostName" | "hostId">,
  workspace: string,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [agent.name, workspace, agent.id, agent.hostName, agent.hostId].some((value) => value.toLowerCase().includes(needle));
}

export function parentAgentIdFromLabels(labels: Record<string, string> | null | undefined): string | null {
  const value = labels?.["paseo.parent-agent-id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isListedAgent(agent: { archivedAt?: string | null; parentAgentId?: string | null }): boolean {
  return !agent.archivedAt && !agent.parentAgentId;
}

export function isDisplayableAgent(agent: { parentAgentId?: string | null }): boolean {
  return !agent.parentAgentId;
}

export function mergeAgentSnapshot<T extends { attentionReason?: "finished" | "error" | "permission" | null; status?: string | null }>(base: T, live?: Partial<T>): T {
  if (!live) return base;
  const merged = { ...base, ...live };
  if (base.attentionReason === "finished" && !live.attentionReason && live.status !== "running" && live.status !== "error" && live.status !== "initializing") {
    merged.attentionReason = "finished";
  }
  return merged;
}

export function agentActivityAt(agent: { lastUserMessageAt?: string | null; createdAt?: string | null; updatedAt?: string | null }): string | null {
  return agent.lastUserMessageAt ?? agent.createdAt ?? agent.updatedAt ?? null;
}

export const ARCHIVED_DATE_GROUPS = ["今天", "昨天", "本周", "本月", "更早"] as const;
export type DateBucket = typeof ARCHIVED_DATE_GROUPS[number];

export function getAgentDateBucket(
  agent: { archivedAt?: string | null; lastUserMessageAt?: string | null; createdAt?: string | null; updatedAt?: string | null },
  now = Date.now(),
): DateBucket {
  const timeStr = agent.archivedAt || agent.lastUserMessageAt || agent.updatedAt || agent.createdAt;
  const timestamp = timeStr ? Date.parse(timeStr) : 0;
  if (!timestamp || !Number.isFinite(timestamp)) return "更早";

  const nowDate = new Date(now);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  if (timestamp >= todayStart) return "今天";

  const yesterdayStart = todayStart - 86_400_000;
  if (timestamp >= yesterdayStart) return "昨天";

  const dayOfWeek = (nowDate.getDay() + 6) % 7;
  const thisWeekStart = todayStart - dayOfWeek * 86_400_000;
  if (timestamp >= thisWeekStart) return "本周";

  const thisMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  if (timestamp >= thisMonthStart) return "本月";

  return "更早";
}

export function combineOwnedAgents(owned: RemoteAgent[], borrowed: RemoteAgent[], currentServerId?: string | null): RemoteAgent[] {
  const ownedListed = owned.filter((agent) => isDisplayableAgent(agent));
  const key = (agent: RemoteAgent) => JSON.stringify([agent.serverId ?? agent.hostId, agent.id]);
  const seen = new Set(ownedListed.map(key));
  return [
    ...ownedListed,
    ...borrowed.filter((agent) => {
      if (!isDisplayableAgent(agent) || isAgentOnServer(agent, currentServerId) || seen.has(key(agent))) return false;
      seen.add(key(agent));
      return true;
    }),
  ];
}

export function agentDisplaySection(
  agent: Pick<RemoteAgent, "status" | "attentionReason" | "archivedAt">,
): AgentDisplaySection | null {
  if (agent.archivedAt) return "archived";
  if (!isListedAgent(agent)) return null;
  if (agent.status === "error") return "error";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.status !== "closed" && agent.attentionReason === "finished") return "done";
  if (agent.status === "closed") return "closed";
  if (agent.status === "idle") return "idle";
  return null;
}

export function resolveReloadHost<T extends { id: string; serverId?: string | null }>(
  hosts: readonly T[],
  input: { hostId?: string | null; serverId?: string | null },
): T | null {
  const hostId = input.hostId?.trim();
  if (hostId) {
    const byId = hosts.find((host) => host.id === hostId);
    if (byId) return byId;
  }
  const serverId = input.serverId?.trim();
  if (!serverId) return null;
  return hosts.find((host) => host.serverId === serverId) ?? null;
}

export const agentReload = defineRpc({
  name: "slotgame.agent.reload",
  input: z.object({
    currentHost: z.boolean().default(false),
    hostId: z.string().default(""),
    serverId: z.string().nullable().optional(),
    agentId: z.string().min(1),
    password: z.string().optional(),
    target: z.string().optional(),
    savePassword: z.boolean().optional(),
  }),
  output: z.object({
    agentId: z.string(),
    hostId: z.string().default(""),
  }),
});

export const agentArchive = defineRpc({
  name: "slotgame.agent.archive",
  input: z.object({
    hostId: z.string().default(""),
    serverId: z.string().nullable().optional(),
    agentId: z.string().min(1),
  }),
  output: z.object({
    agentId: z.string(),
    archived: z.boolean(),
  }),
});

export const agentUnarchive = defineRpc({
  name: "slotgame.agent.unarchive",
  input: z.object({
    hostId: z.string().default(""),
    serverId: z.string().nullable().optional(),
    agentId: z.string().min(1),
  }),
  output: z.object({
    agentId: z.string(),
    unarchived: z.boolean(),
  }),
});

export const agentActivity = defineRpc({
  name: "slotgame.agent.activity",
  input: z.object({ refresh: z.boolean().optional() }),
  output: z.object({
    agents: z.array(RemoteAgentSchema).max(500),
    hosts: z.array(z.object({ id: z.string(), name: z.string(), serverId: z.string().nullable(), online: z.boolean() })).max(32),
    fetchedAt: z.string(),
  }),
});
