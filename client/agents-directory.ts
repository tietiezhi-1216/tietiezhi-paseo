import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentUpdate, PaseoAgentListResult, OwnedSubscription as NativeOwnedSubscription } from "@getpaseo/client";
import { AgentDirectory } from "../shared/agents-directory.ts";
import { isDisplayableAgent, parentAgentIdFromLabels, type RemoteAgent } from "../shared/agents.ts";

type LocalAgent = {
  id: string; title?: string | null; status: RemoteAgent["status"];
  requiresAttention?: boolean; attentionReason?: RemoteAgent["attentionReason"];
  createdAt?: string | null; updatedAt?: string | null; lastUserMessageAt?: string | null;
  workspaceId?: string | null; archivedAt?: string | null; labels?: Record<string, string>;
};
type OwnedSubscription = { release(): Promise<void>; subscribe?: NativeOwnedSubscription<PaseoAgentListResult>["subscribe"] };

function mapAgent(hostId: string, hostName: string, agent: LocalAgent, workspace: string | null): RemoteAgent {
  return {
    hostId, hostName, serverId: hostId, id: agent.id, name: agent.title ?? agent.id, status: agent.status,
    requiresAttention: agent.requiresAttention ?? false, attentionReason: agent.attentionReason ?? null,
    createdAt: agent.createdAt ?? null, updatedAt: agent.updatedAt ?? null, lastUserMessageAt: agent.lastUserMessageAt ?? null,
    workspaceId: agent.workspaceId ?? null, workspace, archivedAt: agent.archivedAt ?? null,
    parentAgentId: parentAgentIdFromLabels(agent.labels),
  };
}

export async function listHostAgents(paseo: PaseoApi, hostId: string, hostName: string, own?: (subscription: OwnedSubscription) => void): Promise<RemoteAgent[]> {
  const rows: RemoteAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ page: { limit: 200, cursor }, filter: { includeArchived: true }, ...(own && !cursor ? { subscribe: {} } : {}) });
    if (own && !cursor) {
      const subscription = (page as typeof page & { subscription?: OwnedSubscription }).subscription;
      if (subscription) own(subscription);
    }
    for (const { agent, project } of page.entries) rows.push(mapAgent(hostId, hostName, agent, project?.workspaceName ?? null));
    const next = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    if (page.pageInfo.hasMore && (!next || next === cursor)) throw new Error("无效 Agent 分页游标");
    cursor = next;
  } while (cursor);
  return rows.filter(isDisplayableAgent);
}

export const localAgentDirectory = new AgentDirectory();
type Watch = { references: number; active: boolean; busy: boolean; subscription?: OwnedSubscription; timer?: ReturnType<typeof setInterval>; unsubscribe?: () => void; unsubscribeOwned?: () => void };
const watches = new Map<string, Watch>();

export function retainHostAgents(paseo: PaseoApi, hostId: string, hostName: string): () => void {
  let watch = watches.get(hostId);
  if (!watch) {
    const current: Watch = { references: 0, active: true, busy: false };
    watch = current;
    watches.set(hostId, current);
    const applyUpdate = (update: PaseoAgentUpdate) => {
      if (!current.active) return;
      if (update.kind === "remove") localAgentDirectory.archive(hostId, update.agentId);
      else localAgentDirectory.upsert(hostId, mapAgent(hostId, hostName, update.agent, update.project?.workspaceName ?? null));
    };
    try { current.unsubscribe = paseo.agents.subscribe(applyUpdate); }
    catch (error) { current.active = false; watches.delete(hostId); throw error; }
    const refresh = async () => {
      if (!current.active || current.busy) return;
      current.busy = true;
      const revision = localAgentDirectory.revision(hostId);
      try {
        const rows = await listHostAgents(paseo, hostId, hostName, current.subscription ? undefined : (subscription) => {
          if (!current.active) { void subscription.release().catch(() => {}); return; }
          current.subscription = subscription;
          if (subscription.subscribe) {
            // Ignore removals from unrelated filtered directory observations.
            current.unsubscribe?.();
            current.unsubscribe = undefined;
            current.unsubscribeOwned = subscription.subscribe({
              snapshot: () => { void refresh(); }, // Reconnect: re-read ALL pages, not just the first snapshot page.
              update: (message) => { if (message.type === "agent_update") applyUpdate(message.payload); },
              error: () => {
                if (!current.active) return;
                localAgentDirectory.fail(hostId);
                current.unsubscribeOwned?.();
                current.unsubscribeOwned = undefined;
                current.subscription = undefined;
                void subscription.release().catch(() => {});
              },
            });
          }
        });
        if (current.active) localAgentDirectory.replace(hostId, rows, revision);
      } catch {
        if (current.active) localAgentDirectory.fail(hostId);
      } finally { current.busy = false; }
    };
    void refresh();
    current.timer = setInterval(() => { void refresh(); }, 5_000);
  }
  const current = watch;
  current.references++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--current.references > 0) return;
    current.active = false;
    if (current.timer) clearInterval(current.timer);
    current.unsubscribe?.();
    current.unsubscribeOwned?.();
    void current.subscription?.release().catch(() => {});
    if (watches.get(hostId) === current) watches.delete(hostId);
  };
}

export function useLocalAgents(paseo: PaseoApi, hostId: string, hostName: string) {
  const paseoRef = useRef(paseo);
  paseoRef.current = paseo;
  useEffect(() => retainHostAgents(paseoRef.current, hostId, hostName), [hostId, hostName]);
  return useSyncExternalStore(
    (listener) => localAgentDirectory.subscribe(hostId, listener),
    () => localAgentDirectory.get(hostId),
  );
}
