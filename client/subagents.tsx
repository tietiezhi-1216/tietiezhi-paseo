import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { SubagentPillSchema, subagentPillData, SUBAGENT_STATE_LABELS, type SubagentPillData } from "../shared/subagents.ts";

export function SubagentPill({ item, theme }: PluginTimelineItemProps<SubagentPillData>) {
  const data = item.data;
  const [expanded, setExpanded] = useState(false);
  const color = data.state === "failed" ? theme.colors.statusDanger : data.state === "running" || data.state === "submitted" ? theme.colors.statusWarning : data.state === "done" ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
  const label = SUBAGENT_STATE_LABELS[data.state];
  return <View testID="subagent-pill" style={{ minWidth: 0, gap: 6, paddingVertical: 3 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`子代理 ${data.title} ${label}`} accessibilityState={{ expanded, busy: data.state === "running" }} onPress={() => setExpanded(!expanded)} style={{ alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: theme.colors.surface1 }}>
      <Icon name="Users" size={13} color={color} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: theme.colors.foreground, fontSize: 12 }}>{data.title}</Text>
      <Text style={{ color, fontSize: 11 }}>{label}{data.children.length ? ` · ${data.children.length}` : ""}</Text>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
    </Pressable>
    {data.error ? <Text selectable accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{data.error}</Text> : null}
    {expanded ? <View style={{ paddingHorizontal: 10, gap: 6 }}>
      {data.runId ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Run · {data.runId}</Text> : null}
      {data.children.map((child, index) => <View key={index} style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{child.name} · {child.state}</Text>
        {child.model || child.tool ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{[child.model, child.tool].filter(Boolean).join(" · ")}</Text> : null}
      </View>)}
      {data.output ? <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{data.output}</Text> : null}
    </View> : null}
  </View>;
}

export function contributeSubagentPills(client: PluginClientContext) {
  const stops = [
    client.addTimelineTransformer({ id: "pi-subagent-pill", query: { itemType: "tool_call" }, transform({ item }) {
      const data = subagentPillData(item);
      return data ? { items: [{ type: "plugin", kind: "pi-subagent-pill", version: 1, data }] } : undefined;
    } }),
    client.addTimelineRenderer({ kind: "pi-subagent-pill", version: 1, schema: SubagentPillSchema, Component: SubagentPill }),
  ];
  return () => { for (const stop of [...stops].reverse()) stop(); };
}
