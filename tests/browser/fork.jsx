import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantReply } from "../../client/assistant-reply.tsx";
import { Runtime, setTestRuntime } from "./sdk.jsx";
const calls = [];
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const theme = { colors: { surface0: "#171c19", surface1: "#212722", surface2: "#292f29", border: "#394139", foreground: "#efefef", foregroundMuted: "#9aa59c", accent: "#56aa88", statusSuccess: "#56aa88", statusWarning: "#aa8844", statusDanger: "#dd5555" } };
const record = { model: "pi/model", provider: "pi", content: "Final reply", messageId: "reply", recordId: "record", inputTokens: 10, outputTokens: 20, cachedTokens: 0, durationMs: 1000, tps: 20, timestamp: 2000 };
function App() {
  const [fail, setFail] = useState(false);
  const [navigationFails, setNavigationFails] = useState(false);
  globalThis.__fork = { calls, fail: setFail, navigationFails: setNavigationFails };
  setTestRuntime({ calls });
  const runtime = { async rpc(name, input) {
    if (name === "slotgame.performance.agent_turns") return { records: [record] };
    calls.push({ kind: "fork", input });
    if (fail) throw new Error("测试分叉失败");
    return { agentId: "created", workspaceId: input.target === "tab" ? "original" : "new-workspace", serverId: input.serverId };
  } };
  return <QueryClientProvider client={queries}><Runtime.Provider value={runtime}><div style={{ background: theme.colors.surface0, minHeight: "100vh", padding: 20, paddingTop: new URLSearchParams(location.search).has("bottom") ? "calc(100vh - 120px)" : 20 }}>
    <AssistantReply agentId="source" host={{ id: "host" }} layout={{ platform: "web", compact: false }} timestamp={new Date(1000)} theme={theme} item={{ data: { text: "Final reply", messageId: "reply", phase: "complete" } }} onForkNavigate={input => { if (navigationFails) throw new Error("not ready"); calls.push({ kind: "navigate", input }); }} />
  </div></Runtime.Provider></QueryClientProvider>;
}
createRoot(document.getElementById("root")).render(<App />);
