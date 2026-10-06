import { useEffect, useReducer, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Modal, ScrollView, TextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { DEMO_LOGS, filterDemoLogs, formatDemoLogs, type DemoLog, type DemoLogFilter } from "../shared/dialog-log.ts";
import { DEMO_TASK_INTERVAL_MS, INITIAL_DEMO_TASK, demoTaskReducer, getDemoTaskView } from "../shared/demo-progress.ts";
import { Action, Notice, Tabs } from "./ui.tsx";

export function DialogDemoSidebar(props: PluginSidebarItemProps) {
  return <DialogDemoBody key={props.host.id} {...props} />;
}
function DialogDemoBody({ theme, host, layout }: PluginSidebarItemProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<DemoLogFilter>("all");
  const [query, setQuery] = useState("");
  const [logs, setLogs] = useState<DemoLog[]>([...DEMO_LOGS]);
  const [notice, setNotice] = useState("");
  const [task, dispatch] = useReducer(demoTaskReducer, INITIAL_DEMO_TASK);
  const progress = getDemoTaskView(task);
  const rows = filterDemoLogs(logs, filter, query);
  const inset = layout.compact ? 14 : 20;

  useEffect(() => {
    if (task.status !== "running") return;
    const runId = task.runId;
    const timer = setInterval(() => dispatch({ type: "tick", runId }), DEMO_TASK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [task.status, task.runId]); // Closing the Dialog does not stop the sidebar demonstration.

  const toggleProgress = () => dispatch({ type: task.status === "running" ? "pause" : "start" });

  return (
    <>
      <View style={{ minWidth: 0 }}>
        <SidebarRow icon="MessageSquare" label={progress.sidebarTitle} id="dialog-demo-trigger" onPress={() => {
          setQuery(""); setFilter("all"); setNotice(""); setLogs([...DEMO_LOGS]); setOpen(true);
        }} trailing={
          <Pressable accessibilityRole="button" accessibilityLabel={progress.controlTitle} accessibilityHint="仅控制本地模拟进度"
            onPress={toggleProgress} testID="sidebar-demo-toggle"
            style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", padding: 6 }}>
            <Text style={{ color: theme.colors.accent, fontSize: 14 }}>{progress.controlSymbol}</Text>
          </Pressable>
        } />
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 5 }}>
          <DemoProgressBar theme={theme} value={progress.percent} testID="sidebar-demo-progress" />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }} testID="sidebar-demo-stage">{progress.stepLabel} · 模拟</Text>
        </View>
      </View>
      <Modal title={progress.modalTitle} open={open} onOpenChange={setOpen}>
        <Modal.Content scrollable={false} style={{ backgroundColor: theme.colors.surface0 }}
          contentContainerStyle={{ padding: 0, gap: 0, flex: 1, minHeight: 0 }}>
          <View style={{ flex: 1, minHeight: 0 }}>
            <View style={{ padding: inset, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "700" }}>对话记录</Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>模拟 · 不执行任务</Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.label}</Text>
              </View>
              <DemoProgressBar theme={theme} value={progress.percent} testID="dialog-demo-progress" />
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Text style={{ flex: 1, minWidth: 120, color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {progress.stepLabel}
                </Text>
                <Action theme={theme} title={progress.controlTitle} onPress={toggleProgress} testID="dialog-demo-toggle" />
                <Action theme={theme} title="重置" onPress={() => dispatch({ type: "reset" })} testID="dialog-demo-reset" />
              </View>
              <TextInput value={query} onChangeText={setQuery} placeholder="搜索消息或工具记录…" placeholderTextColor={theme.colors.foregroundMuted}
                accessibilityLabel="搜索示例日志" testID="dialog-log-search" autoCapitalize="none" autoCorrect={false}
                style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: 10 }} />
              <Tabs theme={theme} items={[["all", "全部"], ["messages", "消息"], ["tools", "工具"]]} value={filter} onChange={setFilter} prefix="dialog-filter" />
            </View>

            <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: inset, gap: 12 }} testID="dialog-log-list">
              {rows.map((log) => (
                <View key={log.id} testID="dialog-log-row" style={{ padding: 13, gap: 8, backgroundColor: theme.colors.surface1, borderRadius: 8,
                  borderLeftWidth: 3, borderLeftColor: log.role === "user" ? theme.colors.accent : log.role === "tool" ? theme.colors.statusWarning : theme.colors.statusSuccess }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>{log.title}</Text>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{log.time}</Text>
                  </View>
                  <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 21,
                    ...(log.role === "tool" ? { fontFamily: layout.platform === "ios" ? "Menlo" : "monospace" } : {}) }}>{log.text}</Text>
                </View>
              ))}
              {rows.length === 0 ? <Notice theme={theme} text="没有匹配的模拟记录。" /> : null}
            </ScrollView>

            <View style={{ padding: inset, gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              <Notice theme={theme} text={`${rows.length} / ${logs.length}`} />
              {notice ? <Notice theme={theme} text={notice} /> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Action theme={theme} title="追加模拟日志" label="追加" testID="dialog-append" disabled={logs.length >= 20} onPress={() => {
                  setLogs((current) => [...current, { id: `added-${current.length}`, role: "assistant", title: "Agent · 新增示例",
                    time: "10:43:00", text: "新增模拟记录。" }]);
                  setFilter("all"); setQuery(""); setNotice("已追加");
                }} />
                <Action theme={theme} title="复制显示的日志" label="复制" disabled={rows.length === 0} onPress={() => {
                  void copyText(formatDemoLogs(rows)).then(() => setNotice("已复制")).catch(() => setNotice("复制失败，可手动选择文字。"));
                }} />
                <Action theme={theme} title="关闭弹窗" label="关闭" testID="dialog-close" onPress={() => setOpen(false)} />
              </View>
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

function DemoProgressBar({ theme, value, testID }: { theme: PluginTheme; value: number; testID: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="模拟任务进度"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}%（模拟）`} testID={testID}
      style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: "hidden" }}>
      <View style={{ height: 6, width: `${value}%`, backgroundColor: value === 100 ? theme.colors.statusSuccess : theme.colors.accent }} />
    </View>
  );
}
