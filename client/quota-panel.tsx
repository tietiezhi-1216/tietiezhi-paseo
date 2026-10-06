import { useState } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useRpc, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, type Family } from "../shared/accounts.ts";
import { getQuota, selectQuotaWindow, type AccountQuota, type QuotaSnapshot, type QuotaWindow } from "../shared/quota.ts";
import { quotaGroups } from "../shared/quota-groups.ts";
import { timeUntilReset, readableResetCountdown } from "../shared/quota-footer-label.ts";
import { AccountsPanel } from "./accounts.tsx";
import { Action, ChannelTabs, Notice, QuotaMeter, RemainingBar, hexAlpha } from "./ui.tsx";
import { quotaFailureLabel, compactDateTime } from "../shared/ui-format.ts";
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
  const rows = data?.snapshot.accounts.filter((account) => account.family === family) ?? [];
  const quotaFor = (account: Account) => data?.quotas.find((item) => item.accountId === account.id);
  return (
    <View testID="quota-panel" style={{ flex: 1, minHeight: 0, gap: 10, width: "100%" }}>
      {/* 头部工具栏：固定的 Tab 与登录按钮在同一行 */}
      <View testID="quota-panel-toolbar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View testID="quota-fixed-tabs" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ChannelTabs
            theme={theme}
            items={props.layout.compact
              ? CHANNEL_TABS.map(([key, label, vendor]) => [key, key === "antigravity" ? "AG" : label, vendor] as const)
              : CHANNEL_TABS}
            value={family}
            onChange={onFamilyChange}
            prefix="quota-family"
          />
          {!props.layout.compact ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "500" }}>{rows.length} 个账号</Text> : null}
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
          renderSummary={(account) => {
            if (account.family === "antigravity") {
              return (
                <Text style={{ color: account.active ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 11, fontWeight: account.active ? "600" : "500" }}>
                  {account.active ? "✓ 默认" : "切换"}
                </Text>
              );
            }
            const q = quotaFor(account);
            if (!q || !q.windows.length || q.stale || q.error) {
              return (
                <Text style={{ color: account.active ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 11, fontWeight: account.active ? "600" : "500" }}>
                  {account.active ? "✓ 默认" : "切换"}
                </Text>
              );
            }
            const window = selectQuotaWindow(account.family, null, q.windows);
            return (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {window ? (
                  <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining circleAfter={false} prefix="" textSize={12} />
                ) : null}
              </View>
            );
          }}
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
  const formatDays = (ts: number) => {
    const d = (ts - Date.now()) / 86400000;
    return d > 0 ? `${Math.ceil(d)}天后` : "已到期";
  };
  return (
    <View style={{ marginTop: 2, gap: 4 }}>
      {account.subscriptionExpiresAt && groups.length ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          📅 会员到期：{formatDays(account.subscriptionExpiresAt)} · {compactDateTime(account.subscriptionExpiresAt)}
        </Text>
      ) : null}
      {groups.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {groups.map((group) => (
            <View
              key={group.pool}
              testID={"quota-pool-" + group.pool}
              style={{
                flex: 1,
                minWidth: 200,
                paddingVertical: 6,
                paddingHorizontal: 8,
                gap: 6,
                borderRadius: 7,
                backgroundColor: hexAlpha(theme.colors.foreground, 0.025),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>{group.title}</Text>
                {group.pool === "claude" && account.active ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>当前会话</Text> : null}
                {group.pool === "gemini" && quota?.stale === false ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>刷新于 {compactDateTime(Date.now()).split(" ")[1]}</Text> : null}
              </View>
              {quota?.stale || quota?.error ? (
                <View style={{ paddingVertical: 12, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "600" }}>
                    {quota.error ? quotaFailureLabel(quota.error) : "缓存数据"}
                  </Text>
                </View>
              ) : (
                group.windows.map((window, index) => (
                  <View
                    key={window.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      minHeight: 22,
                      paddingTop: index ? 6 : 0,
                      borderTopWidth: index ? 1 : 0,
                      borderTopColor: hexAlpha(theme.colors.border, 0.3),
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 6 }}>
                      <Text numberOfLines={1} style={{ minWidth: 32, color: theme.colors.foreground, fontSize: 12, fontWeight: "500", flexShrink: 1 }}>{window.title}</Text>
                      {window.resetAt ? (
                        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
                          ↻ {timeUntilReset(window.resetAt, Date.now())} ({compactDateTime(window.resetAt)})
                        </Text>
                      ) : null}
                    </View>
                    <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining circleAfter={false} prefix="" textSize={12} />
                  </View>
                ))
              )}
            </View>
          ))}
        </View>
      ) : quota?.stale || quota?.error ? (
        <View style={{ paddingVertical: 6 }}>
          <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "600" }}>
            {quota.error ? quotaFailureLabel(quota.error) : "缓存数据"}
          </Text>
        </View>
      ) : !quota?.windows.length && !pending ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>暂无额度</Text>
      ) : (
        quota?.windows.map((window) => (
          <View key={window.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
              {account.subscriptionExpiresAt ? `📅 ${formatDays(account.subscriptionExpiresAt)}到期  ` : ""}↻ 刷新：{window.resetAt ? timeUntilReset(window.resetAt, Date.now()) : "未知"}
            </Text>
            {window.resetAt ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"], flexShrink: 0 }}>
                {compactDateTime(window.resetAt)}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
