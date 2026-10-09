import { useState, useSyncExternalStore } from "react";
import { Text, View, ScrollView, Pressable, Linking } from "react-native";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createNativeSubagentDirectory, nativeChildStatus, type NativeChild } from "../shared/native-subagents.ts";
import { prepareAgentNavigation } from "../shared/agents.ts";
import { dispatchWebAgentTarget } from "./web.ts";

type Directory = ReturnType<typeof createNativeSubagentDirectory>;
export function SubagentsPopover(props: PluginButtonContentProps & { directory: Directory; parentId: string }) {
  const children = useSyncExternalStore(props.directory.subscribe, () => props.directory.snapshot(props.parentId), () => props.directory.snapshot(props.parentId));
  const [error, setError] = useState<string | null>(null);
  const open = (child: NativeChild) => {
    try {
      prepareAgentNavigation({ id: child.id, serverId: props.host.id, workspaceId: child.workspaceId }, {
        platform: props.layout.platform, currentServerId: props.host.id,
        navigation: (props as unknown as PluginSurfaceProps).navigation,
        dispatchWebTarget: dispatchWebAgentTarget,
        nativeLinking: typeof Linking.emit === "function" && typeof Linking.listenerCount === "function" ? Linking : undefined,
      })();
      props.close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开子代理"); }
  };
  const content = <View style={{ padding: 6, gap: 2 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: props.theme.colors.statusDanger, fontSize: 12 }}>{error}</Text> : null}
    {children.map(child => {
      const status = nativeChildStatus(child);
      const color = status === "失败" ? props.theme.colors.statusDanger : status === "执行中" || status === "等待授权" ? props.theme.colors.statusWarning : props.theme.colors.foregroundMuted;
      return <Pressable key={child.id} testID="native-subagent-row" accessibilityRole="button" accessibilityLabel={`打开子代理 ${child.title}`} onPress={() => open(child)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 10 }}>
        <Text style={{ color, fontSize: 10 }}>●</Text>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: props.theme.colors.foreground, fontSize: 12 }}>{child.title}</Text>
        <Text style={{ color, fontSize: 11 }}>{status}</Text>
        <Icon name="ChevronRight" size={12} color={props.theme.colors.foregroundMuted} />
      </Pressable>;
    })}
  </View>;
  return props.layout.compact || props.layout.platform !== "web" ? content : <ScrollView style={{ maxHeight: 360, minWidth: 280, maxWidth: 360 }}>{content}</ScrollView>;
}

export function contributeSubagentComposer(client: PluginClientContext) {
  const directory = createNativeSubagentDirectory();
  const pills = new Map<string, { workspaceId: string; registration: ReturnType<PluginClientContext["addComposerPill"]>; label: string; visible: boolean }>();
  let stopped = false;
  const lifetime = new AbortController();
  let subscription: { release(): Promise<void> } | undefined;
  const remove = (id: string) => { pills.get(id)?.registration.remove(); pills.delete(id); directory.remove(id); };
  const sync = () => {
    for (const [id, row] of pills) {
      const children = directory.snapshot(id), active = children.filter(child => ["执行中", "等待授权"].includes(nativeChildStatus(child))).length;
      const visible = children.length > 0, label = `子代理 · ${active ? "执行中 · " : ""}${children.length}`;
      if (row.visible !== visible || row.label !== label) { row.visible = visible; row.label = label; row.registration.update({ visible, label }); }
    }
  };
  const unlisten = directory.subscribe(sync);
  const upsert = (agent: { id: string; workspaceId?: string; provider?: string; labels?: Record<string, string> | null; archivedAt?: string | null; title?: string | null; status?: string; requiresAttention?: boolean; attentionReason?: string | null }) => {
    directory.upsert(agent);
    if (!agent.workspaceId || agent.archivedAt || (agent.provider && agent.provider !== "pi")) { pills.get(agent.id)?.registration.remove(); pills.delete(agent.id); return; }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    pills.get(agent.id)?.registration.remove();
    const StatusIcon = (props: PluginButtonIconProps) => {
      const children = useSyncExternalStore(directory.subscribe, () => directory.snapshot(agent.id), () => directory.snapshot(agent.id));
      const status = children.some(child => child.status === "error") ? props.theme.colors.statusDanger : children.some(child => ["执行中", "等待授权"].includes(nativeChildStatus(child))) ? props.theme.colors.statusWarning : props.theme.colors.foregroundMuted;
      return <Icon name="Users" size={14} color={status} />;
    };
    const registration = client.addComposerPill({ id: "tietiezhi-subagents", agentId: agent.id, workspaceId: agent.workspaceId, button: {
      title: "打开子代理对话", label: "子代理 · 0", visible: false, icon: StatusIcon,
      behavior: { kind: "popover", Content: props => <SubagentsPopover {...props} directory={directory} parentId={agent.id} /> },
    } });
    pills.set(agent.id, { workspaceId: agent.workspaceId, registration, label: "子代理 · 0", visible: false }); sync();
  };
  const touched = new Set<string>();
  const unwatch = client.paseo.agents.subscribe(update => {
    if (stopped) return;
    const id = update.kind === "remove" ? update.agentId : update.agent.id; touched.add(id);
    if (update.kind === "remove") remove(id); else upsert(update.agent);
  });
  void (async () => {
    let cursor: string | undefined; const seen = new Set<string>();
    do {
      const page = await client.paseo.agents.list({ scope: "active", signal: lifetime.signal, page: { limit: 200, cursor }, ...(cursor ? {} : { subscribe: {} }) });
      if (!cursor) subscription = (page as typeof page & { subscription?: { release(): Promise<void> } }).subscription;
      if (stopped) { await subscription?.release(); return; }
      for (const { agent } of page.entries) if (!touched.has(agent.id)) upsert(agent);
      if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor || seen.has(page.pageInfo.nextCursor)) return;
      cursor = page.pageInfo.nextCursor; seen.add(cursor);
    } while (!stopped);
  })().catch(() => { if (!stopped) console.error("tietiezhi native subagent directory unavailable"); });
  return () => { stopped = true; lifetime.abort(); unwatch(); unlisten(); void subscription?.release(); for (const row of pills.values()) row.registration.remove(); pills.clear(); directory.clear(); };
}
