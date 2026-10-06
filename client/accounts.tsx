import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FAMILY_LABELS, FamilySchema, listAccounts, switchAccount, type Account, type AccountSnapshot, type Family } from "../shared/accounts.ts";
import { compactTime } from "../shared/ui-format.ts";
import { Action, Disclosure, IconAction, Loading, Notice, errorText, hexAlpha } from "./ui.tsx";

type AccountsPanelProps = PluginSurfaceProps & {
  family?: Family;
  compact?: boolean;
  renderDetails?: (account: Account) => ReactNode;
  renderSummary?: (account: Account) => ReactNode;
  snapshot?: AccountSnapshot;
};

export function AccountsPanel(props: AccountsPanelProps) {
  return <HostAccounts key={`${props.host.id}:${props.family ?? "all"}`} {...props} />;
}

function HostAccounts({ theme, host, family: filterFamily, compact = false, renderDetails, renderSummary, snapshot }: AccountsPanelProps) {
  const online = useHosts().find((h) => h.serverId === host.id)?.status === "online";
  const list = useRpc(listAccounts);
  const change = useRpc(switchAccount);
  const queries = useQueryClient();
  const key = ["tietiezhi", "accounts", host.id];
  const accounts = useQuery({
    queryKey: key,
    queryFn: () => list({}),
    enabled: online,
    initialData: snapshot,
    initialDataUpdatedAt: 0,
    staleTime: 15_000,
    gcTime: 0,
    retry: false,
  });
  const [confirmation, setConfirmation] = useState<{ account: Account; revision: string } | null>(null);
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (selection: NonNullable<typeof confirmation>) => change({ id: selection.account.id, revision: selection.revision, confirmed: true }),
    onSuccess(result) {
      queries.setQueryData(key, result.snapshot);
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", host.id] });
      setNotice(result.backupCreated ? "已切换 · 已备份" : "已切换");
      setConfirmation(null);
    },
    onError() {
      void queries.invalidateQueries({ queryKey: key });
    },
  });

  const choose = (account: Account) => {
    if (!online || account.active || !account.canSwitch || accounts.isError || mutation.isPending || !accounts.data) return;
    mutation.reset();
    setNotice("");
    setConfirmation({ account, revision: accounts.data.revision });
  };

  return (
    <View style={{ gap: 8 }}>
      {!compact ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.label}</Text>
          <IconAction
            theme={theme}
            title="重新读取账号"
            icon="RefreshCw"
            disabled={!online || accounts.isFetching || mutation.isPending}
            onPress={() => { setConfirmation(null); void accounts.refetch(); }}
          />
        </View>
      ) : null}
      {!online && !compact ? <Notice theme={theme} text="离线 · 缓存" /> : null}
      {accounts.isPending && online ? <Loading theme={theme} /> : null}
      {accounts.isError ? <Notice theme={theme} error text={errorText(accounts.error)} /> : null}
      {!compact && accounts.data?.warnings.length ? (
        <Disclosure theme={theme} title={`提示 · ${accounts.data.warnings.length}`}>
          {accounts.data.warnings.map((warning) => <Notice key={warning} theme={theme} text={warning} />)}
        </Disclosure>
      ) : null}
      {notice ? <Notice theme={theme} text={notice} /> : null}
      {mutation.isError ? <Notice theme={theme} error text={errorText(mutation.error)} /> : null}

      {confirmation && !compact ? (
        <View testID="account-confirmation" style={{ padding: 10, gap: 7, borderWidth: 1, borderColor: theme.colors.statusWarning, borderRadius: 7 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>切换默认账号？</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
            {host.label} · {FAMILY_LABELS[confirmation.account.family]} → {confirmation.account.label}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>保留备份 · 不重载会话；已有会话可能仍用原授权</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Action
              theme={theme}
              title={mutation.isPending ? "切换中…" : "确认切换"}
              testID="confirm-account-switch"
              disabled={!online || mutation.isPending}
              onPress={() => mutation.mutate(confirmation)}
            />
            <Action theme={theme} title="取消" disabled={mutation.isPending} onPress={() => setConfirmation(null)} />
          </View>
        </View>
      ) : null}

      {FamilySchema.options
        .filter((f) => f !== "go" && (!filterFamily || f === filterFamily))
        .map((family) => {
          const rows = accounts.data?.accounts.filter((a) => a.family === family) ?? [];
          return (
            <View key={family} style={{ gap: 6 }}>
              {!compact ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{FAMILY_LABELS[family]} · {rows.length}</Text> : null}
              {!rows.length && !accounts.isPending && !accounts.isError ? <Notice theme={theme} text="暂无账号" /> : null}
              {rows.map((account) => {
                const selected = account.active;
                const isPendingSwitch = confirmation?.account.id === account.id;
                return (
                  <View
                    key={account.id}
                    testID={compact ? "quota-account-card" : `account-${account.id}`}
                    style={{
                      paddingVertical: compact ? 9 : 10,
                      paddingHorizontal: compact ? 10 : 12,
                      gap: 5,
                      borderRadius: 8,
                      backgroundColor: selected ? hexAlpha(theme.colors.foreground, 0.06) : hexAlpha(theme.colors.foreground, 0.02),
                      borderWidth: 1,
                      borderColor: selected ? (compact ? hexAlpha(theme.colors.foreground, 0.16) : theme.colors.accent) : hexAlpha(theme.colors.border, 0.6),
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={account.active ? `${account.label} · 当前默认` : `切换至 ${account.label}`}
                      accessibilityState={{ selected: account.active }}
                      disabled={!online || account.active || !account.canSwitch || accounts.isError || mutation.isPending}
                      onPress={() => choose(account)}
                      style={{ minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                        {selected ? (
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent }} />
                        ) : null}
                        <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 13, fontWeight: selected ? "700" : "500", flexShrink: 1 }}>
                          {account.label}
                        </Text>
                        {account.plan ? (
                          <View style={{ paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, backgroundColor: selected ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)", flexShrink: 0 }}>
                            <Text style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 9, fontWeight: "700", textTransform: "uppercase" }}>
                              {account.plan}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {renderSummary?.(account) ?? <Text style={{ color: selected ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 11, fontWeight: selected ? "600" : "500" }}>
                        {selected ? "✓ 默认" : "切换"}
                      </Text>}
                    </Pressable>

                    {renderDetails ? (
                      renderDetails(account)
                    ) : (
                      <>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                          {[account.plan, account.authType].filter(Boolean).join(" · ")}
                        </Text>
                        {account.expiresAt !== null && account.expiresAt <= Date.now() ? (
                          <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>授权已过期</Text>
                        ) : null}
                        <Disclosure theme={theme} testID="account-details">
                          <Notice theme={theme} text={`槽位：${account.slot}`} />
                          {account.expiresAt !== null ? <Notice theme={theme} text={`授权：${compactTime(account.expiresAt)}`} /> : null}
                          {account.subscriptionExpiresAt !== null ? <Notice theme={theme} text={`订阅：${compactTime(account.subscriptionExpiresAt)} · 缓存`} /> : null}
                        </Disclosure>
                      </>
                    )}

                    {isPendingSwitch && compact ? (
                      <View testID="account-confirmation" style={{ marginTop: 4, padding: 8, gap: 5, borderWidth: 1, borderColor: theme.colors.statusWarning, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.03)" }}>
                        <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 12 }}>切换到 {account.label}？</Text>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>保留备份 · 不重载已有会话</Text>
                        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                          <Action theme={theme} title="取消" disabled={mutation.isPending} onPress={() => setConfirmation(null)} />
                          <Action
                            theme={theme}
                            title={mutation.isPending ? "切换中…" : "确认切换"}
                            testID="confirm-account-switch"
                            disabled={!online || mutation.isPending}
                            onPress={() => mutation.mutate(confirmation)}
                          />
                        </View>
                      </View>
                    ) : null}

                    {account.problem ? <Notice theme={theme} error text="授权不完整" /> : null}
                  </View>
                );
              })}
            </View>
          );
        })}
    </View>
  );
}
