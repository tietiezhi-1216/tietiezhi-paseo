import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useRpc, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, type Family } from "../shared/accounts.ts";
import { getQuota, selectQuotaWindow, legacyQuotaWindows, type AccountQuota, type QuotaSnapshot, type QuotaWindow } from "../shared/quota.ts";
import { quotaGroups } from "../shared/quota-groups.ts";
import { timeUntilReset } from "../shared/quota-footer-label.ts";
import { quotaPresentation } from "../shared/quota-state.ts";
import { AccountsPanel } from "./accounts.tsx";
import { Action, ChannelTabs, Notice, QuotaMeter, RemainingBar, hexAlpha } from "./ui.tsx";
import { compactDateTime } from "../shared/ui-format.ts";
import { LoginPanel } from "./login.tsx";
import { getPersistentQuota, updatePersistentQuotas } from "./quota-cache.ts";

const CHANNEL_TABS = [
  ["codex", "Codex", "codex"], ["xai", "Grok", "xai"], ["antigravity", "Antigravity", "antigravity"],
] as const;

export function useQuota(hostId: string, family: Family | null, slot: string | null, all = false, enabled = true) {
  const rpc = useRpc(getQuota);
  const query = useQuery<QuotaSnapshot>({
    queryKey: ["tietiezhi", "quota", hostId, family, slot, all],
    queryFn: async ({ signal }) => {
      if (!family || family === "go") throw new Error("此渠道已停用");
      const result = await rpc({ family, slot, all });
      if (signal.aborted) throw new Error("额度读取已取消");
      return result;
    },
    enabled: enabled && family !== null && family !== "go",
    staleTime: 30_000, gcTime: 30 * 60_000, retry: false,
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[2] === hostId
      && previousQuery.queryKey[4] === slot && previousData?.family === family ? previousData : undefined,
    refetchInterval: enabled && family && family !== "go" ? 5 * 60_000 : false,
    refetchOnMount: "always",
  });
  useEffect(() => {
    // Check an authoritative reset immediately, in addition to the five-minute cadence.
    // Past timestamps do not schedule a retry loop.
    const resets = query.data?.quotas.flatMap((q) => q.windows)
      .map((w) => w.resetAt).filter((at): at is number => at != null && at > Date.now()) ?? [];
    if (!enabled || !resets.length) return;
    const timer = setTimeout(() => { void query.refetch(); }, Math.min(2_147_483_647, Math.max(1, Math.min(...resets) - Date.now() + 50)));
    return () => clearTimeout(timer);
  }, [enabled, query.data, query.refetch]);
  return query;
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
  return <HostQuotaPanel key={props.host.id} {...props} family={family} onFamilyChange={props.onFamilyChange ?? setSelected} />;
}

function HostQuotaPanel({ theme, host, family, onFamilyChange, ...props }: QuotaPanelProps & { family: Family; onFamilyChange(family: Family): void }) {
  const quota = useQuota(host.id, family, null, true);
  const queries = useQueryClient();
  const online = useHosts().find((h) => h.serverId === host.id)?.status === "online";
  const [loginOpen, setLoginOpen] = useState(false);
  const cachedData = queries.getQueryData<QuotaSnapshot>(["tietiezhi", "quota", host.id, family, null, true])
    ?? queries.getQueryData<QuotaSnapshot>(["tietiezhi", "quota", host.id, family, null, false]);
  const data = (quota.data?.family === family ? quota.data : undefined)
    ?? (cachedData?.family === family ? cachedData : undefined);
  const accountsSnapshot = queries.getQueryData<any>(["tietiezhi", "accounts", host.id]);
  const rows = accountsSnapshot?.accounts.filter((account: any) => account.family === family)
    ?? data?.snapshot.accounts.filter((account) => account.family === family)
    ?? [];
  useEffect(() => {
    if (data?.quotas) updatePersistentQuotas(host.id, data.quotas, family, data.currentAccountId);
  }, [data, host.id, family]);
  const quotaFor = (account: Account): AccountQuota | undefined => {
    const live = data?.quotas.find((item) => item.accountId === account.id);
    if (live) return live;
    const persistent = getPersistentQuota(host.id, account.id);
    if (persistent) return persistent;
    if (account.cachedUsage) {
      const rawWindows = legacyQuotaWindows(account.cachedUsage).filter(
        (w) => account.family !== "antigravity" || w.pool !== "shared"
      );
      if (rawWindows.length > 0) {
        return {
          accountId: account.id,
          windows: rawWindows,
          plan: account.plan,
          fetchedAt: account.cachedAt ?? null,
          checkedAt: null,
          stale: true,
          error: null,
        };
      }
    }
    return live;
  };
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
            const state = quotaPresentation(q, Date.now(), quota.isFetching);
            const window = selectQuotaWindow(account.family, null, state.windows);
            if (!window) return <Text style={{ color: q?.error ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 11 }}>{state.label}</Text>;
            return (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {state.kind === "cached" ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>缓存</Text> : null}
                {window ? (
                  <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining ringRemaining circleAfter={false} prefix="" textSize={12} />
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
  const now = Date.now();
  const state = quotaPresentation(quota, now, pending);
  const windows = state.windows;
  const groups = account.family === "antigravity" ? quotaGroups(windows) : [];
  const formatDays = (ts: number) => {
    const d = (ts - Date.now()) / 86400000;
    return d > 0 ? `${Math.ceil(d)}天后` : "已到期";
  };



  return (
    <View style={{ marginTop: 2, gap: 4 }}>
      {state.kind !== "fresh" ? (
        <Text testID={"quota-state-" + account.id} style={{ color: quota?.error ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 11 }}>{state.detail}</Text>
      ) : null}
      {account.subscriptionExpiresAt && (groups.length || !windows.length) ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          会员 {formatDays(account.subscriptionExpiresAt)}到期 · {compactDateTime(account.subscriptionExpiresAt)}
        </Text>
      ) : null}
      {groups.length ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {groups.map((group) => (
            <View
              key={group.pool}
              testID={"quota-pool-" + group.pool}
              style={{
                width: "100%",
                paddingVertical: 7,
                paddingHorizontal: 10,
                gap: 6,
                borderRadius: 7,
                backgroundColor: hexAlpha(theme.colors.foreground, 0.025),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>{group.title}</Text>
                {group.pool === "claude" && account.active ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>当前会话</Text> : null}
                {group.pool === "gemini" && state.kind === "fresh" ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>获取于 {compactDateTime(quota?.fetchedAt).split(" ")[1]}</Text> : null}
              </View>
              {group.windows.map((window, index) => {
                const effectiveReset = window.resetAt;
                return (
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
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ width: 44, color: theme.colors.foreground, fontSize: 12, fontWeight: "500", flexShrink: 0 }}>{window.title}</Text>
                      {effectiveReset ? (
                        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"], flexShrink: 1 }}>
                          {compactDateTime(effectiveReset)} ({timeUntilReset(effectiveReset, Date.now())})
                        </Text>
                      ) : null}
                    </View>
                    <QuotaMeter used={window.usedPercent} theme={theme} size={14} remaining ringRemaining circleAfter={false} prefix="" textSize={12} />
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : windows.length ? (
        windows.map((window, index) => {
          const showMembership = index === 0 && account.subscriptionExpiresAt;
          return (
            <View key={window.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 }}>
              {showMembership ? (
                <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
                  会员 {formatDays(account.subscriptionExpiresAt!)}到期
                </Text>
              ) : windows.length > 1 ? (
                <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 11, fontWeight: "500", flexShrink: 1 }}>
                  {window.label}
                </Text>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {window.resetAt ? (() => {
                const effectiveReset = window.resetAt;
                return (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"], flexShrink: 0, textAlign: "right" }}>
                    {compactDateTime(effectiveReset)} 重置 ({timeUntilReset(effectiveReset, Date.now())})
                  </Text>
                );
              })() : null}
            </View>
          );
        })
      ) : null}
    </View>
  );
}
