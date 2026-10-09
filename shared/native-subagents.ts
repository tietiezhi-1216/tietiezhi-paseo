export type NativeChild = { id: string; parentId: string; workspaceId: string; title: string; status: string; requiresAttention: boolean; attentionReason: string | null };
export const nativeChildStatus = (child: NativeChild) => child.status === "error" || child.requiresAttention && child.attentionReason === "error" ? "失败" : child.requiresAttention && child.attentionReason === "permission" ? "等待授权" : child.status === "running" || child.status === "initializing" ? "执行中" : child.requiresAttention && child.attentionReason === "finished" ? "完成" : "空闲";
const EMPTY: readonly NativeChild[] = [];
export function createNativeSubagentDirectory() {
  const rows = new Map<string, NativeChild>();
  const listeners = new Set<() => void>();
  let snapshots = new Map<string, readonly NativeChild[]>();
  const publish = () => {
    snapshots = new Map();
    for (const child of rows.values()) snapshots.set(child.parentId, [...(snapshots.get(child.parentId) || []), child]);
    for (const callback of listeners) callback();
  };
  return {
    snapshot: (parentId: string) => snapshots.get(parentId) || EMPTY,
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    upsert(agent: { id: string; workspaceId?: string | null; title?: string | null; status?: string; labels?: Record<string, string> | null; archivedAt?: string | null; requiresAttention?: boolean; attentionReason?: string | null }) {
      const parentId = agent.labels?.["paseo.parent-agent-id"];
      if (!parentId || parentId === agent.id || agent.archivedAt || agent.status === "closed" || !agent.workspaceId) rows.delete(agent.id);
      else rows.set(agent.id, { id: agent.id, parentId, workspaceId: agent.workspaceId, title: agent.title || agent.id.slice(0, 8), status: agent.status || "idle", requiresAttention: Boolean(agent.requiresAttention), attentionReason: agent.attentionReason || null });
      publish();
    },
    remove(id: string) { rows.delete(id); publish(); },
    clear() { rows.clear(); publish(); },
  };
}
