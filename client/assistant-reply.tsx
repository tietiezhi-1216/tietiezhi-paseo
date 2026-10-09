import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import { getAgentTurnPerformance, matchReplyPerformance, formatTokens, type AssistantReplyData } from "../shared/performance.ts";

import { Markdown } from "./markdown.tsx";
import { ForkMenu } from "./fork.tsx";
import type { AgentNavigationTarget } from "../shared/agents.ts";

/** Declarative rendering only: no document access, reparenting, or host CSS. */
export function AssistantReply({ item, agentId, theme, timestamp, host, layout, onForkNavigate }: PluginTimelineItemProps<AssistantReplyData> & { onForkNavigate?: (target: AgentNavigationTarget) => void }) {
  const { text, phase } = item.data;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const rpc = useRpc(getAgentTurnPerformance);
  const query = useQuery({
    queryKey: ["tietiezhi", "agent-turn-performance", agentId],
    queryFn: () => rpc({ agentId }),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: false,
    enabled: phase === "complete",
  });
  const performance = phase === "complete" ? matchReplyPerformance(query.data?.records ?? [], item.data) : undefined;
  const copy = () => {
    setCopyFailed(false);
    void copyText(text).then(() => setCopied(true)).catch(() => setCopyFailed(true));
  };

  return <View testID="tietiezhi-assistant-reply" style={{ gap: 8, minWidth: 0 }}>
    <Markdown text={text} theme={theme} />
    {phase === "complete" && performance ? <ScrollView horizontal testID="tietiezhi-reply-footer" contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="复制回复" onPress={copy} style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 3 }}>
        <Icon name={copied ? "Check" : "Copy"} size={13} color={theme.colors.foregroundMuted} />
        {copied || copyFailed ? <Text style={{ color: copyFailed ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 11 }}>{copyFailed ? "复制失败" : "已复制"}</Text> : null}
      </Pressable>
      {performance.recordId ? <ForkMenu agentId={agentId} host={host} theme={theme} layout={layout} recordId={performance.recordId} replyAt={timestamp.getTime()} onNavigate={onForkNavigate} /> : null}
      {performance ? <>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>工作了 {Math.round(performance.durationMs / 1000)}s</Text>
        <Text style={{ color: theme.colors.statusSuccess, fontSize: 11 }}>· ⚡ {performance.tps} tps</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>· {formatTokens(performance.outputTokens)} 出 / {formatTokens(performance.inputTokens)} 入{performance.cachedTokens ? ` (+${formatTokens(performance.cachedTokens)}缓)` : ""}</Text>
        {performance.steps ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>· {performance.steps} 步</Text> : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>· {performance.model.split("/").pop()}</Text>
      </> : null}
    </ScrollView> : null}
  </View>;
}
