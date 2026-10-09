import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import { contributeSubagentComposer } from "../../client/subagents-composer.tsx";
import { Runtime } from "./sdk.jsx";
let message, removed = 0, subscriptions = 0;
const tool = status => ({ type: "tool_call", callId: "call-1", name: "subagent", status, error: null, detail: { type: "unknown", input: { agent: "worker" }, output: { details: { results: [{ agent: "worker", model: "xai/grok-4.7" }] }, content: [{ type: "text", text: "子代理输出" }] } } });
function App() {
  const [registration, setRegistration] = useState(null), [open, setOpen] = useState(false), [label, setLabel] = useState("");
  const theme = { colors: { surface0: "#171c19", surface1: "#262c28", foreground: "#eeeeee", foregroundMuted: "#888888", statusWarning: "#aa8844", statusDanger: "#dd5555", statusSuccess: "#33aa66" } };
  const props = { theme, host: { id: "host", label: "Host" }, agentId: "agent", layout: { platform: "web", compact: false }, close: () => setOpen(false) };
  useEffect(() => {
    const timeline = { refetch: async () => ({ entries: [] }), subscribe(fn) { subscriptions++; message = fn; const release = () => { subscriptions--; }; release.ready = Promise.resolve(); return release; } };
    const stop = contributeSubagentComposer({ paseo: { agents: { ref: () => ({ timeline }), subscribe: () => () => {}, list: async () => ({ entries: [{ agent: { id: "agent", provider: "pi", workspaceId: "ws" } }], pageInfo: { hasMore: false }, subscription: { release: async () => {} } }) } }, addComposerPill(value) { setRegistration(value); setLabel(value.button.label); return { update: value => setLabel(value.label), remove: () => { removed++; setRegistration(null); } }; } });
    globalThis.__composer = { emit: status => message({ agentId: "agent", event: { type: "timeline", item: tool(status) } }), stats: () => ({ subscriptions, removed }), stop };
    return stop;
  }, []);
  const Status = registration?.button.icon, Content = registration?.button.behavior.Content;
  return <Runtime.Provider value={{ theme }}><div style={{ padding: 16, background: theme.colors.surface0, minHeight: "100vh" }}>{registration ? <><button data-testid="composer-subagents" onClick={() => setOpen(!open)}>{Status ? <Status {...props} /> : null}{label}</button>{open && Content ? <Content {...props} /> : null}</> : null}</div></Runtime.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
