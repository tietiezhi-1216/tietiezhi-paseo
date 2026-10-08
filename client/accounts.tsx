import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useHosts, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FAMILY_LABELS, FamilySchema, listAccounts, switchAccount, deleteAccount, type Account, type AccountSnapshot, type Family } from "../shared/accounts.ts";
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
  return <HostAccounts key={props.host.id} {...props} />;
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
  const [deleteConf, setDeleteConf] = useState<Account | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setConfirmation(null);
    setDeleteConf(null);
  }, [filterFamily]);
  const deleteRpc = useRpc(deleteAccount);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRpc({ id, revision: accounts.data!.revision }),
    onSuccess(result) {
      queries.setQueryData(key, result.snapshot);
      queries.setQueriesData({ queryKey: ["tietiezhi", "quota", host.id] }, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          snapshot: result.snapshot,
          quotas: Array.isArray(old.quotas) ? old.quotas.filter((q: any) => result.snapshot.accounts.some((a: any) => a.id === q.accountId)) : old.quotas,
        };
      });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", host.id] });
      setDeleteConf(null);
    },
    onError() {
      void queries.invalidateQueries({ queryKey: key });
    },
  });
  const mutation = useMutation({
    mutationFn: (selection: NonNullable<typeof confirmation>) => change({ id: selection.account.id, revision: selection.revision, confirmed: true }),
    onSuccess(result) {
      queries.setQueryData(key, result.snapshot);
      // Seamlessly update currentAccountId in React Query caches so all accounts retain their existing quotas
      queries.setQueriesData<any>({ queryKey: ["tietiezhi", "quota", host.id] }, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          snapshot: result.snapshot,
          currentAccountId: result.snapshot.accounts.find((a: any) => a.active)?.id ?? old.currentAccountId,
        };
      });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", host.id] });
      if (!compact) setNotice(result.backupCreated ? "已切换 · 已备份" : "已切换");
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
      {!online && !compact ? <Notice theme={theme} text="离线 · 缓存" /> : null}
      {accounts.isPending && online ? <Loading theme={theme} /> : null}
      {accounts.isError ? <Notice theme={theme} error text={errorText(accounts.error)} /> : null}
      {!compact && notice ? <Notice theme={theme} text={notice} /> : null}
      {mutation.isError ? <Notice theme={theme} error text={errorText(mutation.error)} /> : null}
      {deleteMutation.isError ? <Notice theme={theme} error text={errorText(deleteMutation.error)} /> : null}

      {confirmation && !compact ? (
        <View testID="account-confirmation" style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: hexAlpha(theme.colors.accent, 0.4), backgroundColor: hexAlpha(theme.colors.accent, 0.05), borderRadius: 8 }}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>切换默认账号？</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
            {FAMILY_LABELS[confirmation.account.family]} → {confirmation.account.label}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
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
              {!compact ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginTop: 10, marginBottom: 2 }}>{FAMILY_LABELS[family].toUpperCase()} · {rows.length}</Text> : null}
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
                      paddingHorizontal: compact ? 10 : 14,
                      gap: 4,
                      borderRadius: 8,
                      backgroundColor: selected ? hexAlpha(theme.colors.accent, 0.06) : theme.colors.surface1,
                      borderWidth: 1,
                      borderColor: selected ? hexAlpha(theme.colors.accent, 0.35) : hexAlpha(theme.colors.border, 0.6),
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={account.active ? `${account.label} · 当前默认` : `切换至 ${account.label}`}
                      accessibilityState={{ selected: account.active }}
                      disabled={!online || account.active || !account.canSwitch || accounts.isError || mutation.isPending}
                      onPress={() => { setDeleteConf(null); choose(account); }}
                      {...({
                        onContextMenu: (e: any) => {
                          e.preventDefault?.(); e.stopPropagation?.();
                          if (!account.active) {
                            setConfirmation(null);
                            setDeleteConf(account);
                          }
                        }
                      } as any)}
                      style={{ minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 13, fontWeight: selected ? "700" : "500", flexShrink: 1 }}>
                          {selected ? "● " : ""}{account.label}
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                          {[account.slot, account.authType].filter(Boolean).join(" · ")}
                        </Text>
                        {account.expiresAt !== null && account.expiresAt <= Date.now() ? (
                          <Text style={{ color: theme.colors.statusDanger, fontSize: 11, fontWeight: "500" }}>授权已过期</Text>
                        ) : null}
                      </View>
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
                    
                    {deleteConf?.id === account.id ? (
                      <View style={{ marginTop: 4, padding: 8, gap: 5, borderWidth: 1, borderColor: theme.colors.statusDanger, borderRadius: 6, backgroundColor: hexAlpha(theme.colors.statusDanger, 0.1) }}>
                        <Text style={{ color: theme.colors.statusDanger, fontWeight: "600", fontSize: 12 }}>删除此账号记录？</Text>
                        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
                          <Action theme={theme} title="取消" disabled={deleteMutation.isPending} onPress={() => setDeleteConf(null)} />
                          <Action theme={theme} title={deleteMutation.isPending ? "删除中…" : "删除"} disabled={!online || deleteMutation.isPending} onPress={() => deleteMutation.mutate(account.id)} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
    </View>
  );
}
