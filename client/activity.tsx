import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { z } from "zod";
import { CompactToolSchema, CompactReasoningSchema, activitySummary, reasoningSummary } from "../shared/activity.ts";
import { Markdown } from "./markdown.tsx";
import { RunningSweep } from "./running-sweep.tsx";

type ToolData = z.infer<typeof CompactToolSchema>;
type ReasoningData = z.infer<typeof CompactReasoningSchema>;

export function CompactTool({ item, theme }: PluginTimelineItemProps<ToolData>) {
  const { name, status, detail, error } = item.data;
  const [expanded, setExpanded] = useState(false);
  const failed = status === "failed";
  // Failures are never silently hidden. The user can still collapse them explicitly.
  const [collapseError, setCollapseError] = useState(false);
  const open = expanded || failed && !collapseError;
  const color = failed ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  const summary = activitySummary(detail);
  return <View testID="tietiezhi-compact-tool" style={{ minWidth: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${open ? "收起" : "展开"}工具 ${name}${status === "running" ? "（执行中）" : ""}`} accessibilityState={{ expanded: open, busy: status === "running" }} aria-busy={status === "running"} aria-expanded={open} onPress={() => { setExpanded(!open); setCollapseError(open); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={color} />
      {status === "running" ? <RunningSweep text={`${name}${summary ? `  ${summary}` : ""}`} color={color} highlightColor={theme.colors.foreground} style={{ fontSize: 12, lineHeight: 18, flex: 1, minWidth: 0 }} /> : <>
        <Text style={{ color, fontSize: 12, lineHeight: 18 }}>{name}</Text>
        <Text numberOfLines={1} style={{ color, fontSize: 12, lineHeight: 18, flex: 1, minWidth: 0 }}>{summary}</Text>
      </>}
      {failed ? <Text style={{ color, fontSize: 11 }}>失败</Text> : null}
    </Pressable>
    {open ? <View style={{ paddingLeft: 18, paddingVertical: 6, gap: 5, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
      {error ? <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, userSelect: "text" }}>{error}</Text> : null}
      <ScrollView horizontal contentContainerStyle={{ paddingRight: 12 }}><Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 19, userSelect: "text" }}>{JSON.stringify(detail, null, 2)}</Text></ScrollView>
    </View> : null}
  </View>;
}

export function CompactReasoning({ item, theme }: PluginTimelineItemProps<ReasoningData>) {
  const { text, phase } = item.data;
  const [open, setOpen] = useState(false);
  return <View testID="tietiezhi-compact-reasoning" style={{ minWidth: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? "收起思考" : "展开思考"} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{phase === "streaming" ? "思考中" : "思考"}</Text>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 }}>{reasoningSummary(text)}</Text>
    </Pressable>
    {open ? <View style={{ paddingLeft: 18, paddingVertical: 6, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}><Markdown text={text} theme={theme} /></View> : null}
  </View>;
}
