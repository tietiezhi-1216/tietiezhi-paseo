import { createRoot } from "react-dom/client";
import { useState } from "react";
import { View, Text } from "react-native";
import { contributeThinking } from "../../client/thinking.tsx";
const transforms = new Set(), renderers = new Map();
let command;
const stop = contributeThinking({
  addTimelineTransformer(item) { transforms.add(item); return () => transforms.delete(item); },
  addTimelineRenderer(item) { renderers.set(item.kind, item); return () => renderers.delete(item.kind); },
  addCommandCenterItem(item) { command = item; return () => { command = null; }; },
  addComposerPill() { throw new Error("No thinking pill allowed"); },
  paseo: { agents: { list() { throw new Error("No timeline observation allowed"); } } },
});
function App() {
  const [text, setText] = useState("**Inspect source**\n\nLong thought body");
  const [phase, setPhase] = useState("streaming");
  const [light, setLight] = useState(false);
  const [active, setActive] = useState(true);
  const theme = { colors: { foreground: light ? "#24292f" : "#f0f6fc", foregroundMuted: light ? "#57606a" : "#8b949e" } };
  const project = (text, phase) => [...transforms][0].transform({ item: { type: "reasoning", text }, phase });
  globalThis.__thinking = { text: setText, phase: setPhase, light: setLight, project, toggle: () => command.onSelect(), teardown: () => { stop(); setActive(false); }, count: () => transforms.size + renderers.size };
  return <View style={{ minHeight: "100vh", backgroundColor: light ? "white" : "#121417", padding: 20, gap: 12 }}>
    <Text style={{ color: theme.colors.foreground }}>助手正文与原生工具概览</Text>
    {active ? project(text, phase).items.map((item, index) => {
      const Component = renderers.get(item.kind)?.Component;
      return Component ? <Component key={index} item={item} theme={theme} agentId="a" timestamp={new Date()} host={{ id: "mock" }} layout={{ compact: innerWidth < 600, platform: "web" }} /> : null;
    }) : null}
    <Text style={{ color: theme.colors.foregroundMuted }}>输入消息…</Text>
  </View>;
}
createRoot(document.getElementById("root")).render(<App />);
