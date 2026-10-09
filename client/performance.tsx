import { useState, useRef, useEffect } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRpc, type PluginSurfaceProps, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { getModelPerformance, formatTokens, type TurnPerformanceData, type ModelPerformanceStats, type PerformanceOverview } from "../shared/performance.ts";
import { hexAlpha } from "./ui.tsx";

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec}s`;
  }
  return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
}

function cleanModelLabel(model: string): string {
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
}

/** 1. 单轮会话结束时，无缝并入原生操作栏同一行展示（复制、分叉均保留） */
export function TurnPerformanceBadge({ item, theme }: PluginTimelineItemProps<TurnPerformanceData>) {
  const data = item?.data;
  const badgeRef = useRef<any>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = badgeRef.current as HTMLElement | null;
    if (!el) return;

    let attached = false;

    const tryAttach = () => {
      let row = el.parentElement;
      while (row && row.parentElement && !row.parentElement.hasAttribute?.("data-stream-view") && row.parentElement !== document.body) {
        if (row.nextElementSibling) break;
        row = row.parentElement;
      }
      if (!row) return false;

      let next = row.nextElementSibling as HTMLElement | null;
      let targetSlot: HTMLElement | null = null;

      for (let i = 0; i < 4 && next; i++) {
        const slot = next.querySelector<HTMLElement>("[data-testid='turn-working-indicator'], [data-testid*='turn']")
          || next.querySelector<HTMLElement>("button")?.parentElement
          || (next.innerText?.includes("工作了") ? next : null);
        if (slot) {
          targetSlot = slot;
          break;
        }
        next = next.nextElementSibling as HTMLElement | null;
      }

      if (targetSlot) {
        row.style.setProperty("display", "none", "important");
        targetSlot.style.setProperty("display", "flex", "important");
        targetSlot.style.setProperty("flex-direction", "row", "important");
        targetSlot.style.setProperty("align-items", "center", "important");
        targetSlot.style.setProperty("flex-wrap", "wrap", "important");
        if (el.parentElement !== targetSlot) {
          targetSlot.appendChild(el);
        }
        el.style.opacity = "1";
        attached = true;
        return true;
      }
      return false;
    };

    tryAttach();
    const timers = [60, 180, 450, 1000].map((ms) => setTimeout(tryAttach, ms));

    let observer: MutationObserver | null = null;
    if (typeof window !== "undefined" && window.MutationObserver) {
      observer = new MutationObserver(() => {
        if (!attached || el.parentElement?.style.display === "none") {
          tryAttach();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      observer?.disconnect();
    };
  }, []);

  if (!data || data.outputTokens <= 0) return null;

  const tpsColor = data.tps >= 50
    ? theme.colors.statusSuccess
    : data.tps >= 25
      ? theme.colors.statusWarning
      : theme.colors.foregroundMuted;

  const durationStr = formatDuration(data.durationMs);
  const cacheStr = data.cachedTokens >= 1_000
    ? ` (+${formatTokens(data.cachedTokens)}缓)`
    : "";

  return (
    <View
      ref={badgeRef}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "nowrap",
        gap: 5,
        marginLeft: 6,
        paddingVertical: 1,
        opacity: 0.92,
      }}
    >
      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      <Text style={{ color: tpsColor, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        ⚡ {data.tps} tps
      </Text>

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
        {formatTokens(data.outputTokens)} 出 / {formatTokens(data.inputTokens)} 入{cacheStr}
      </Text>

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
        耗时 {durationStr}
      </Text>

      {data.steps && data.steps > 1 ? (
        <>
          <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {data.steps} 步
          </Text>
        </>
      ) : null}

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "500" }}>
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
