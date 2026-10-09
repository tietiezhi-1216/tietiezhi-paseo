import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { createStreamPresentation } from "@paseo-prototype/presentation";
import { CompactActivityGroup } from "../../client/activity-group.tsx";
import { CompactActivityGroupSchema } from "../../shared/activity.ts";
import { Runtime } from "./sdk.jsx";
const theme = { colors: { surface0: "#171c19", surface1: "#212722", surface2: "#292f29", border: "#394139", foreground: "#efefef", foregroundMuted: "#9aa59c", accent: "#56aa88", statusWarning: "#aa8844", statusDanger: "#dd5555" } };
const timestamp = new Date("2026-01-01T00:00:00Z");
const body = id => ({ kind: "assistant_message", id, text: id, timestamp });
const initial = [body("正文一"), ...Array.from({ length: 50 }, (_, index) => index % 2 === 0
  ? { kind: "thought", id: `thought-${index}`, timestamp, text: `Inspecting step ${index}`, status: "ready" }
  : { kind: "tool_call", id: `tool-${index}`, timestamp, payload: { source: "agent", data: { provider: "pi", callId: String(index), name: "bash", status: index === 49 ? "running" : "completed", detail: { type: "shell", command: `command-${index}` }, error: null } } }), body("正文二")];
const transform = Object.assign(({ item, sourceId, phase }) => {
  if (item.type === "reasoning") return [{ type: "plugin", id: sourceId, pluginId: "tietiezhi", kind: "compact-reasoning", version: 1, data: { text: item.text, phase } }];
  if (item.type === "tool_call") return [{ type: "plugin", id: sourceId, pluginId: "tietiezhi", kind: "compact-tool", version: 1, data: { name: item.name, status: item.status, detail: item.detail, error: item.error ? item.error.message : null } }];
  return undefined;
}, { compactActivityGrouping: true });
function App() {
  const [source, setSource] = useState(initial);
  const present = useMemo(() => createStreamPresentation(), []);
  const projection = present({ tail: source, head: [], transform, level: "detailed", isTurnActive: true });
  globalThis.__group = {
    fail: () => setSource(old => old.map(row => row.id === "tool-49" ? { ...row, payload: { ...row.payload, data: { ...row.payload.data, status: "failed", error: { message: "permission denied" } } } } : row)),
    sourceCount: source.length, rowCount: projection.tail.length,
  };
  return <Runtime.Provider value={{ theme }}><div style={{ display: "flex", flexDirection: "column", background: theme.colors.surface0, color: theme.colors.foreground, padding: 24, minHeight: "100vh" }}>
    {projection.tail.map(row => <div key={row.id} data-testid="host-frame" style={{ marginBottom: 16 }}>
      {row.kind === "plugin" ? <CompactActivityGroup agentId="agent" theme={theme} host={{ id: "host" }} layout={{ platform: "web", compact: false }} timestamp={row.timestamp} item={{ type: "plugin", kind: row.itemKind, version: row.version, data: CompactActivityGroupSchema.parse(row.data) }} /> : <p style={{ margin: 0, fontSize: 14, lineHeight: "20px" }}>{row.text}</p>}
    </div>)}
  </div></Runtime.Provider>;
}
createRoot(document.getElementById("root")).render(<App />);
