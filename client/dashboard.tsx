import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useAgent, type PluginAgentPanelProps, type PluginScreenProps, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { AccountsPanel } from "./accounts.tsx";
import { AgentsPanel } from "./agents.tsx";
import { HostsPanel } from "./hosts.tsx";
import { Tabs, Notice } from "./ui.tsx";

type Tab = "accounts" | "agents" | "hosts";
function DashboardBody({ props, initialTab, children }: {
  props: PluginSurfaceProps; initialTab: Tab; children?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { theme, layout } = props;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 10 }}>
      {children}
      <Tabs theme={theme} items={[["agents", "Agents"], ["accounts", "账号"], ["hosts", "主机"]]} value={tab} onChange={setTab} prefix="tab" />
      {tab === "accounts" ? <AccountsPanel {...props} /> : tab === "agents" ? <AgentsPanel {...props} /> : <HostsPanel {...props} />}
    </ScrollView>
  );
}
export function DashboardScreen(props: PluginScreenProps) {
  const tab: Tab = props.params.tab === "accounts" || props.params.tab === "hosts" ? props.params.tab : "agents";
  return <DashboardBody key={`${props.host.id}:${tab}`} props={props} initialTab={tab} />;
}
export function AgentDashboard(props: PluginAgentPanelProps) {
  const current = useAgent(props.agentId, (agent) => ({ title: agent.title, status: agent.status, provider: agent.provider, model: agent.model }));
  return (
    <DashboardBody key={`${props.host.id}:${props.agentId}`} props={props} initialTab="agents">
      <Text style={{ color: props.theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{current?.title ?? props.agentId}</Text>
      <Notice theme={props.theme} text={current ? `${current.provider} / ${current.model ?? "默认模型"} · ${current.status}` : "当前会话暂不可用"} />
    </DashboardBody>
  );
}
