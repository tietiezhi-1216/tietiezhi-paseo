import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeSubagentPills } from "./client/subagents.tsx";
import { contributeSubagentComposer } from "./client/subagents-composer.tsx";
import { Text, View } from "react-native";
import { z } from "zod";
import { hexAlpha } from "./client/ui.tsx";
import { DashboardScreen, AgentDashboard } from "./client/dashboard.tsx";
import { AccountsPanel } from "./client/accounts.tsx";
import { QuotaFooter } from "./client/quota-footer.tsx";
import { ManagerEntry, ManagerScreen } from "./client/manager.tsx";
import { contributeAgentsPills } from "./client/agents-pill.tsx";
import { AssistantReply } from "./client/assistant-reply.tsx";
import { AssistantReplySchema, TurnPerformanceSchema } from "./shared/performance.ts";
import { CompactTool, CompactReasoning } from "./client/activity.tsx";
import { CompactToolSchema, CompactReasoningSchema } from "./shared/activity.ts";

export default function contribute(client: PluginClientContext) {
  const stops = [
    client.addScreen({ id: "manager", title: "铁铁汁", Component: ManagerScreen }),
    client.addSidebarHeaderItem({ id: "manager", title: "铁铁汁", Component: ManagerEntry }),
    client.addScreen({ id: "dashboard", title: "tietiezhi", Component: DashboardScreen }),
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
      title: "打开铁铁汁管理面板",
      icon: "PanelsTopLeft",
      context: "global",
      keywords: ["agents", "host", "账号", "远程"],
      onSelect(context) { context.openScreen({ screenId: "manager" }); },
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
    client.addTimelineRenderer({
      kind: "quota-notice",
      version: 1,
      schema: z.object({ message: z.string() }),
      Component: ({ item, theme }) => (
        <View style={{
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: hexAlpha(theme.colors.accent, 0.1),
          borderWidth: 1,
          borderColor: hexAlpha(theme.colors.accent, 0.25),
          marginVertical: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", lineHeight: 18 }}>
            ⓘ {item.data.message}
          </Text>
        </View>
      ),
    }),
    // Leave tool calls native: replacing them with plugin rows bypasses the
    // host's Overview grouping. The user selects Overview in Paseo settings.
    // Keep the individual renderer for compatibility with existing plugin rows.
    client.addTimelineRenderer({ kind: "compact-tool", version: 1, schema: CompactToolSchema, Component: CompactTool }),
    client.addTimelineTransformer({
      id: "compact-reasoning", query: { itemType: "reasoning" },
      transform({ item, phase }) {
        return { items: [{ type: "plugin", kind: "compact-reasoning", version: 1, data: { text: item.text, phase } }] };
      },
    }),
    client.addTimelineRenderer({ kind: "compact-reasoning", version: 1, schema: CompactReasoningSchema, Component: CompactReasoning }),
    client.addTimelineTransformer({
      id: "unified-assistant-reply",
      query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        if (!item.text.trim()) return undefined;
        // Unsupported rich content stays host-rendered, including its native controls.
        if (/```mermaid|!\[[^\]]*\]\(/.test(item.text)) return undefined;
        return { items: [{
          type: "plugin", kind: "assistant-reply", version: 1,
          data: { text: item.text, phase, ...(item.messageId ? { messageId: item.messageId } : {}) },
        }] };
      },
    }),
    client.addTimelineRenderer({
      kind: "assistant-reply", version: 1,
      schema: AssistantReplySchema, Component: AssistantReply,
    }),
    client.addTimelineRenderer({
      kind: "turn-performance",
      version: 1,
      schema: TurnPerformanceSchema,
      // Legacy rows are retained in history but no longer draw a second footer.
      Component: () => null,
    }),
  ];
  const stopSubagents = contributeSubagentPills(client);
  const stopSubagentComposer = contributeSubagentComposer(client);
  const stopPills = contributeAgentsPills(client);
  return async () => {
    stopSubagentComposer();
    stopSubagents();
    if (typeof stopPills === "function") await stopPills();
    for (const stop of [...stops].reverse()) await stop();
  };
}
