import { View } from "react-native";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { z } from "zod";
import { RunningSweep } from "./running-sweep.tsx";
import { reasoningSummary } from "../shared/activity.ts";

const LiveThinkingSchema = z.object({ text: z.string() });

/** Presentation only: no history writes, subscriptions, buttons or popovers. */
export function LiveThinking({ item, theme }: PluginTimelineItemProps<z.infer<typeof LiveThinkingSchema>>) {
  return <View testID="tietiezhi-live-thinking" style={{ minWidth: 0, paddingVertical: 2 }}>
    <RunningSweep text={item.data.text} color={theme.colors.foregroundMuted} highlightColor={theme.colors.foreground}
      style={{ fontSize: 12, lineHeight: 18, minWidth: 0 }} />
  </View>;
}

export function contributeThinking(client: PluginClientContext) {
  let complete = false;
  let removeTransformer: (() => void) | undefined;
  const register = () => {
    removeTransformer?.();
    const showComplete = complete;
    removeTransformer = client.addTimelineTransformer({
      id: "thinking-display", query: { itemType: "reasoning" },
      transform({ item, phase }) {
        if (showComplete) return { items: [{ type: "plugin", kind: "compact-reasoning", version: 1, data: { text: item.text, phase } }] };
        // This is the host's loading thought, not an append-only plugin record.
        // Once it becomes history, remove the entire item before tool grouping.
        if (phase !== "streaming") return { items: [] };
        const text = reasoningSummary(item.text).slice(0, 180);
        return { items: [{ type: "plugin", kind: "live-thinking", version: 1, data: { text: text || "思考中…" } }] };
      },
    });
  };
  register();
  const removeRenderer = client.addTimelineRenderer({ kind: "live-thinking", version: 1, schema: LiveThinkingSchema, Component: LiveThinking });
  // Previously appended experiment rows cannot be deleted through the SDK.
  // Suppress their contents; old wrappers may retain a small host-owned gap.
  const removeLegacy = client.addTimelineRenderer({ kind: "turn-thinking", version: 1, schema: z.unknown(), Component: () => null });
  const removeCommand = client.addCommandCenterItem({
    id: "thinking-display", title: "切换思考显示（仅实时／完整）", icon: "Brain", context: "global",
    keywords: ["thinking", "思考", "简洁"], onSelect() { complete = !complete; register(); },
  });
  return () => { removeTransformer?.(); removeCommand(); removeLegacy(); removeRenderer(); };
}
