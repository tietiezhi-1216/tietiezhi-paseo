import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Animated, Easing, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type PluginButtonContentProps, type PluginButtonIconProps, type PluginClientContext, type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { AGENT_ACTIVITY_QUERY_KEY, agentActivity, agentActivityAt, agentDisplaySection, agentIdClipboardText, agentReload, paseoAgentIdClipboardText, agentMatchesQuery, combineOwnedAgents, isListedAgent, parentAgentIdFromLabels, prepareAgentNavigation, type RemoteAgent } from "../shared/agents.ts";
import { dispatchWebAgentTarget, watchWebPopoverDismiss } from "./web.ts";

type Theme = PluginSurfaceProps["theme"];
type PillColorKind = "success" | "failure" | "running" | "unknown";

function formatRelativeTime(value: string | null): string {
  if (!value) return "刚刚";
  const cliAge = value.trim().toLowerCase();
  if (cliAge === "just now" || cliAge === "now") return "刚刚";
  const relative = /^(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago$/.exec(cliAge);
  if (relative) {
    const amount = relative[1];
    const unit = relative[2].startsWith("minute") ? "分钟前" : relative[2].startsWith("hour") ? "小时前" : "天前";
    return `${amount}${unit}`;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "刚刚";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function agentsPillState(agents: RemoteAgent[] | undefined, pending: boolean, failed: boolean): { label: string; colorKind: PillColorKind } {
  if (!agents && pending) return { label: "loading", colorKind: "unknown" };
  if (failed) return { label: "offline", colorKind: "failure" };
  const error = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "error").length;
  if (error > 0) return { label: `error · ${error}`, colorKind: "failure" };
  const working = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "working").length;
  if (working > 0) return { label: `working · ${working}`, colorKind: "running" };
  const done = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "done").length;
  if (done > 0) return { label: `done · ${done}`, colorKind: "success" };
  const total = (agents ?? []).length;
  return { label: `idle · ${total}`, colorKind: "unknown" };
}

function pillColor(kind: PillColorKind, theme: Theme): string {
  if (kind === "success") return theme.colors.statusSuccess;
  if (kind === "failure") return theme.colors.statusDanger;
  if (kind === "running") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

function StatusDot({ color, size }: { color: string; size: number }) {
  const dot = Math.max(8, Math.round(size * 0.55));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
    </View>
  );
}

function mapLocalAgent(hostId: string, hostName: string, agent: {
  id: string;
  title?: string | null;
  status: RemoteAgent["status"];
  requiresAttention?: boolean;
  attentionReason?: RemoteAgent["attentionReason"];
  createdAt?: string | null;
  updatedAt?: string | null;
  lastUserMessageAt?: string | null;
  workspaceId?: string | null;
  archivedAt?: string | null;
  labels?: Record<string, string>;
}, workspace: string | null): RemoteAgent {
  return {
    hostId,
    hostName,
    serverId: hostId,
    id: agent.id,
    name: agent.title ?? agent.id,
    status: agent.status,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    createdAt: agent.createdAt ?? null,
    updatedAt: agent.updatedAt ?? null,
    lastUserMessageAt: agent.lastUserMessageAt ?? null,
    workspaceId: agent.workspaceId ?? null,
    workspace,
    archivedAt: agent.archivedAt ?? null,
    parentAgentId: parentAgentIdFromLabels(agent.labels),
  };
}

async function listLocalAgents(paseo: ReturnType<typeof usePaseo>, hostId: string, hostName: string): Promise<RemoteAgent[]> {
  const rows: RemoteAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ scope: "active", page: { limit: 200, cursor }, filter: { includeArchived: false } });
    for (const { agent, project } of page.entries) {
      rows.push(mapLocalAgent(hostId, hostName, agent, project.workspaceName ?? null));
    }
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
  } while (cursor);
  return rows.filter(isListedAgent);
}

const localAgentMap = new Map<string, RemoteAgent>();
let localAgentCache: RemoteAgent[] = [];
let localAgentHostId = "";
let localAgentHostName = "";
let localAgentWatch: (() => void) | null = null;
const localAgentListeners = new Set<() => void>();

function publishLocalAgents() {
  localAgentCache = [...localAgentMap.values()];
  for (const listener of localAgentListeners) listener();
}

function subscribeLocalAgents(listener: () => void) {
  localAgentListeners.add(listener);
  return () => { localAgentListeners.delete(listener); };
}

function getLocalAgents() {
  return localAgentCache;
}

function rememberLocalAgent(hostId: string, hostName: string, agent: Parameters<typeof mapLocalAgent>[2], project?: { workspaceName?: string | null } | null) {
  if (hostId && localAgentHostId !== hostId) {
    localAgentHostId = hostId;
    localAgentHostName = hostName;
  }
  const row = mapLocalAgent(localAgentHostId || hostId, localAgentHostName || hostName, agent, project?.workspaceName ?? null);
  if (!isListedAgent(row)) localAgentMap.delete(row.id);
  else localAgentMap.set(row.id, row);
  publishLocalAgents();
}

function forgetLocalAgent(agentId: string) {
  if (!localAgentMap.delete(agentId)) return;
  publishLocalAgents();
}

function watchLocalAgents(paseo: ReturnType<typeof usePaseo>, hostId: string, hostName: string) {
  if (hostId && localAgentHostId !== hostId) {
    localAgentHostId = hostId;
    localAgentHostName = hostName;
    for (const [id, row] of localAgentMap) {
      localAgentMap.set(id, { ...row, hostId, hostName, serverId: hostId });
    }
    publishLocalAgents();
  }
  if (localAgentWatch) return;
  localAgentHostId = hostId;
  localAgentHostName = hostName;
  localAgentWatch = paseo.agents.subscribe((update) => {
    if (update.kind === "remove") forgetLocalAgent(update.agentId);
    else rememberLocalAgent(localAgentHostId, localAgentHostName, update.agent, update.project);
  });
  const refreshListed = () => {
    void listLocalAgents(paseo, localAgentHostId, localAgentHostName).then((rows) => {
      const seen = new Set(rows.map((row) => row.id));
      for (const id of localAgentMap.keys()) {
        if (!seen.has(id)) localAgentMap.delete(id);
      }
      for (const row of rows) localAgentMap.set(row.id, row);
      publishLocalAgents();
    }).catch(() => {});
  };
  refreshListed();
  setInterval(refreshListed, 5_000);
}

function useOwnedAgents(hostId: string, hostName: string) {
  const paseo = usePaseo();
  const rpc = useRpc(agentActivity);
  useEffect(() => {
    watchLocalAgents(paseo, hostId, hostName);
  }, [paseo, hostId, hostName]);
  const local = useSyncExternalStore(subscribeLocalAgents, getLocalAgents);
  const remote = useQuery({
    queryKey: [AGENT_ACTIVITY_QUERY_KEY, "remote"],
    queryFn: () => rpc({ refresh: true }),
    staleTime: 0,
    gcTime: 10 * 60_000,
    placeholderData: (prev) => prev,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    retry: 1,
  });
  return {
    agents: combineOwnedAgents(local, remote.data?.agents ?? [], hostId),
    isPending: local.length === 0 && !remote.data && remote.isPending,
    isError: remote.isError,
  };
}

function AgentsStatusIcon(props: PluginButtonIconProps) {
  const owned = useOwnedAgents(props.host.id, "name" in props.host && typeof (props.host as any).name === "string" ? (props.host as any).name : "");
  const state = agentsPillState(owned.agents, owned.isPending, owned.isError);
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (state.colorKind !== "running") return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, state.colorKind]);

  const color = pillColor(state.colorKind, props.theme);
  const dot = Math.max(7, Math.round(props.size * 0.5));
  return (
    <View style={{ width: props.size, height: props.size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{
        width: dot, height: dot, borderRadius: dot / 2,
        backgroundColor: color,
        opacity: state.colorKind === "running" ? pulse : 1,
      }} />
    </View>
  );
}

function AgentActivity({ theme, compact, currentServerId, hostName, query, onSelectAgent }: {
  theme: Theme;
  compact: boolean;
  currentServerId: string;
  hostName: string;
  query: string;
  onSelectAgent: (agent: RemoteAgent) => void;
}) {
  const owned = useOwnedAgents(currentServerId, hostName);
  const pulse = useRef(new Animated.Value(0.35)).current;
  const paseo = usePaseo();
  const reloadRpc = useRpc(agentReload);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reloadingId, setReloadingId] = useState<string | null>(null);
  const [reloadNote, setReloadNote] = useState<string | null>(null);
  const reloadAgent = (agent: RemoteAgent) => {
    if (reloadingId) return;
    setReloadingId(agent.id);
    setReloadNote(null);
    const local = Boolean(agent.serverId) && agent.serverId === currentServerId;
    const request = local
      ? paseo.agents.ref(agent.id).refresh()
      : reloadRpc({ hostId: agent.hostId, serverId: agent.serverId, agentId: agent.id });
    void Promise.resolve(request).then(() => {
      setReloadNote(`${agent.name || agent.id.slice(0, 8)} 已重载`);
    }).catch((error: unknown) => {
      setReloadNote(error instanceof Error ? error.message : "重载失败");
    }).finally(() => {
      setReloadingId((current) => current === agent.id ? null : current);
    });
  };
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  const all = owned.agents
    .map((agent) => ({ agent, workspace: agent.workspace ?? "" }))
    .filter(({ agent, workspace }) => isListedAgent(agent) && agentMatchesQuery(agent, workspace, query));
  const activityAt = (agent: RemoteAgent) => agentActivityAt(agent);
  const byRecent = (a: (typeof all)[number], b: (typeof all)[number]) => (Date.parse(activityAt(b.agent) ?? "") || 0) - (Date.parse(activityAt(a.agent) ?? "") || 0);
  const error = all.filter(({ agent }) => agentDisplaySection(agent) === "error").sort(byRecent);
  const working = all.filter(({ agent }) => agentDisplaySection(agent) === "working").sort(byRecent);
  const done = all.filter(({ agent }) => agentDisplaySection(agent) === "done").sort(byRecent);
  const idle = all.filter(({ agent }) => agentDisplaySection(agent) === "idle").sort(byRecent);
  const copyAgentId = (agentId: string) => {
    void copyText(agentIdClipboardText(agentId)).then(() => {
      setCopiedId(agentId);
      setTimeout(() => setCopiedId((current) => current === agentId ? null : current), 1200);
    }).catch(() => {});
  };
  const section = (label: string, items: typeof all, color: string, breathing = false) => items.length === 0 ? null : (
    <View style={{ gap: 4 }}>
      <Text style={{ color, fontSize: compact ? 12 : 13, fontWeight: "700", paddingHorizontal: 4, letterSpacing: 0.3 }}>{label} · {items.length}</Text>
      {items.map(({ agent, workspace }) => (
        <Pressable key={`${agent.serverId ?? agent.hostId}:${agent.id}`} accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onSelectAgent(agent); }} style={{ backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingVertical: compact ? 7 : 8, paddingHorizontal: compact ? 8 : 9 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: breathing ? pulse : 1 }} />
              {workspace ? <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 11 }}>{workspace}</Text> : null}
              {workspace ? <Text style={{ color: theme.colors.border, fontSize: 11 }}>/</Text> : null}
              <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{agent.name || agent.id}</Text>
            </View>
            <Text numberOfLines={1} style={{ flexShrink: 0, color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>{formatRelativeTime(activityAt(agent))}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`重载 Agent ${agent.id}`} hitSlop={8} disabled={reloadingId === agent.id} onPress={(event) => { event.stopPropagation(); reloadAgent(agent); }}>
              <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: "700" }}>{reloadingId === agent.id ? "重载中" : "重载"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`复制 Agent ID ${agent.id}`} hitSlop={8} onPress={(event) => { event.stopPropagation(); copyAgentId(agent.id); }}>
              <Text style={{ color: copiedId === agent.id ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 10, fontWeight: "700" }}>{copiedId === agent.id ? "已复制" : "ID"}</Text>
            </Pressable>
          </View>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      {reloadNote ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{reloadNote}</Text> : null}
      {owned.isPending && owned.agents.length === 0 ? <ActivityIndicator color={theme.colors.accent} /> : all.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{query.trim() ? "没有匹配的 Agent" : "No agents"}</Text> : (
        <>
          {section("error", error, theme.colors.statusDanger)}
          {section("done", done, theme.colors.statusSuccess)}
          {section("working", working, theme.colors.statusWarning, true)}
          {section("idle", idle, theme.colors.foregroundMuted)}
        </>
      )}
    </View>
  );
}

const HIDE_SCROLLBAR_CSS = `
/* 1. Expand composer pill max-width so Agent title and status fit without truncation */
[aria-label="当前会话与 Agents"],
button[aria-label="当前会话与 Agents"],
div[aria-label="当前会话与 Agents"] {
  max-width: 280px !important;
}

/* 2. Lock outer popover shell so the outer panel NEVER scrolls */
[data-menu-surface="true"],
[data-menu-surface="true"] > div,
[data-menu-surface="true"] > div > div {
  overflow: hidden !important;
  overflow-y: hidden !important;
}

/* 3. Completely eliminate all WebKit and Firefox scrollbars */
::-webkit-scrollbar,
::-webkit-scrollbar-thumb,
::-webkit-scrollbar-track,
*::-webkit-scrollbar,
*::-webkit-scrollbar-thumb,
*::-webkit-scrollbar-track,
[data-menu-surface="true"]::-webkit-scrollbar,
[data-menu-surface="true"] *::-webkit-scrollbar {
  display: none !important;
  width: 0px !important;
  height: 0px !important;
  background: transparent !important;
}
* {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}

/* 4. Re-enable scrolling ONLY on the middle agent list */
.paseo-agents-list-scroll,
.paseo-agents-list-scroll > div {
  overflow-y: auto !important;
}
`;

function injectScrollbarStyles() {
  if (typeof document === "undefined") return;
  const id = "paseo-agents-scrollbar-style";
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head?.appendChild(style);
  }
  style.textContent = HIDE_SCROLLBAR_CSS;
}

if (typeof document !== "undefined") {
  injectScrollbarStyles();
}

function SearchIcon({ size = 13, color = "#8b949e" }: { size?: number; color?: string }) {
  if (typeof document === "undefined") return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

let activeAgentsPopoverCloser: (() => void) | null = null;

function AgentsPopover(props: PluginButtonContentProps) {
  useEffect(() => {
    injectScrollbarStyles();
  }, []);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const searchFocused = useRef(false);

  useEffect(() => {
    if (activeAgentsPopoverCloser && activeAgentsPopoverCloser !== props.close) {
      try { activeAgentsPopoverCloser(); } catch { /* ignore */ }
    }
    activeAgentsPopoverCloser = props.close;
    return () => {
      if (activeAgentsPopoverCloser === props.close) {
        activeAgentsPopoverCloser = null;
      }
    };
  }, [props.close]);

  useEffect(() => {
    if (props.layout.platform !== "web") return;
    return watchWebPopoverDismiss(props.close);
  }, [props.close, props.layout.platform]);
  useEffect(() => {
    let alive = true;
    const focus = () => { if (alive) searchRef.current?.focus(); };
    const timers = [0, 50, 120, 280].map((ms) => setTimeout(focus, ms));
    return () => { alive = false; for (const timer of timers) clearTimeout(timer); };
  }, []);
  const selectAgent = (agent: RemoteAgent) => {
    try {
      prepareAgentNavigation(agent, {
        platform: props.layout.platform,
        currentServerId: props.host.id,
        navigation: "navigation" in props ? (props as PluginSurfaceProps).navigation : undefined,
        dispatchWebTarget: dispatchWebAgentTarget,
        nativeLinking: typeof Linking.emit === "function" && typeof Linking.listenerCount === "function" ? Linking : undefined,
      })();
      setNavigationError(null);
      props.close();
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : "无法打开 Agent，请检查目标 Host 的连接。");
    }
  };
  const compact = props.layout.platform !== "web";
  const currentAgentId = "agentId" in props ? (props as any).agentId : "";
  const currentAgent = getLocalAgents().find((item) => item.id === currentAgentId);
  const currentTitle = currentAgent?.name || (currentAgentId ? currentAgentId.slice(0, 8) : "当前会话");
  const [copiedCurrent, setCopiedCurrent] = useState(false);
  const popoverRef = useRef<any>(null);

  useEffect(() => {
    injectScrollbarStyles();
    const el = popoverRef.current;
    if (!el || typeof document === "undefined") return;

    // Reset parent wrapper padding so we have 100% exact pixel control of inner card margins
    const contentParent = el.parentElement;
    if (contentParent) {
      contentParent.style.setProperty("padding", "0px", "important");
      contentParent.style.setProperty("gap", "0px", "important");
    }

    // Lock outer popover shell so outer panel never scrolls
    let p = el.parentElement;
    while (p) {
      p.style.scrollbarWidth = "none";
      p.style.msOverflowStyle = "none";
      if (p.getAttribute("data-menu-surface") === "true" || p.classList?.contains("r-overflowY-eqz5dr")) {
        p.style.overflow = "hidden";
        p.style.overflowY = "hidden";
      }
      p = p.parentElement;
    }
  }, []);

  return (
    <View
      ref={popoverRef}
      style={{
        alignSelf: "stretch",
        minWidth: compact ? 280 : 360,
        height: 395,
        maxHeight: 395,
        display: "flex",
        flexDirection: "column",
        backgroundColor: props.theme.colors.surface0,
        boxSizing: "border-box" as any,
        overflow: "hidden",
      }}
    >
      {/* 🔒 1. 顶部固定搜索区 (Pinned Navigation Header - NEVER scrolls) */}
      <View
        style={{
          flexShrink: 0,
          backgroundColor: props.theme.colors.surface1,
          borderBottomWidth: 1,
          borderBottomColor: props.theme.colors.border,
          paddingHorizontal: 10,
          paddingTop: 10,
          paddingBottom: 9,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            backgroundColor: props.theme.colors.surface0 ?? "#1c1f24",
            borderColor: isSearchFocused ? props.theme.colors.accent : props.theme.colors.border,
            borderWidth: 1,
            borderRadius: 7,
            paddingHorizontal: 9,
            paddingVertical: 6,
          }}
        >
          <SearchIcon size={13} color={isSearchFocused ? props.theme.colors.accent : props.theme.colors.foregroundMuted} />
          <TextInput
            ref={searchRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="搜索 Agent / 工作区 / ID"
            placeholderTextColor={props.theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="搜索 Agent"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onLayout={() => {
              if (searchFocused.current) return;
              searchFocused.current = true;
              searchRef.current?.focus();
            }}
            style={{
              flex: 1,
              color: props.theme.colors.foreground,
              fontSize: 12,
              padding: 0,
              borderWidth: 0,
              backgroundColor: "transparent",
              outlineStyle: "none",
            } as any}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={6} accessibilityLabel="清空搜索">
              <Text style={{ color: props.theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", paddingHorizontal: 2 }}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        {navigationError ? <Text accessibilityRole="alert" style={{ color: props.theme.colors.statusDanger, fontSize: 11, paddingTop: 4 }}>{navigationError}</Text> : null}
      </View>

      {/* 📜 2. 中间独立滚动区：卡片视口 (Scrollable Card Deck Viewport - ONLY this scrolls) */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        {...({ className: "paseo-agents-list-scroll" } as any)}
        style={{
          flex: 1,
          minHeight: 0,
          height: 290,
          maxHeight: 300,
          backgroundColor: props.theme.colors.surface0,
        }}
        contentContainerStyle={{
          paddingHorizontal: 10,
          paddingTop: 9,
          paddingBottom: 9,
          gap: 9,
        }}
      >
        <AgentActivity
          theme={props.theme}
          compact={compact}
          currentServerId={props.host.id}
          hostName={"name" in props.host && typeof (props.host as any).name === "string" ? (props.host as any).name : ""}
          query={query}
          onSelectAgent={selectAgent}
        />
      </ScrollView>

      {/* 🔒 3. 底部固定状态坞 (Pinned Action Footer Dock - NEVER scrolls) */}
      <View
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          backgroundColor: props.theme.colors.surface1,
          borderTopWidth: 1,
          borderTopColor: props.theme.colors.border,
          paddingHorizontal: 11,
          paddingVertical: 7,
        }}
      >
        <Text numberOfLines={1} style={{ color: props.theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", flex: 1 }}>
          当前 · {currentTitle}
        </Text>
        {currentAgentId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制当前 Agent ID"
            onPress={() => {
              void copyText(paseoAgentIdClipboardText(currentAgentId)).then(() => {
                setCopiedCurrent(true);
                setTimeout(() => setCopiedCurrent(false), 1500);
              }).catch(() => {});
            }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2.5,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: props.theme.colors.border,
              backgroundColor: props.theme.colors.surface0 ?? "rgba(255,255,255,0.06)",
            }}
          >
            <Text style={{ color: copiedCurrent ? props.theme.colors.statusSuccess : props.theme.colors.foreground, fontSize: 11, fontWeight: "600" }}>
              {copiedCurrent ? "已复制" : "复制 ID"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function truncateAgentTitle(title: string, maxChars = 6): string {
  const clean = title?.trim() ?? "";
  if (!clean) return "";
  let width = 0;
  let truncated = "";
  const limit = maxChars * 2;
  for (const char of clean) {
    const charWidth = char.charCodeAt(0) > 127 ? 2 : 1;
    if (width + charWidth > limit) {
      return truncated + "…";
    }
    width += charWidth;
    truncated += char;
  }
  return clean;
}

function formatSessionPill(title: string, state: { label: string; colorKind: PillColorKind }): string {
  const shortTitle = truncateAgentTitle(title);
  const status = state.label && state.label !== "loading" ? state.label : "working";
  if (shortTitle) {
    return `${shortTitle} · ${status}`;
  }
  return status;
}

export function contributeAgentsPills(client: PluginClientContext) {
  injectScrollbarStyles();
  const pills = new Map<string, {
    workspaceId: string;
    title: string;
    pill: ReturnType<PluginClientContext["addComposerPill"]>;
    updateTitle: (title: string) => void;
    remove: () => void;
  }>();
  let stopped = false;
  let agentSubscription: { release: () => Promise<void> } | undefined;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastState = { label: "", colorKind: "unknown" as PillColorKind };

  const applyLabel = (entry: { title: string; pill: ReturnType<PluginClientContext["addComposerPill"]> }) => {
    entry.pill.update({ label: formatSessionPill(entry.title, lastState) });
  };

  const refreshLabels = async () => {
    if (stopped) return;
    try {
      const activity = await client.rpc(agentActivity, {});
      const local = getLocalAgents().length > 0 ? getLocalAgents() : await listLocalAgents(client.paseo, "", "");
      lastState = agentsPillState(combineOwnedAgents(local, activity.agents), false, false);
      for (const entry of pills.values()) applyLabel(entry);
    } catch {
      lastState = { label: "读取失败", colorKind: "failure" };
      for (const entry of pills.values()) applyLabel(entry);
    }
  };

  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const mountAgentPill = (agentId: string, workspaceId: string, title?: string | null) => {
    const existing = pills.get(agentId);
    if (existing?.workspaceId === workspaceId) {
      if (typeof title === "string" && title.trim()) {
        existing.updateTitle(title.trim());
      }
      return;
    }
    remove(agentId);

    const agentTitle = (typeof title === "string" && title.trim()) || agentId.slice(0, 8);
    const pill = client.addComposerPill({
      id: "tietiezhi-agents-pill",
      workspaceId,
      agentId,
      button: {
        title: "当前会话与 Agents",
        icon: AgentsStatusIcon,
        label: formatSessionPill(agentTitle, lastState),
        behavior: { kind: "popover", Content: AgentsPopover },
      },
    });
    const entry = {
      workspaceId,
      title: agentTitle,
      pill,
      updateTitle: (next: string) => {
        entry.title = next;
        applyLabel(entry);
      },
      remove: () => {
        pill.remove();
      },
    };
    pills.set(agentId, entry);
    applyLabel(entry);
  };

  const upsert = (agent: { id: string; workspaceId?: string; title?: string | null }) => {
    if (agent.workspaceId) mountAgentPill(agent.id, agent.workspaceId, agent.title);
    else remove(agent.id);
  };
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      remove(update.agentId);
      forgetLocalAgent(update.agentId);
    } else {
      upsert(update.agent);
      rememberLocalAgent("", "", update.agent, update.project);
    }
  });
  void (async () => {
    let cursor: string | undefined;
    do {
      const result = await client.paseo.agents.list({
        scope: "active",
        page: { limit: 200, cursor },
        ...(cursor ? {} : { subscribe: {} }),
      });
      const { entries, pageInfo } = result;
      if (!cursor) agentSubscription = (result as typeof result & { subscription?: { release: () => Promise<void> } }).subscription;
      if (stopped) {
        void agentSubscription?.release();
        agentSubscription = undefined;
        return;
      }
      for (const { agent, project } of entries) {
        upsert(agent);
        rememberLocalAgent("", "", agent, project);
      }
      if (!pageInfo.hasMore) return;
      cursor = pageInfo.nextCursor ?? undefined;
    } while (!stopped);
  })().then(() => {
    if (stopped) return;
    void refreshLabels();
    timer = setInterval(() => { void refreshLabels(); }, 5_000);
  }).catch((error: unknown) => {
    console.error("tietiezhi agents pills init failed", error);
  });
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    unsubscribe?.();
    void agentSubscription?.release();
    agentSubscription = undefined;
    for (const { remove: drop } of pills.values()) drop();
    pills.clear();
  };
}
