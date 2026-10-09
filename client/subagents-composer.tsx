import { useEffect, useSyncExternalStore } from "react";
import { Text, View, ScrollView } from "react-native";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createSubagentsStore } from "./subagents-store.ts";
import { SubagentPill } from "./subagents.tsx";

type Store = ReturnType<typeof createSubagentsStore>;
function useSubagents(store: Store) {
  useEffect(() => store.retain(), [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export function SubagentsPopover(props: PluginButtonContentProps & { store: Store }) {
  const snapshot = useSubagents(props.store);
  const content = <View style={{ gap: 8, padding: 10 }}>
    {snapshot.error ? <Text accessibilityRole="alert" style={{ color: props.theme.colors.statusDanger, fontSize: 12 }}>{snapshot.error}</Text> : null}
    {!snapshot.entries.length ? <Text style={{ color: props.theme.colors.foregroundMuted, fontSize: 12 }}>暂无子代理记录</Text> : null}
    {[...snapshot.entries].reverse().map(({ id, data }) => <SubagentPill key={id} {...props} agentId={"agentId" in props ? String(props.agentId) : ""} timestamp={new Date()} item={{ type: "plugin", kind: "pi-subagent-pill", version: 1, data }} />)}
  </View>;
  return props.layout.compact || props.layout.platform !== "web" ? content : <ScrollView style={{ maxHeight: 420, minWidth: 320, maxWidth: 420 }}>{content}</ScrollView>;
}

export function contributeSubagentComposer(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; store: Store; remove(): void }>();
  let stopped = false;
  const lifetime = new AbortController();
  let directory: { release(): Promise<void> } | undefined;
  const remove = (id: string) => { const row = pills.get(id); pills.delete(id); row?.store.stop(); row?.remove(); };
  const upsert = (agent: { id: string; workspaceId?: string; provider?: string }) => {
    if (!agent.workspaceId || (agent.provider && agent.provider !== "pi")) { remove(agent.id); return; }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const store = createSubagentsStore(client.paseo.agents.ref(agent.id).timeline);
    let label = "子代理 · 0";
    let registration: ReturnType<PluginClientContext["addComposerPill"]>;
    const StatusIcon = (props: PluginButtonIconProps) => {
      const snapshot = useSubagents(store);
      const running = snapshot.entries.filter(entry => entry.data.state === "running").length;
      const submitted = snapshot.entries.filter(entry => entry.data.state === "submitted").length;
      const pending = running + submitted;
      const failed = snapshot.error || snapshot.entries.some(entry => entry.data.state === "failed");
      const count = snapshot.entries.reduce((total, entry) => total + (entry.data.children.length || 1), 0);
      useEffect(() => {
        const next = `子代理 · ${running ? "执行中 · " : submitted ? "后台 · " : ""}${count}`;
        if (stopped || pills.get(agent.id)?.store !== store || next === label) return;
        label = next; registration.update({ label });
      }, [running, submitted, count]);
      return <Icon name="Users" size={14} color={failed ? props.theme.colors.statusDanger : pending ? props.theme.colors.statusWarning : props.theme.colors.foregroundMuted} />;
    };
    registration = client.addComposerPill({ id: "tietiezhi-subagents", agentId: agent.id, workspaceId: agent.workspaceId, button: {
      title: "查看当前会话子代理", label, icon: StatusIcon,
      behavior: { kind: "popover", Content: props => <SubagentsPopover {...props} store={store} /> },
    } });
    pills.set(agent.id, { workspaceId: agent.workspaceId, store, remove: () => registration.remove() });
  };
  const touched = new Set<string>();
  const unwatch = client.paseo.agents.subscribe(update => {
    if (stopped) return;
    const id = update.kind === "remove" ? update.agentId : update.agent.id;
    touched.add(id);
    if (update.kind === "remove") remove(id); else upsert(update.agent);
  });
  void (async () => {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await client.paseo.agents.list({ scope: "active", signal: lifetime.signal, page: { limit: 200, cursor }, ...(cursor ? {} : { subscribe: {} }) });
      if (!cursor) directory = (page as typeof page & { subscription?: { release(): Promise<void> } }).subscription;
      if (stopped) { await directory?.release(); return; }
      for (const { agent } of page.entries) if (!touched.has(agent.id)) upsert(agent);
      if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor || page.pageInfo.nextCursor === cursor) return;
      if (seen.has(page.pageInfo.nextCursor)) return;
      cursor = page.pageInfo.nextCursor;
      seen.add(cursor);
    } while (!stopped);
  })().catch(() => { if (!stopped) console.error("tietiezhi subagent composer directory unavailable"); });
  return () => { stopped = true; lifetime.abort(); unwatch(); void directory?.release(); for (const id of [...pills.keys()]) remove(id); };
}
