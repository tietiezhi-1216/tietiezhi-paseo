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
  // Never substitute whole-turn throughput (which includes tool execution)
  // when native response timing is unavailable.
  const responseTps = performance?.modelDurationMs !== undefined && performance.modelDurationMs > 0
    && Number.isFinite(performance.modelDurationMs) && performance.modelTps !== undefined
    && Number.isFinite(performance.modelTps) && performance.modelTps >= 0 ? performance.modelTps : undefined;
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
        {responseTps !== undefined ? <Text numberOfLines={1} testID="reply-tps" accessibilityLabel="response tps: output tokens divided by summed model response durations, including first-token wait and excluding tool execution; not pure decoding speed" style={metricStyle}>{responseTps} tps ·</Text> : null}
        <Text numberOfLines={1} testID="reply-duration" accessibilityLabel="处理时间：整轮耗时，包含工具执行及等待" style={metricStyle}>{formatPerformanceDuration(performance.durationMs)} ·</Text>
        <Text numberOfLines={1} testID="reply-input" style={metricStyle}>input {formatTokens(performance.inputTokens).toLowerCase()}</Text>
        <Text numberOfLines={1} style={metricStyle}>· output {formatTokens(performance.outputTokens).toLowerCase()}</Text>
        <Text numberOfLines={1} accessibilityLabel="cache hit: cached input divided by non-cached input plus cached input" style={metricStyle}>· hit {formatCacheHit(performance.inputTokens, performance.cachedTokens)}</Text>
      </> : null}
    </ScrollView> : null}
  </View>;
}
