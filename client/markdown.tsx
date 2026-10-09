import { useMemo } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { parseInline, parseMarkdown, type InlineNode, type MarkdownBlock } from "../shared/markdown.ts";

type Theme = PluginTimelineItemProps["theme"];

function Spans({ nodes, theme }: { nodes: InlineNode[]; theme: Theme }) {
  return <>{nodes.map((node, i) => {
    if (node.kind === "text") return node.text;
    if (node.kind === "code") return <Text key={i} selectable style={{ fontFamily: "monospace", fontSize: 13, backgroundColor: theme.colors.surface2, color: theme.colors.foreground }}>{node.text}</Text>;
    if (node.kind === "link") return <Text key={i} selectable accessibilityRole="link" onPress={() => { void Linking.openURL(node.href).catch(() => {}); }} style={{ color: theme.colors.accent, textDecorationLine: "underline" }}><Spans nodes={node.children} theme={theme} /></Text>;
    if ("children" in node) return <Text key={i} selectable style={{ fontWeight: node.kind === "strong" ? "700" : undefined, fontStyle: node.kind === "em" ? "italic" : undefined, textDecorationLine: node.kind === "strike" ? "line-through" : undefined }}><Spans nodes={node.children} theme={theme} /></Text>;
    return null;
  })}</>;
}

function Inline({ text, theme, strong = false }: { text: string; theme: Theme; strong?: boolean }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <Text selectable style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 23, fontWeight: strong ? "600" : undefined, userSelect: "text" }}><Spans nodes={nodes} theme={theme} /></Text>;
}

function Blocks({ blocks, theme }: { blocks: MarkdownBlock[]; theme: Theme }) {
  return <View style={{ gap: 10, minWidth: 0 }}>{blocks.map((block, i) => {
    switch (block.kind) {
      case "paragraph": return <Inline key={i} text={block.text} theme={theme} />;
      case "heading": return <Text key={i} selectable accessibilityRole="header" style={{ color: theme.colors.foreground, fontWeight: "700", fontSize: [22, 20, 17, 15, 14, 14][block.level - 1], lineHeight: 29, marginTop: i ? 6 : 0, userSelect: "text" }}><Spans nodes={parseInline(block.text)} theme={theme} /></Text>;
      case "rule": return <View key={i} style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 6 }} />;
      case "quote": return <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.border, paddingLeft: 12, paddingVertical: 3 }}><Blocks blocks={block.blocks} theme={theme} /></View>;
      case "code": return <View key={i} testID="tietiezhi-markdown-code" style={{ borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, borderRadius: 8, overflow: "hidden" }}>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>{block.language}</Text>
        <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 20, userSelect: "text" }}>{block.text}</Text>
        </ScrollView>
      </View>;
      case "list": return <View key={i} testID="tietiezhi-markdown-list" style={{ gap: 5 }}>{block.items.map((item, n) => <View key={n} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Text selectable style={{ color: theme.colors.foregroundMuted, minWidth: 18, fontSize: 14, lineHeight: 23, textAlign: "right" }}>{item.checked === undefined ? item.marker : item.checked ? "☑" : "☐"}</Text>
        <View style={{ flex: 1, minWidth: 0 }}><Blocks blocks={item.blocks} theme={theme} /></View>
      </View>)}</View>;
      case "table": {
        const count = Math.max(...block.rows.map(row => row.length));
        // Shared column widths keep header/body aligned without querying the DOM.
        const widths = Array.from({ length: count }, (_, column) => Math.min(340, Math.max(100, ...block.rows.map(row => (row[column]?.length ?? 0) * 9 + 24))));
        return <ScrollView key={i} horizontal testID="tietiezhi-markdown-table" style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7 }}>
          <View>{block.rows.map((row, n) => <View key={n} style={{ flexDirection: "row", backgroundColor: n === 0 ? theme.colors.surface1 : "transparent", borderBottomWidth: n < block.rows.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border }}>
            {widths.map((width, column) => <View key={column} style={{ width, paddingHorizontal: 10, paddingVertical: 7, borderRightWidth: column < count - 1 ? 1 : 0, borderRightColor: theme.colors.border }}>
              <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 21, fontWeight: n === 0 ? "600" : undefined, textAlign: block.align[column] ?? "left", userSelect: "text" }}><Spans nodes={parseInline(row[column] ?? "")} theme={theme} /></Text>
            </View>)}
          </View>)}</View>
        </ScrollView>;
      }
    }
  })}</View>;
}

export function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <View testID="tietiezhi-markdown" style={{ minWidth: 0 }}><Blocks blocks={blocks} theme={theme} /></View>;
}
