import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SubagentPill } from "../../client/subagents.tsx";
import { Runtime } from "./sdk.jsx";
function App() {
  const [state, setState] = useState("running"), [light, setLight] = useState(false);
  globalThis.__subagents = { state: setState, light: setLight };
  const theme = { colors: { surface0: light ? "#fafafa" : "#171c19", surface1: light ? "#eeeeee" : "#262c28", foreground: light ? "#222222" : "#eeeeee", foregroundMuted: "#888888", statusWarning: "#aa8844", statusDanger: "#dd5555", statusSuccess: "#33aa66" } };
  return <Runtime.Provider value={{ theme }}><div style={{ padding: 16, background: theme.colors.surface0, minHeight: "100vh" }}>
    <SubagentPill theme={theme} host={{ id: "host" }} layout={{ platform: "web", compact: true }} agentId="agent" timestamp={new Date()} item={{ data: { title: "子代理工作流", state, runId: "run-123", children: [{ name: "scout", model: "xai/grok-4.7", state: "running", tool: "read" }], output: "真实工具输出", error: state === "failed" ? "运行失败" : null } }} />
  </div></Runtime.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
