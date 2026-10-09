import React, { createContext, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
export { ScrollView, TextInput } from "react-native-web";
export const Runtime = createContext(null);
let state;
export function setTestRuntime(value) { state = value; }
export function useHosts() { return useContext(Runtime).hosts; }
export function useRpc(contract) {
  const runtime = useContext(Runtime);
  return (input) => runtime.rpc(contract.name, input);
}
export function useAgent(id, selector) { const runtime = useContext(Runtime); const agent = { id, workspaceId: "workspace-1", title: "Preview Agent", provider: "pi", model: runtime.agentModel ?? "openai-codex/gpt-5.5", status: "idle" }; return selector ? selector(agent) : agent; }
export function usePaseo() {
  return {
    agents: {
      list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }),
      subscribe: () => () => {},
      ref: () => ({ refresh: async () => {} }),
    },
  };
}
export function Icon({ name, size, color }) { return <span aria-hidden="true" style={{ fontSize: size, color }}>◉</span>; }
export function getPaseoClient(serverId) {
  const host = state.hosts.find((h) => h.serverId === serverId);
  if (!host || host.status !== "online") throw new Error("Paseo host is disconnected");
  return {
    agents: {
      subscribe: () => () => {},
      list: async () => ({
        entries: [
          { agent: { id: "shared-id", title: serverId === "local" ? "本机开发任务" : "远程构建任务", provider: "pi", model: "xai/grok",
            status: serverId === "local" ? "idle" : "running", updatedAt: "2026-10-04T10:00:00Z", labels: {} },
            project: { workspaceName: serverId === "local" ? "tietiezhi" : "SlotGame" } },
          ...(serverId === "remote" ? [{ agent: { id: "child-id", title: "子 Agent", provider: "pi", status: "idle",
            updatedAt: "2026-10-04T09:00:00Z", labels: { "paseo.parent-agent-id": "shared-id" } }, project: { workspaceName: "SlotGame" } }] : []),
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      ref: (agentId) => ({ send: async (text, options) => { state.calls.push({ kind: "send", serverId, agentId, text, options }); } }),
    },
  };
}
export async function copyText(text) { state.calls.push({ kind: "copy", text }); }
export async function openExternalUrl(url) { state.calls.push({ kind: "external", url }); }
export function SidebarRow({ id, label, onPress, trailing }) {
  const { theme } = useContext(Runtime);
  return <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 40 }}>
    <button data-testid={id} aria-label={label} onClick={onPress} style={{ flex: 1, minWidth: 0,
      padding: "8px 12px", border: 0, background: "transparent", color: theme.colors.foreground,
      font: "inherit", fontSize: 13, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</button>
    {trailing}
  </div>;
}

// Test-only approximation of the host-owned modal shell. The installed plugin imports the real Paseo Modal.
export function Modal({ title, icon, open, onOpenChange, children }) {
  const { theme, layout } = useContext(Runtime);
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onOpenChange]);
  if (!open) return null;
  const bounded = React.Children.toArray(children).some((child) => React.isValidElement(child) && child.props.scrollable === false);
  const sized = React.Children.toArray(children).some((child) => React.isValidElement(child) && Number.isFinite(child.props.style?.height));
  return createPortal(<div data-testid="dialog-backdrop" onClick={() => onOpenChange(false)} style={{ position: "fixed", inset: 0, zIndex: 100,
    background: "rgba(0,0,0,.65)", display: "flex", alignItems: layout.compact ? "flex-end" : "center", justifyContent: "center" }}>
    <section role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}
      style={{ width: layout.compact ? "100%" : 460, maxWidth: "100%", maxHeight: "85vh", height: bounded || layout.compact ? "85vh" : undefined, display: "flex", flexDirection: "column",
        borderRadius: layout.compact ? "16px 16px 0 0" : 12, background: theme.colors.surface0, color: theme.colors.foreground, overflow: "hidden" }}>
      <header style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{icon}<strong>{title}</strong></div>
        <button aria-label="关闭示例弹窗" onClick={() => onOpenChange(false)}>×</button>
      </header>
      {children}
    </section>
  </div>, document.body);
}
Modal.Content = function Content({ children, scrollable = true, style, contentContainerStyle }) {
  return <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: scrollable ? "auto" : "hidden", ...style }}>
    <div style={{ display: "flex", flexDirection: "column", ...(scrollable ? {} : { flex: 1, minHeight: 0 }),
      padding: 24, gap: 16, ...contentContainerStyle }}>{children}</div>
  </div>;
};
