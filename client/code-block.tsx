import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";

type Props = { text: string; language: string; theme: PluginTimelineItemProps["theme"] };

/** Always-visible native copy control. Copy the source string, never rendered text or DOM. */
export function CodeBlock({ text, language, theme }: Props) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const currentText = useRef(text);
  currentText.current = text;
  const alive = useRef(true);
  const busy = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReset = () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearReset(); };
  }, []);
  useEffect(() => { clearReset(); if (!busy.current) setStatus("idle"); }, [text]);
  const copy = async () => {
    if (busy.current) return;
    busy.current = true; clearReset(); setStatus("copying");
    const source = text;
    try {
      await copyText(source);
      if (!alive.current) return;
      if (currentText.current !== source) { setStatus("idle"); return; }
      setStatus("copied");
      resetTimer.current = setTimeout(() => { if (alive.current) setStatus("idle"); }, 1500);
    } catch {
      if (alive.current) setStatus(currentText.current === source ? "failed" : "idle");
    } finally { busy.current = false; }
  };
  const colors = theme.colors;
  const color = status === "copied" ? colors.statusSuccess : status === "failed" ? colors.statusDanger : colors.foregroundMuted;
  return <View testID="tietiezhi-markdown-code" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, borderRadius: 8, overflow: "hidden", minWidth: 0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 12, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1 }}>{language || "text"}</Text>
      <Pressable testID="tietiezhi-code-copy" accessibilityRole="button" accessibilityLabel="复制代码块" accessibilityHint="仅复制块内原文，保留换行和缩进" accessibilityState={{ disabled: status === "copying" }}
        disabled={status === "copying"} hitSlop={8} onPress={event => { event.stopPropagation(); void copy(); }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 28, paddingHorizontal: 5, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
        <Icon name={status === "copied" ? "Check" : "Copy"} size={12} color={color} />
        <Text accessibilityLiveRegion="polite" style={{ color, fontSize: 11 }}>{status === "copying" ? "复制中…" : status === "copied" ? "已复制" : status === "failed" ? "复制失败，重试" : "复制"}</Text>
      </Pressable>
    </View>
    <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
      <Text selectable style={{ color: colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 20, userSelect: "text" }}>{text}</Text>
    </ScrollView>
  </View>;
}
