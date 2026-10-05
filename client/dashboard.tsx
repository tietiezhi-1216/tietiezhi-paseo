import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";

const modules = [
  { title: "额度查看", description: "模型账号、登录授权与用量管理（待实现）" },
  { title: "状态展示", description: "当前 Agent 的计划、待办与后台任务（待实现）" },
  { title: "Agent 展示", description: "本机及远程 Agent 状态与会话导航（待实现）" },
];

export function DashboardSurface({ theme, layout }: PluginSurfaceProps) {
  return (
    <View style={{ flex: 1, padding: layout.compact ? 16 : 24, gap: 16, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700" }}>tietiezhi</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>项目骨架已初始化，业务功能将分阶段实现。</Text>
      {modules.map((module) => (
        <View key={module.title} style={{ padding: 16, gap: 8, borderRadius: 8, backgroundColor: theme.colors.surface1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{module.title}</Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>{module.description}</Text>
        </View>
      ))}
    </View>
  );
}
