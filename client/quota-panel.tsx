import { useState } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useRpc, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, type Family } from "../shared/accounts.ts";
import { getQuota, type AccountQuota, type QuotaSnapshot, type QuotaWindow } from "../shared/quota.ts";
import { quotaGroups } from "../shared/quota-groups.ts";
import { readableResetCountdown } from "../shared/quota-footer-label.ts";
import { AccountsPanel } from "./accounts.tsx";
import { Action, ChannelTabs, Notice, QuotaMeter, RemainingBar, hexAlpha } from "./ui.tsx";
import { quotaFailureLabel } from "../shared/ui-format.ts";
import { LoginPanel } from "./login.tsx";

const CHANNEL_TABS = [
  ["codex", "Codex", "codex"], ["xai", "Grok", "xai"], ["antigravity", "Antigravity", "antigravity"],
] as const;

export function useQuota(hostId: string, family: Family | null, slot: string | null, all = false, enabled = true) {
  const rpc = useRpc(getQuota);
  const online = useHosts().find((h) => h.serverId === hostId)?.status === "online";
  return useQuery({
    queryKey: ["tietiezhi", "quota", hostId, family, slot, all],
    queryFn: async ({ signal }) => {
      if (!family || family === "go") throw new Error("此渠道已停用");
      const result = await rpc({ family, slot, all });
      if (signal.aborted) throw new Error("额度读取已取消");
      return result;
    },
    enabled: enabled && online && family !== null && family !== "go",
    staleTime: 30_000, gcTime: 0, retry: false,
    refetchInterval: enabled && online && family && family !== "go" ? 60_000 : false,
  });
}

export function QuotaBar({ theme, window, testID }: { theme: PluginSurfaceProps["theme"]; window: QuotaWindow; testID?: string }) {
  const remaining = Math.round((100 - window.usedPercent) * 10) / 10;
  return <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={window.label + "剩余额度"}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}
    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <RemainingBar used={window.usedPercent} theme={theme} size={14} remaining />
    <Text style={{ color: theme.colors.foreground, fontSize: 11 }}>{remaining}%</Text>
  </View>;
}

type QuotaPanelProps = PluginSurfaceProps & { family?: Family; onFamilyChange?: (family: Family) => void };
export function QuotaPanel(props: QuotaPanelProps) {
  const [selected, setSelected] = useState<Family>("codex");
  const family = props.family === "go" ? "codex" : props.family ?? selected;
  return <HostQuotaPanel key={props.host.id + ":" + family} {...props} family={family} onFamilyChange={props.onFamilyChange ?? setSelected} />;
}

function HostQuotaPanel({ theme, host, family, onFamilyChange, ...props }: QuotaPanelProps & { family: Family; onFamilyChange(family: Family): void }) {
  const quota = useQuota(host.id, family, null, true);
  const queries = useQueryClient();
  const online = useHosts().find((h) => h.serverId === host.id)?.status === "online";
  const [loginOpen, setLoginOpen] = useState(false);
  const data = quota.data ?? queries.getQueryData<QuotaSnapshot>(["tietiezhi", "quota", host.id, family, null, false]);
  const quotaFor = (account: Account) => data?.quotas.find((item) => item.accountId === account.id);
  return (
    <View testID="quota-panel" style={{ flex: 1, minHeight: 0, gap: 10, width: "100%" }}>
      {/* 头部工具栏：固定的 Tab 与登录按钮在同一行 */}
      <View testID="quota-panel-toolbar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View testID="quota-fixed-tabs" style={{ flex: 1, minWidth: 0 }}>
          <ChannelTabs
            theme={theme}
            items={props.layout.compact
              ? CHANNEL_TABS.map(([key, label, vendor]) => [key, key === "antigravity" ? "AG" : label, vendor] as const)
              : CHANNEL_TABS}
            value={family}
            onChange={onFamilyChange}
            prefix="quota-family"
          />
        </View>
        <Action
          theme={theme}
          title="+ 登录"
          label="登录"
          testID="quota-login"
          disabled={!online || loginOpen}
          onPress={() => setLoginOpen(true)}
        />
      </View>

      {!online ? <Notice theme={theme} text="离线 · 缓存" /> : null}
      {quota.isError ? <Notice theme={theme} error text="额度读取失败" /> : null}
      {loginOpen ? <LoginPanel {...props} host={host} theme={theme} family={family} onClose={() => setLoginOpen(false)} /> : null}

      {/* 账号列表独立滚动，Tab 始终固定 */}
      <ScrollView
        testID="quota-account-scroll"
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
      >
        <AccountsPanel
          {...props}
          host={host}
          theme={theme}
          family={family}
          compact
          snapshot={data?.snapshot}
          renderDetails={(account) => (
            <AccountQuotaDetails
              theme={theme}
              account={account}
              quota={quotaFor(account)}
              pending={quota.isFetching}
            />
          )}
        />
      </ScrollView>
    </View>
  );
}

export function AccountQuotaDetails({ theme, account, quota, pending }: {
  theme: PluginSurfaceProps["theme"]; account: Account; quota?: AccountQuota; pending: boolean;
}) {
  const groups = account.family === "antigravity" ? quotaGroups(quota?.windows ?? []) : [];
  const reset = (at: number | null) => at ? readableResetCountdown(at, Date.now()) : "重置时间未知";
  return (
    <View style={{ gap: 6, marginTop: 2 }}>
      {groups.length ? (
        groups.map((group) => (
          <View
            key={group.pool}
            testID={"quota-pool-" + group.pool}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 8,
              gap: 4,
              borderRadius: 7,
              borderWidth: 1,
              backgroundColor: hexAlpha(theme.colors.foreground, 0.025),
              borderColor: hexAlpha(theme.colors.border, 0.6),
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>{group.title}</Text>
            {group.windows.map((window, index) => (
              <View
                key={window.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  minHeight: 22,
                  paddingTop: index ? 4 : 0,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: hexAlpha(theme.colors.border, 0.3),
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 6 }}>
                  <Text style={{ width: 44, color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{window.title}</Text>
                  {window.resetAt ? (
                    <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"], flexShrink: 1 }}>
                      ↻ {reset(window.resetAt)}
                    </Text>
                  ) : null}
                </View>
                <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining ringRemaining circleAfter />
              </View>
            ))}
          </View>
        ))
      ) : (
        quota?.windows.map((window) => (
          <View
            key={window.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              minHeight: 22,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 6 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{window.label}</Text>
              {window.resetAt ? (
                <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"], flexShrink: 1 }}>
                  ↻ {reset(window.resetAt)}
                </Text>
              ) : null}
            </View>
            <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining ringRemaining circleAfter prefix="剩余 " textSize={12} />
          </View>
        ))
      )}
      {!quota?.windows.length ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{pending ? "读取中…" : "暂无额度"}</Text>
      ) : null}
      {quota?.stale ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>缓存</Text>
      ) : null}
      {quota?.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{quotaFailureLabel(quota.error)}</Text>
      ) : null}
    </View>
  );
}
