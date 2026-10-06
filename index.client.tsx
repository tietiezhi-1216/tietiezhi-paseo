import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { DashboardScreen, AgentDashboard } from "./client/dashboard.tsx";
import { AccountsPanel } from "./client/accounts.tsx";
import { DialogDemoSidebar } from "./client/dialog-demo.tsx";
import { QuotaFooter } from "./client/quota-footer.tsx";

function DashboardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="PanelsTopLeft"
      label="tietiezhi"
      active={currentScreen?.screenId === "dashboard"}
      onPress={() => openScreen({ screenId: "dashboard" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const stops = [
    client.addScreen({ id: "dashboard", title: "tietiezhi", Component: DashboardScreen }),
    client.addSidebarHeaderItem({ id: "dashboard", title: "tietiezhi", Component: DashboardItem }),
    client.addSidebarHeaderItem({ id: "dialog-demo", title: "对话 Log 示例", Component: DialogDemoSidebar }),
    client.addSidebarFooterItem({ id: "footer-demo", title: "模型额度", Component: QuotaFooter }),
    client.addSettingsScreen({ id: "accounts", title: "账号切换", icon: "Users", Component: AccountsPanel }),
    client.addWorkspacePanel({
      id: "dashboard",
      title: "tietiezhi",
      icon: "PanelsTopLeft",
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: AgentDashboard,
    }),
    client.addCommandCenterItem({
      id: "dashboard",
      title: "打开 tietiezhi 仪表盘",
      icon: "PanelsTopLeft",
      context: "global",
      keywords: ["agents", "host", "账号", "远程"],
      onSelect(context) { context.openScreen({ screenId: "dashboard" }); },
    }),
    client.addSlashCommand({
      name: "tietiezhi",
      description: "打开账号、Agents 或多 Host 仪表盘",
      argumentHint: "[agents|accounts|hosts]",
      context: "agent",
      onSubmit(context) {
        const tab = context.args.trim();
        context.openScreen({ screenId: "dashboard", params: { tab: tab === "accounts" || tab === "hosts" ? tab : "agents" } });
      },
    }),
  ];
  return async () => {
    for (const stop of [...stops].reverse()) await stop();
  };
}
