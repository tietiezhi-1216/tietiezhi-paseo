import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { subagentPillData, type SubagentPillData } from "../shared/subagents.ts";

export type SubagentSnapshot = { entries: ReadonlyArray<{ id: string; data: SubagentPillData }>; error: string | null };
/** One observer per rendered composer. No disk paths, remote fallback or child-session assumptions. */
export function createSubagentsStore(timeline: Pick<PaseoAgentTimelineHandle, "subscribe" | "refetch">) {
  let snapshot: SubagentSnapshot = { entries: [], error: null };
  const listeners = new Set<() => void>();
  const items = new Map<string, SubagentPillData>();
  let references = 0, generation = 0, release: (() => void) | undefined;
  const publish = (error: string | null = null) => {
    snapshot = { entries: [...items].slice(-64).map(([id, data]) => ({ id, data })), error };
    for (const listener of listeners) listener();
  };
  const accept = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const value = item as { type?: string; callId?: string; name: string; status: string; detail: unknown; error?: unknown };
    if (value.type !== "tool_call" || typeof value.callId !== "string") return;
    const data = subagentPillData(value);
    if (!data || (data.title.startsWith("子代理 ·") && !data.runId && !data.children.length)) return;
    // Later status-tool observations may supersede an async dispatch receipt.
    if (data.runId) for (const [id, existing] of items) {
      if (existing.runId === data.runId && id !== value.callId) items.delete(id);
    }
    items.set(value.callId, data);
    if (items.size > 64) items.delete(items.keys().next().value!);
  };
  const start = () => {
    const current = ++generation;
    let touched = new Set<string>();
    const refresh = () => {
      const baseline = touched = new Set();
      void timeline.refetch({ direction: "tail", projection: "projected", limit: 200 }).then(page => {
        if (generation !== current || baseline !== touched) return;
        for (const entry of page.entries) {
          const item = entry.item;
          if (item.type === "tool_call" && !baseline.has(item.callId)) accept(item);
        }
        publish();
      }).catch(() => { if (generation === current) publish("无法读取子代理记录"); });
    };
    try {
      const observation = timeline.subscribe(message => {
        if (generation !== current) return;
        const event = message.event;
        if (event.type === "replacement" || event.type === "subscription_restored") {
          items.clear(); publish(); refresh();
        } else if (event.type === "error") {
          publish("子代理订阅中断，请重新打开会话");
        } else if (event.type === "timeline" && event.item.type === "tool_call") {
          touched.add(event.item.callId); accept(event.item); publish();
        }
      });
      release = () => { void observation(); };
      void observation.ready.then(() => { if (generation === current) refresh(); }).catch(() => { if (generation === current) publish("无法订阅子代理记录"); });
    } catch { publish("无法订阅子代理记录"); }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retain() {
      if (++references === 1) start();
      let released = false;
      return () => { if (released) return; released = true; if (--references === 0) { ++generation; release?.(); release = undefined; items.clear(); publish(); } };
    },
    stop() { ++generation; release?.(); release = undefined; items.clear(); publish(); },
  };
}
