import { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRpc, type PluginSurfaceProps, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { getModelPerformance, type TurnPerformanceData, type ModelPerformanceStats, type PerformanceOverview } from "../shared/performance.ts";
import { hexAlpha } from "./ui.tsx";

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

function cleanModelLabel(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
}

/** 1. 单轮会话结束时在复制操作栏旁边显示的性能徽章 */
export function TurnPerformanceBadge({ item, theme }: PluginTimelineItemProps<TurnPerformanceData>) {
  const data = item?.data;
  if (!data || data.outputTokens <= 0) return null;

  const tpsColor = data.tps >= 50
    ? theme.colors.statusSuccess
    : data.tps >= 25
      ? theme.colors.statusWarning
      : theme.colors.foregroundMuted;

  const durationSec = (data.durationMs / 1000).toFixed(1);
  const cacheRatio = data.cachedTokens > 0
    ? ` (+${formatTokens(data.cachedTokens)}缓)`
    : "";

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 5,
        paddingHorizontal: 0,
        paddingVertical: 1,
        marginTop: 1,
        marginBottom: 2,
        opacity: 0.88,
      }}
    >
      <Text style={{ color: tpsColor, fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
        ⚡ {data.tps} tps
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, opacity: 0.5 }}>·</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>
        {formatTokens(data.inputTokens)}{cacheRatio} 入 / <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{formatTokens(data.outputTokens)} 出</Text>
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, opacity: 0.5 }}>·</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>
        {durationSec}s
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, opacity: 0.5 }}>·</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "500" }}>
        {cleanModelLabel(data.model)}
      </Text>
    </View>
  );
}

/** 2. 铁铁汁面板中的模型平均 TPS 与 Token 消耗大盘 */
export function PerformanceDashboard(props: PluginSurfaceProps) {
  const { theme } = props;
  const rpc = useRpc(getModelPerformance);
  const [query, setQuery] = useState("");

  const queryResult = useQuery<PerformanceOverview>({
    queryKey: ["tietiezhi", "model-performance", query],
    queryFn: () => rpc({ query: query.trim() || undefined }) as Promise<PerformanceOverview>,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const data = queryResult.data;
  const models: ModelPerformanceStats[] = data?.models ?? [];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
      {/* 搜索与刷新栏 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索模型或提供方…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={{
            flex: 1,
            color: theme.colors.foreground,
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 7,
            paddingHorizontal: 10,
            paddingVertical: 7,
            fontSize: 12,
          } as any}
        />
        <Pressable
          onPress={() => void queryResult.refetch()}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 7,
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>刷新</Text>
        </Pressable>
      </View>

      {/* 总体数据汇总卡片 */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 10,
          backgroundColor: theme.colors.surface1,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 110, gap: 3 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>全局平均生成速度</Text>
          <Text style={{ color: theme.colors.statusSuccess, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
            {data?.overallAvgTps ?? 0} <Text style={{ fontSize: 12, fontWeight: "500" }}>tokens/s</Text>
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 110, gap: 3 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>累计输出 Tokens</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
            {formatTokens(data?.totalOutputTokens ?? 0)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 110, gap: 3 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>累计输入 Tokens</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
            {formatTokens(data?.totalInputTokens ?? 0)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 80, gap: 3 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>统计会话轮次</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
            {data?.totalTurns ?? 0}
          </Text>
        </View>
      </View>

      {/* 各模型性能卡片列表 */}
      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 }}>
          模型性能与吞吐统计 ({models.length})
        </Text>

        {queryResult.isLoading && models.length === 0 ? (
          <ActivityIndicator color={theme.colors.accent} style={{ paddingVertical: 20 }} />
        ) : models.length === 0 ? (
          <View style={{ paddingVertical: 24, alignItems: "center" }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {query.trim() ? "未找到匹配的模型记录" : "暂无会话性能数据，开始会话后将自动统计"}
            </Text>
          </View>
        ) : (
          models.map((m) => (
            <ModelStatRow key={`${m.provider}::${m.model}`} stats={m} theme={theme} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function ModelStatRow({ stats, theme }: { stats: ModelPerformanceStats; theme: PluginSurfaceProps["theme"] }) {
  const tpsColor = stats.avgTps >= 50
    ? theme.colors.statusSuccess
    : stats.avgTps >= 25
      ? theme.colors.statusWarning
      : theme.colors.foregroundMuted;

  const totalPromptTokens = stats.totalInputTokens + stats.totalCachedTokens;
  const cacheHitPercent = totalPromptTokens > 0
    ? Math.round((stats.totalCachedTokens / totalPromptTokens) * 100)
    : 0;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>
            {cleanModelLabel(stats.model)}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {stats.provider} · {stats.model}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
            <Text style={{ color: tpsColor, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
              ⚡ {stats.avgTps}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>tokens/s</Text>
          </View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>
            峰值 {stats.maxTps} · 最低 {stats.minTps}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 12,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: hexAlpha(theme.colors.border, 0.6),
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          输出: <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{formatTokens(stats.totalOutputTokens)}</Text>
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          输入: <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{formatTokens(stats.totalInputTokens)}</Text>
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          缓存命中: <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>{cacheHitPercent}%</Text> ({formatTokens(stats.totalCachedTokens)})
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          均次耗时: <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{(stats.avgDurationMs / 1000).toFixed(1)}s</Text>
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          轮次: <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{stats.turnCount}</Text>
        </Text>
      </View>
    </View>
  );
}
