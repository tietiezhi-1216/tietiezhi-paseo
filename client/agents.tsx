import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { getPaseoClient, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueries } from "@tanstack/react-query";
import { SECTION_LABELS, SECTION_ORDER, agentKey, filterAgents, type AgentRow } from "../shared/agents.ts";
import { readHostAgents, sendAgentMessage } from "./host-directory.ts";
import { HOST_STATUS_LABELS } from "./hosts.tsx";
import { Action, Disclosure, IconAction, Loading, Notice, errorText } from "./ui.tsx";

function newMessageId(): string { return `tietiezhi-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
type MessageDraft = { target: AgentRow; text: string; messageId: string };

export function AgentsPanel({ theme, host: origin, navigation }: PluginSurfaceProps) {
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  const [serverFilter, setServerFilter] = useState("");
  const [includeChildren, setIncludeChildren] = useState(false);
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const queries = useQueries({
    queries: hosts.map((host) => ({
      queryKey: ["tietiezhi", "agents", origin.id, host.serverId],
      queryFn: ({ signal }: { signal: AbortSignal }) => readHostAgents(getPaseoClient, host.serverId, signal),
      enabled: host.status === "online",
      staleTime: 3_000,
      gcTime: 60_000,
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
      retry: false,
    })),
  });
  const rows = filterAgents(queries.flatMap((result) => result.data ?? []), hosts, query, serverFilter, includeChildren);
  const hostMap = new Map(hosts.map((host) => [host.serverId, host]));
  const usable = (row: AgentRow) => {
    const index = hosts.findIndex((host) => host.serverId === row.serverId);
    return index >= 0 && hosts[index].status === "online" && !queries[index].isError;
  };
  const send = useMutation({
    mutationFn: (selection: MessageDraft) => sendAgentMessage(getPaseoClient, selection.target, selection.text, selection.messageId),
    onSuccess(_result, selection) {
      setNotice(`已发送 · ${hostMap.get(selection.target.serverId)?.label ?? selection.target.serverId}`);
      setDraft(null);
    },
  });

  return (
    <View style={{ gap: 9 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action theme={theme} title="全部主机" label={serverFilter ? "全部" : "全部 ✓"} onPress={() => setServerFilter("")} />
        {hosts.map((host) => (
          <Action key={host.serverId} theme={theme} title={`${host.label} · ${HOST_STATUS_LABELS[host.status]}`} label={`${host.label}${serverFilter === host.serverId ? " ✓" : ""}`}
            onPress={() => setServerFilter(host.serverId)} />
        ))}
      </View>
      {serverFilter && !hostMap.has(serverFilter) ? <Notice theme={theme} error text="所选 Host 已移除，请选择其他 Host。" /> : null}
      <TextInput value={query} onChangeText={setQuery} placeholder="搜索 Agent…" placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="搜索 Agent" testID="agent-search" autoCapitalize="none" autoCorrect={false}
        style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 8, fontSize: 12, minHeight: 34 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action theme={theme} title={includeChildren ? "隐藏子 Agent" : "显示子 Agent"} label={includeChildren ? "子 Agent ✓" : "子 Agent"} onPress={() => setIncludeChildren(!includeChildren)} />
        <IconAction theme={theme} title="刷新列表" icon="RefreshCw"
          disabled={queries.some((result) => result.isFetching)} onPress={() => {
            for (let i = 0; i < queries.length; i++) if (hosts[i].status === "online") void queries[i].refetch();
          }} />
      </View>
      {hosts.length === 0 ? <Notice theme={theme} text="暂无主机" /> : null}
      {queries.some((result, i) => result.isPending && hosts[i].status === "online") ? <Loading theme={theme} /> : null}
      {queries.map((result, i) => hosts[i].status !== "online" || result.isError ? (
        <Notice key={hosts[i].serverId} theme={theme} error={result.isError} text={`${hosts[i].label} · ${result.isError ? "读取失败" : HOST_STATUS_LABELS[hosts[i].status]}${result.data ? " · 缓存" : " · 无数据"}`} />
      ) : null)}
      {notice ? <Notice theme={theme} text={notice} /> : null}
      {actionError ? <Notice theme={theme} error text={actionError} /> : null}
      {send.isError ? <Notice theme={theme} error text={errorText(send.error)} /> : null}

      {draft ? (
        <View testID="agent-message-confirmation" style={{ padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, gap: 7 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>发送给 {hostMap.get(draft.target.serverId)?.label ?? draft.target.serverId} / {draft.target.title}</Text>
          <Notice theme={theme} text="发送到目标主机 · 不中断当前任务" />
          <TextInput value={draft.text} onChangeText={(text) => setDraft({ ...draft, text, messageId: newMessageId() })}
            multiline editable={!send.isPending} maxLength={32_000} placeholder="输入消息…" placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="发送给选定 Agent 的消息" testID="agent-message-input"
            style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface1, padding: 9, minHeight: 80, borderRadius: 6, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Action theme={theme} title={send.isPending ? "发送中…" : "确认发送"} testID="confirm-agent-message"
              disabled={send.isPending || !draft.text.trim() || !usable(draft.target)} onPress={() => send.mutate(draft)} />
            <Action theme={theme} title="取消" disabled={send.isPending} onPress={() => { setDraft(null); send.reset(); }} />
          </View>
        </View>
      ) : null}

      {SECTION_ORDER.map((section) => {
        const items = rows.filter((row) => row.section === section);
        if (items.length === 0) return null;
        const color = section === "error" ? theme.colors.statusDanger : section === "working" || section === "permission"
          ? theme.colors.statusWarning : section === "done" ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
        return (
          <View key={section} style={{ gap: 8 }}>
            <Text style={{ color, fontWeight: "700" }}>{SECTION_LABELS[section]} · {items.length}</Text>
            {items.map((agent) => (
              <View key={agentKey(agent)} testID="agent-row" style={{ backgroundColor: theme.colors.surface1, padding: 10, gap: 4, borderRadius: 7 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>{agent.title}</Text>
                  <IconAction theme={theme} title="打开会话" icon="ExternalLink" disabled={!navigation || !usable(agent)} onPress={() => {
                    try { navigation?.openAgent({ serverId: agent.serverId, agentId: agent.id }); setActionError(""); }
                    catch { setActionError("无法打开目标 Host 的会话，请检查连接后重试"); }
                  }} />
                  <IconAction theme={theme} title="复制 Host + Agent ID" icon="Copy" onPress={() => {
                    void copyText(`Host: ${agent.serverId}\nAgent: ${agent.id}`).then(() => setNotice("已复制 Host 和 Agent ID")).catch(() => setActionError("复制失败，请手动选择 ID"));
                  }} />
                  <IconAction theme={theme} title="发消息" icon="Send" disabled={!usable(agent) || send.isPending} onPress={() => {
                    setDraft({ target: agent, text: "", messageId: newMessageId() }); setNotice(""); setActionError(""); send.reset();
                  }} />
                </View>
                <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{hostMap.get(agent.serverId)?.label ?? agent.serverId} · {agent.workspace || "—"}{!usable(agent) ? " · 缓存" : ""}</Text>
                <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{agent.provider}{agent.model ? ` / ${agent.model}` : ""}{agent.parentAgentId ? " · 子 Agent" : ""}</Text>
                <Disclosure theme={theme} testID="agent-details">
                  <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{agent.id}</Text>
                  {agent.lastActivityAt ? <Notice theme={theme} text={new Date(agent.lastActivityAt).toLocaleString()} /> : null}
                </Disclosure>
              </View>
            ))}
          </View>
        );
      })}
      {rows.length === 0 && !queries.some((result, i) => result.isPending && hosts[i].status === "online") ? <Notice theme={theme} text="暂无 Agent" /> : null}
    </View>
  );
}
