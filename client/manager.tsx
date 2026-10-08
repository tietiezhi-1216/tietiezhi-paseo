import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useHosts, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountsPanel } from "./accounts.tsx";
import { LoginPanel } from "./login.tsx";
import { PiManagerPanel } from "./pi-manager.tsx";
import { Action, Notice, Tabs } from "./ui.tsx";
import type { Family } from "../shared/accounts.ts";

export function ManagerEntry(props: PluginSidebarItemProps) {
  return <SidebarRow icon="PanelsTopLeft" label="铁铁汁" active={props.currentScreen?.screenId === "manager"}
    onPress={() => props.openScreen({ screenId: "manager" })} />;
}
export function ManagerScreen(props: PluginScreenProps) {
  return <ManagerBody key={props.host.id} {...props} />;
}
function ManagerBody(props: PluginScreenProps) {
  const { theme, host, layout } = props;
  const hosts = useHosts();
  const online = hosts.some((entry) => entry.serverId === host.id && entry.status === "online");
  const [tab, setTab] = useState<"accounts" | "plugins">("accounts");
  const [login, setLogin] = useState<Family | null>(null);
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
    contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 14 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}>铁铁汁</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>当前设备：{host.label} · {online ? "在线" : "离线"}</Text>
    <Notice theme={theme} text="通过 Paseo 页面的主机选择器切换设备。其他设备需安装铁铁汁，账号和插件操作始终在所选设备执行。" />
    <Tabs theme={theme} items={[["accounts", "账号"], ["plugins", "Pi 插件"]]} value={tab} onChange={(value) => { setTab(value); setLogin(null); }} />
    {tab === "plugins" ? <PiManagerPanel {...props} /> : <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Action theme={theme} title="登录 Codex" disabled={!online} onPress={() => setLogin("codex")} />
        <Action theme={theme} title="登录 xAI" disabled={!online} onPress={() => setLogin("xai")} />
        <Action theme={theme} title="登录 Antigravity" disabled={!online} onPress={() => setLogin("antigravity")} />
      </View>
      {login ? <LoginPanel key={`${host.id}:${login}`} {...props} family={login} onClose={() => setLogin(null)} /> : null}
      <AccountsPanel {...props} />
    </View>}
  </ScrollView>;
}
