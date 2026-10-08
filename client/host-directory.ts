import { agentSection, type AgentRow } from "../shared/agents.ts";

export interface HostAgentsApi {
  agents: {
    list(options: {
      scope?: string;
      filter?: { includeArchived?: boolean };
      page?: { limit?: number; cursor?: string };
    }): Promise<{
      entries: Array<{
        agent: {
          id: string;
          title?: string | null;
          status: string;
          provider: string;
          model?: string | null;
          runtimeInfo?: { model?: string | null } | null;
          archivedAt?: string | null;
          updatedAt?: string | null;
          lastUserMessageAt?: string | null;
          workspaceId?: string | null;
          requiresAttention?: boolean;
          attentionReason?: string | null;
          labels?: Record<string, string>;
        };
        project?: { workspaceName?: string | null } | null;
      }>;
      pageInfo: { hasMore?: boolean; nextCursor?: string | null };
    }>;
    ref(id: string): {
      send(text: string, options?: { messageId?: string; activeTurnBehavior?: string }): Promise<void>;
    };
  };
}

export type GetHostApi = (serverId: string) => HostAgentsApi;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("读取已取消");
}

/** Plain lists only: no persistent observation, socket, or credential copies. */
export async function readHostAgents(getApi: GetHostApi, serverId: string, signal?: AbortSignal): Promise<AgentRow[]> {
  checkAbort(signal);
  const api = getApi(serverId);
  const rows = new Map<string, AgentRow>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    checkAbort(signal);
    const result = await api.agents.list({
      scope: "active",
      filter: { includeArchived: false },
      page: { limit: 200, cursor },
    });
    checkAbort(signal);
    for (const { agent, project } of result.entries) {
      if (agent.archivedAt || agent.status === "closed") continue;
      rows.set(agent.id, {
        serverId,
        id: agent.id,
        title: agent.title ?? agent.id,
        workspace: project?.workspaceName ?? "",
        workspaceId: agent.workspaceId ?? null,
        provider: agent.provider,
        model: agent.runtimeInfo?.model ?? agent.model ?? null,
        status: agent.status,
        section: agentSection(agent),
        lastActivityAt: agent.lastUserMessageAt ?? agent.updatedAt ?? null,
        parentAgentId: agent.labels?.["paseo.parent-agent-id"]?.trim() || null,
      });
    }
    if (!result.pageInfo.hasMore) return [...rows.values()];
    const next = result.pageInfo.nextCursor;
    if (!next || seen.has(next)) throw new Error("Host 返回了无效分页游标，请刷新后重试");
    seen.add(next);
    cursor = next;
  }
  throw new Error("Agent 列表超过安全分页上限，请缩小目标 Host 范围");
}

export async function sendAgentMessage(getApi: GetHostApi, target: Pick<AgentRow, "serverId" | "id">, text: string, messageId: string): Promise<void> {
  const prompt = text.trim();
  if (!prompt) throw new Error("消息不能为空");
  if (prompt.length > 32_000) throw new Error("消息最多 32000 字符");
  // Acquire on every action: never retain an API across transport replacement or fall back to the local host.
  await getApi(target.serverId).agents.ref(target.id).send(prompt, { messageId, activeTurnBehavior: "steer" });
}
