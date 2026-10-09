import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CompactTool } from "../../client/activity.tsx";
import { Runtime } from "./sdk.jsx";
function App() {
  const [status, setStatus] = useState("running");
  const [light, setLight] = useState(false);
  globalThis.__sweep = { status: setStatus, light: setLight };
  const theme = { colors: { surface0: light ? "#f9faf9" : "#171c19", border: light ? "#dddddd" : "#394139", foreground: light ? "#222222" : "#efefef", foregroundMuted: light ? "#606860" : "#9aa59c", statusWarning: "#aa8844", statusDanger: "#dd5555" } };
  return <Runtime.Provider value={{ theme }}><div style={{ background: theme.colors.surface0, color: theme.colors.foreground, padding: 24, minHeight: "100vh" }}>
    <p>正文不受影响</p>
    <CompactTool agentId="agent" host={{ id: "host" }} layout={{ platform: "web", compact: false }} timestamp={new Date(1000)} theme={theme} item={{ data: { name: "codemode", status, detail: { type: "shell", command: "inspect project" }, error: status === "failed" ? "failure detail" : null } }} />
    <p>后续正文</p>
  </div></Runtime.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
