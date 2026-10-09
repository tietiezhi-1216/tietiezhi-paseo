import { useRef, useState } from "react";
import { Linking, Modal, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { forkReply, createForkOperationId } from "../shared/fork.ts";
import { prepareAgentNavigation, type AgentNavigationTarget } from "../shared/agents.ts";
import { dispatchWebAgentTarget } from "./web.ts";

type Props = Pick<PluginTimelineItemProps, "agentId" | "host" | "theme" | "layout"> & {
  recordId: string; replyAt: number;
  onNavigate?: (target: AgentNavigationTarget) => void;
};

/** React Native portal anchored by measureInWindow; never moves or alters host nodes. */
export function ForkMenu({ agentId, host, theme, layout, recordId, replyAt, onNavigate }: Props) {
  const rpc = useRpc(forkReply);
  const anchor = useRef<View>(null);
  const guard = useRef(false);
  const navigated = useRef(false);
  const operationId = useRef(createForkOperationId());
  const window = useWindowDimensions();
  const [anchorRect, setAnchorRect] = useState({ x: 12, y: 12, height: 0 });
  const [menuHeight, setMenuHeight] = useState(76);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"tab" | "workspace" | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AgentNavigationTarget | null>(null);
  const width = Math.min(target || created || error ? 280 : 128, Math.max(120, window.width - 24));
  const below = anchorRect.y + anchorRect.height + 6;
  const position = {
    x: Math.max(12, Math.min(anchorRect.x, window.width - width - 12)),
    y: below + menuHeight <= window.height - 12
      ? below
      : Math.max(12, anchorRect.y - menuHeight - 6),
  };
  const close = () => { if (!guard.current) setOpen(false); };
  const show = () => {
    if (navigated.current) {
      setCreated(null); setTarget(null); setPrompt(""); setError(null); setMenuHeight(76);
      operationId.current = createForkOperationId(); navigated.current = false;
    }
    anchor.current?.measureInWindow((x, y, _width, height) => {
      setAnchorRect({ x, y, height });
      setOpen(true);
    });
  };
  const navigate = (result: AgentNavigationTarget) => {
    if (onNavigate) onNavigate(result);
    else prepareAgentNavigation({ id: result.agentId, workspaceId: result.workspaceId, serverId: result.serverId }, {
      platform: layout.platform, currentServerId: host.id, dispatchWebTarget: dispatchWebAgentTarget,
      nativeLinking: typeof Linking.emit === "function" && typeof Linking.listenerCount === "function" ? Linking : undefined,
    })();
    navigated.current = true; setOpen(false);
  };
  const submit = async () => {
    if (guard.current || created || !target || !prompt.trim()) return;
    guard.current = true; setBusy(true); setError(null);
    try {
      const result = await rpc({ agentId, serverId: host.id, recordId, replyAt, target, prompt, operationId: operationId.current });
      setCreated(result);
      try { navigate(result); }
      catch { setError("分叉已创建，自动打开失败；可点击下方重试打开。"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分叉失败"); }
    finally { guard.current = false; setBusy(false); }
  };
  const colors = theme.colors;
  return <>
    <Pressable ref={anchor} accessibilityRole="button" accessibilityLabel="分叉回复" accessibilityState={{ expanded: open }} onPress={show} style={{ padding: 3 }}>
      <Icon name="GitBranch" size={13} color={colors.foregroundMuted} />
    </Pressable>
    <Modal transparent visible={open} animationType="none" onRequestClose={close}>
      <View style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭分叉菜单" onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} />
        <View testID="tietiezhi-fork-menu" onLayout={event => setMenuHeight(event.nativeEvent.layout.height)} style={{ position: "absolute", left: position.x, top: position.y, width, maxHeight: Math.max(120, window.height - 24), borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.surface1, padding: 4, gap: 2 }}>
          {!created ? ( ["tab", "workspace"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: target === value }} disabled={busy} onPress={() => { setTarget(value); setError(null); }} style={({ pressed }) => ({ paddingHorizontal: 9, paddingVertical: 7, backgroundColor: target === value || pressed ? colors.surface2 : "transparent", borderRadius: 4 })}>
            <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{value === "tab" ? "分叉到新标签页" : "分叉到新工作区"}</Text>
          </Pressable>) : null}
          {target && !created ? <View style={{ gap: 7, padding: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>填写后续任务，确认后才创建并执行。</Text>
            {target === "workspace" ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>创建 Git worktree，不复制未提交改动。</Text> : null}
            <TextInput accessibilityLabel="分叉后的第一条任务" value={prompt} onChangeText={setPrompt} editable={!busy} multiline placeholder="分叉后继续做什么？" placeholderTextColor={colors.foregroundMuted} style={{ color: colors.foreground, backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, padding: 7, borderRadius: 4, height: 62 }} />
            <Pressable accessibilityRole="button" disabled={busy || !prompt.trim()} onPress={() => void submit()} style={{ padding: 8, borderRadius: 5, backgroundColor: colors.surface2 }}><Text style={{ color: colors.foreground, fontSize: 12 }}>{busy ? "正在分叉…" : "确认分叉并开始任务"}</Text></Pressable>
          </View> : null}
          {error ? <Text selectable style={{ color: colors.statusDanger, fontSize: 12, padding: 8 }}>{error}</Text> : null}
          {created ? <Pressable accessibilityRole="button" onPress={() => { try { navigate(created); } catch { setError("Paseo 导航尚未就绪，分叉已保留，请稍后重试打开。"); } }} style={{ padding: 8 }}><Text style={{ color: colors.accent }}>打开已创建的分叉</Text></Pressable> : null}
        </View>
      </View>
    </Modal>
  </>;
}
