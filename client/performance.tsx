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

function CopyIcon({ size = 13, color = "#8b949e" }: { size?: number; color?: string }) {
  if (typeof document === "undefined") return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ForkIcon({ size = 13, color = "#8b949e" }: { size?: number; color?: string }) {
  if (typeof document === "undefined") return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M16 3h5v5" />
      <path d="M8 3H3v5" />
      <path d="M12 21v-8" />
      <path d="M21 3l-7.5 7.5" />
      <path d="M3 3l7.5 7.5" />
    </svg>
  );
}

/** 1. 彻底由我们接管并重做整行 UI：复制按钮、分叉按钮、耗时、TPS 与 Token 一体化同一行，无缝替换原生旧行 */
export function TurnPerformanceBadge({ item, theme }: PluginTimelineItemProps<TurnPerformanceData>) {
  const data = item?.data;
  const badgeRef = useRef<any>(null);
  const nativeForkRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = badgeRef.current as HTMLElement | null;
    if (!el) return;

    const findNativeFooter = () => {
      let row = el.parentElement;
      while (row && row.parentElement && !row.parentElement.hasAttribute?.("data-stream-view") && row.parentElement !== document.body) {
        if (row.nextElementSibling) break;
        row = row.parentElement;
      }
      if (!row) return false;

      let next = row.nextElementSibling as HTMLElement | null;
      for (let i = 0; i < 4 && next; i++) {
        const isFooter = next.querySelector("[data-testid='turn-working-indicator'], [data-testid*='turn'], button[aria-label*='Copy' i]")
          || next.innerText?.includes("工作了");
        if (isFooter) {
          const forkBtn = next.querySelector<HTMLElement>("button[aria-label*='fork' i], button[aria-label*='分叉' i], [data-testid*='fork']");
          if (forkBtn) nativeForkRef.current = forkBtn;

          // 将原生重复的旧 footer 在视觉与布局上完全隐形（占 0 空间）
          next.style.setProperty("position", "absolute", "important");
          next.style.setProperty("opacity", "0", "important");
          next.style.setProperty("pointer-events", "none", "important");
          next.style.setProperty("height", "0px", "important");
          next.style.setProperty("min-height", "0px", "important");
          next.style.setProperty("margin", "0px", "important");
          next.style.setProperty("padding", "0px", "important");
          next.style.setProperty("overflow", "hidden", "important");
          return true;
        }
        next = next.nextElementSibling as HTMLElement | null;
      }
      return false;
    };

    findNativeFooter();
    const timers = [60, 200, 500, 1200].map((ms) => setTimeout(findNativeFooter, ms));
    return () => { for (const t of timers) clearTimeout(t); };
  }, []);

  if (!data || data.outputTokens <= 0) return null;

  const handleCopy = () => {
    let textToCopy = data.content || "";
    if (!textToCopy && typeof document !== "undefined" && badgeRef.current) {
      let prev = badgeRef.current.parentElement?.previousElementSibling as HTMLElement | null;
      if (prev) textToCopy = prev.innerText || "";
    }
    if (textToCopy) {
      void copyText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  const handleFork = () => {
    if (nativeForkRef.current) {
      nativeForkRef.current.style.pointerEvents = "auto";
      nativeForkRef.current.click();
    }
  };

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
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        paddingTop: 6,
        paddingBottom: 4,
        marginTop: 0,
      }}
    >
      {/* 1. 复制按钮 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="复制消息内容"
        hitSlop={8}
        onPress={handleCopy}
        style={{ flexDirection: "row", alignItems: "center", gap: 3, cursor: "pointer" } as any}
      >
        <CopyIcon size={13} color={copied ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />
        {copied ? (
          <Text style={{ color: theme.colors.statusSuccess, fontSize: 11, fontWeight: "600" }}>已复制</Text>
        ) : null}
      </Pressable>

      {/* 2. 工作树分叉按钮 (完整触发 Paseo 原生分叉菜单) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="分叉工作树"
        hitSlop={8}
        onPress={handleFork}
        style={{ flexDirection: "row", alignItems: "center", cursor: "pointer" } as any}
      >
        <ForkIcon size={13} color={theme.colors.foregroundMuted} />
      </Pressable>

      {/* 3. 单轮真实耗时 */}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
        {durationStr}
      </Text>

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      {/* 4. ⚡ 整轮真实 TPS 速度 */}
      <Text style={{ color: tpsColor, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        ⚡ {data.tps} tps
      </Text>

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      {/* 5. 整轮完整 Token 统计 (过千强制 k) */}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
        {formatTokens(data.outputTokens)} 出 / {formatTokens(data.inputTokens)} 入{cacheStr}
      </Text>

      {/* 6. 多步骤执行提示 */}
      {data.steps && data.steps > 1 ? (
        <>
          <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {data.steps} 步
          </Text>
        </>
      ) : null}

      <Text style={{ color: theme.colors.border, fontSize: 10 }}>·</Text>

      {/* 7. 模型名称 */}
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
