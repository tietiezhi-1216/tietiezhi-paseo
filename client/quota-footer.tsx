import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useHosts, useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Family } from "../shared/accounts.ts";
import { getQuota, selectQuotaWindow } from "../shared/quota.ts";
import { compactResetCountdown, readableResetCountdown, quotaFooterLabel } from "../shared/quota-footer-label.ts";
import { QuotaPanel, useQuota } from "./quota-panel.tsx";
import { QuotaMeter, VendorMark } from "./ui.tsx";

export function QuotaFooter(props: PluginSidebarItemProps) { return <HostQuotaFooter key={props.host.id} {...props} />; }
function HostQuotaFooter(props: PluginSidebarItemProps) {
  const { theme, host } = props;
  const [open, setOpen] = useState(false);

  const [rowWidth, setRowWidth] = useState(240);
  const dense = rowWidth < 230;
  // Explicit panel selection, not a guessed current session/model. No composer contribution.
  const [family, setFamily] = useState<Family>("codex");
  const online = useHosts().find((h) => h.serverId === host.id)?.status === "online";
  const quota = useQuota(host.id, family, null);
  const rpc = useRpc(getQuota);
  const queries = useQueryClient();
  const refresh = useMutation({
    mutationFn: (selected: Family) => {
      if (selected === "go") throw new Error("此渠道已停用");
      return rpc({ family: selected, refresh: true });
    },
    onSuccess(result, selected) { queries.setQueryData(["tietiezhi", "quota", host.id, selected, null, false], result); },
  });
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const data = quota.data;
  const q = data?.quotas.find((a) => a.accountId === data.currentAccountId);
  const stale = !online || quota.isError || q?.stale || (refresh.variables === family && refresh.isError);
  const label = quotaFooterLabel(family, q?.windows ?? [], Date.now(), Boolean(stale), quota.isFetching, true);
  const windows = q?.windows ?? [];
  const meters = family === "antigravity"
    ? (["gemini", "claude"] as const).flatMap((pool) => {
      const window = selectQuotaWindow(family, pool, windows);
      return window ? [{ name: pool === "gemini" ? "G" : "C", window }] : [];
    })
    : [{ name: "", window: selectQuotaWindow(family, null, windows) }];
  const time = meters.length > 1
    ? meters.map((meter) => `${meter.name}${compactResetCountdown(meter.window?.resetAt, Date.now()).replace("分", "m").replace("时", "h").replace("天", "d")}`).join("/")
    : meters[0]?.window ? readableResetCountdown(meters[0].window.resetAt, Date.now(), dense) : quota.isFetching ? "读取中…" : "—";
  return <>
    <View testID="quota-footer-card" onLayout={(event) => setRowWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ minWidth: 0, flexDirection: "row", alignItems: "center", minHeight: 36, paddingHorizontal: dense ? 6 : 8, gap: dense ? 4 : 6 }}>
      <Pressable testID="quota-footer-trigger" accessibilityRole="button" accessibilityLabel={label}
        onPress={() => setOpen(true)} style={{ flexShrink: 1, minWidth: 0, minHeight: 36, flexDirection: "row", alignItems: "center", gap: dense ? 4 : 6 }}>
        <VendorMark family={family} size={16} />
        <Text testID="quota-footer-countdown" accessibilityLabel={`下次额度刷新 ${time}${stale ? "，缓存" : ""}`} numberOfLines={1}
          style={{ color: stale ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: dense || meters.length > 1 ? 10 : 12, fontVariant: ["tabular-nums"], flexShrink: 1 }}>{time}{stale ? " · 缓存" : ""}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新额度" disabled={!online || quota.isFetching || refresh.isPending}
        onPress={() => { if (online) refresh.mutate(family); }} testID="quota-footer-refresh"
        style={{ minHeight: 36, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 5, opacity: online ? 1 : 0.55 }}>
        {(meters.length ? meters : [{ name: "", window: null }]).map((meter) => <View key={meter.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {meter.name ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{meter.name}</Text> : null}
          <QuotaMeter theme={theme} used={meter.window?.usedPercent ?? null} size={14} remaining ringRemaining
            compact prefix={meters.length > 1 ? "" : dense ? "剩余" : "剩余 "} textSize={meters.length > 1 ? 10 : dense ? 11 : 12} circleAfter strokeWidth={2.5} />
        </View>)}
      </Pressable>
    </View>
    <Modal title="模型额度" icon={<VendorMark family={family} size={18} />} open={open} onOpenChange={setOpen}>
      <Modal.Content scrollable={false} style={{ backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 10, flex: 1 }}>
        <QuotaPanel {...props} family={family} onFamilyChange={setFamily} />
      </Modal.Content>
    </Modal>
  </>;
}
