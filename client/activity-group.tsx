import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { z } from "zod";
import { CompactActivityGroupSchema } from "../shared/activity.ts";
import { CompactTool, CompactReasoning } from "./activity.tsx";
import { RunningSweep } from "./running-sweep.tsx";

type GroupData = z.infer<typeof CompactActivityGroupSchema>;
/** Requires the source-side Paseo layout adapter; old hosts never emit this kind. */
export function CompactActivityGroup(props: PluginTimelineItemProps<GroupData>) {
  const { item, theme } = props;
  const [open, setOpen] = useState(false);
  const rows = item.data.items;
  const tools = rows.filter(row => row.kind === "compact-tool");
  const thoughts = rows.length - tools.length;
  const failed = tools.filter(row => row.data.status === "failed").length;
  const running = rows.some(row => row.kind === "compact-tool" ? row.data.status === "running" : row.data.phase === "streaming");
  const title = `执行过程${tools.length ? ` · ${tools.length} 次工具调用` : ""}${thoughts ? ` · ${thoughts} 段思考` : ""}`;
  return <View testID="tietiezhi-activity-group" style={{ minWidth: 0 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${open ? "收起" : "展开"}执行过程${running ? "（执行中）" : ""}`} accessibilityState={{ expanded: open, busy: running }} aria-expanded={open} aria-busy={running} onPress={() => setOpen(!open)} style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 3, borderRadius: 4, overflow: "hidden" }}>
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />
      {running ? <RunningSweep text={title} color={theme.colors.foregroundMuted} highlightColor={theme.colors.foreground} style={{ fontSize: 12, lineHeight: 18, flexShrink: 1 }} /> : <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18, flexShrink: 1 }}>{title}</Text>}
      {failed ? <Text style={{ color: theme.colors.statusDanger, fontSize: 11 }}>{failed} 次失败</Text> : null}
    </Pressable>
    {open ? <View style={{ paddingLeft: 16, paddingVertical: 5, gap: 3, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
      {rows.map(row => row.kind === "compact-tool"
        ? <CompactTool {...props} key={row.id} timestamp={new Date(row.timestamp)} item={{ type: "plugin", kind: row.kind, version: row.version, data: row.data }} />
        : <CompactReasoning {...props} key={row.id} timestamp={new Date(row.timestamp)} item={{ type: "plugin", kind: row.kind, version: row.version, data: row.data }} />)}
    </View> : null}
  </View>;
}
