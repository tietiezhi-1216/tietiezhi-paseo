import { useState } from "react";
import { Pressable, ScrollView, Text, View, type TextStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import { getAgentTurnPerformance, matchReplyPerformance, formatTokens, formatPerformanceDuration, formatCacheHit, type AssistantReplyData } from "../shared/performance.ts";

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
  const metricStyle: TextStyle = { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16, fontWeight: "400", fontVariant: ["tabular-nums"], flexShrink: 0 };
  const copy = () => {
    setCopyFailed(false);
    void copyText(text).then(() => setCopied(true)).catch(() => setCopyFailed(true));
  };

  return <View testID="tietiezhi-assistant-reply" style={{ gap: 8, minWidth: 0 }}>
    <Markdown text={text} theme={theme} />
    {phase === "complete" && performance ? <ScrollView horizontal testID="tietiezhi-reply-footer" contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="复制回复" onPress={copy} style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 3 }}>
        <Icon name={copied ? "Check" : "Copy"} size={13} color={theme.colors.foregroundMuted} />
        {copied || copyFailed ? <Text style={{ color: copyFailed ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 11 }}>{copyFailed ? "copy failed" : "copied"}</Text> : null}
      </Pressable>
      {performance.recordId ? <ForkMenu agentId={agentId} host={host} theme={theme} layout={layout} recordId={performance.recordId} replyAt={timestamp.getTime()} onNavigate={onForkNavigate} /> : null}
      {performance ? <>
        <Text numberOfLines={1} testID="reply-tps" accessibilityLabel={performance.modelTps !== undefined ? "response tps: whole-turn output divided by summed response durations; includes first-token wait, excludes tools" : "turn tps: output divided by whole-turn duration, including tools and waits; response timing unavailable"} style={metricStyle}>{performance.modelTps ?? performance.tps} {performance.modelTps !== undefined ? "tps" : "turn tps"}</Text>
        <Text numberOfLines={1} testID="reply-ttft" accessibilityLabel="ttft: measured time to first token; — means unavailable" style={metricStyle}>· ttft {formatPerformanceDuration(performance.ttftMs, true)}</Text>
        <Text numberOfLines={1} testID="reply-duration" style={metricStyle}>· {formatPerformanceDuration(performance.durationMs)}</Text>
        <Text numberOfLines={1} style={metricStyle}>· input {formatTokens(performance.inputTokens).toLowerCase()}</Text>
        <Text numberOfLines={1} style={metricStyle}>· output {formatTokens(performance.outputTokens).toLowerCase()}</Text>
        <Text numberOfLines={1} style={metricStyle}>· cache {formatTokens(performance.cachedTokens).toLowerCase()}</Text>
        <Text numberOfLines={1} accessibilityLabel="cache hit: cached input divided by non-cached input plus cached input" style={metricStyle}>· hit {formatCacheHit(performance.inputTokens, performance.cachedTokens)}</Text>
        <Text numberOfLines={1} style={metricStyle}>· {performance.model.split("/").pop()}</Text>
      </> : null}
    </ScrollView> : null}
  </View>;
}
