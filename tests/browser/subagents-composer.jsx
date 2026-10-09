import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import { contributeSubagentComposer } from "../../client/subagents-composer.tsx";
import { Runtime } from "./sdk.jsx";
let update, removed = 0, subscriptions = 0, opened = null;
const archived = [];
const paseo = { agents: { ref: id => ({ archive: async () => { archived.push(id); } }) }, workspaces: { archive() { throw new Error("must never archive workspace"); } } };
const child = (status, requiresAttention = false) => ({ id: "child", provider: "pi", workspaceId: "ws", title: "审查登录", status, requiresAttention, attentionReason: requiresAttention ? "finished" : null, labels: { "paseo.parent-agent-id": "agent" } });
function App() {
  const [registration, setRegistration] = useState(null), [open, setOpen] = useState(false), [label, setLabel] = useState("");
  const theme = { colors: { surface0: "#171c19", surface1: "#262c28", foreground: "#eeeeee", foregroundMuted: "#888888", statusWarning: "#aa8844", statusDanger: "#dd5555", statusSuccess: "#33aa66" } };
  const props = { theme, host: { id: "host", label: "Host" }, agentId: "agent", layout: { platform: "web", compact: false }, navigation: { openAgent: value => { opened = value; } }, close: () => setOpen(false) };
  useEffect(() => {
    const stop = contributeSubagentComposer({ paseo: { agents: { subscribe(fn) { subscriptions++; update = fn; return () => { subscriptions--; }; }, list: async () => ({ entries: [{ agent: { id: "agent", provider: "pi", workspaceId: "ws" } }], pageInfo: { hasMore: false }, subscription: { release: async () => {} } }) } }, addComposerPill(value) {
      if (value.agentId !== "agent") return { update() {}, remove() {} };
      setRegistration(value); setLabel(value.button.label);
      return { update: patch => { if (patch.label !== undefined) setLabel(patch.label); setRegistration(previous => ({ ...previous, button: { ...previous.button, ...patch } })); }, remove: () => { removed++; setRegistration(null); } };
    } });
    globalThis.__composer = { clear: () => update({ kind: "remove", agentId: "child" }), emit: status => update({ kind: "upsert", agent: child(status === "completed" ? "idle" : status, status === "completed") }), stats: () => ({ subscriptions, removed, opened, archived }), stop };
    return stop;
  }, []);
  const Status = registration?.button.icon, Content = registration?.button.behavior.Content;
  return <Runtime.Provider value={{ theme, paseo }}><div style={{ padding: 16, background: theme.colors.surface0, minHeight: "100vh" }}>{registration && registration.button.visible !== false ? <><button data-testid="composer-subagents" onClick={() => setOpen(!open)}>{Status ? <Status {...props} /> : null}{label}</button>{open && Content ? <Content {...props} /> : null}</> : null}</div></Runtime.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
