import { useHosts, openExternalUrl, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { Action, Disclosure, Notice } from "./ui.tsx";
import { useState } from "react";

export const HOST_STATUS_LABELS: Record<string, string> = {
  idle: "未连接", connecting: "连接中", online: "在线", offline: "离线", error: "连接失败",
};
export function HostsPanel({ theme }: PluginSurfaceProps) {
  const hosts = useHosts();
  const [error, setError] = useState("");
  return <View style={{ gap: 8 }}>
    {hosts.map((host) => <View key={host.serverId} style={{ backgroundColor: theme.colors.surface1, padding: 10, gap: 3, borderRadius: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{host.label}</Text>
        <Text style={{ color: host.status === "online" ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 11 }}>{HOST_STATUS_LABELS[host.status]}</Text>
      </View>
      <Disclosure theme={theme}>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{host.serverId}</Text>
      </Disclosure>
    </View>)}
    {!hosts.length ? <Notice theme={theme} text="暂无主机" /> : null}
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Action theme={theme} title="查看官方连接文档" label="连接文档" onPress={() => {
        void openExternalUrl("https://paseo.sh/docs/connectivity").catch(() => setError("无法打开连接文档"));
      }} />
    </View>
    <Disclosure theme={theme} title="连接帮助" testID="host-help">
      <Notice theme={theme} text="远端启动 Paseo → 创建配对链接 → 本机 Add host。" />
      <Notice theme={theme} text="公网可用 Relay / SSH / Tailscale；远端账号管理需安装 tietiezhi。" />
    </Disclosure>
    {error ? <Notice theme={theme} error text={error} /> : null}
  </View>;
}
