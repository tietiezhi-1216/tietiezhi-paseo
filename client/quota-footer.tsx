import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useHosts, useRpc, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Family } from "../shared/accounts.ts";
import { type QuotaSnapshot, getQuota, selectQuotaWindow } from "../shared/quota.ts";
import { compactResetCountdown, readableResetCountdown, naturalCountdown, quotaFooterLabel } from "../shared/quota-footer-label.ts";
import { QuotaPanel, useQuota } from "./quota-panel.tsx";
import { QuotaMeter, VendorMark } from "./ui.tsx";

function parseModelText(raw: string): { family: Family; pool?: "gemini" | "claude" } | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;
  if (text.includes("gemini")) return { family: "antigravity", pool: "gemini" };
  if (text.includes("claude")) return { family: "antigravity", pool: "claude" };
  if (text.includes("grok") || text.includes("xai")) return { family: "xai" };
  if (text.includes("gpt") || text.includes("openai") || text.includes("codex") || /\bo[1-4]\b/.test(text)) {
    if (text.includes("antigravity")) return { family: "antigravity", pool: "claude" };
    return { family: "codex" };
  }
  return null;
}

export function detectCurrentModelInfo(): { family: Family; pool?: "gemini" | "claude" } | null {
  if (typeof document === "undefined") return null;

  const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));

  // 1. Primary: find visible model selector button in active chat (offsetParent !== null and width > 0)
  const activeButtons = allButtons.filter((b: any) => {
    if (b.offsetParent === null) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  for (const b of activeButtons) {
    const label = b.getAttribute("aria-label") || "";
    const text = b.textContent || "";
    const match = /(?:选择模型|select model)[（(]([^）)]+)[）)]/i.exec(label);
    if (match) {
      const parsed = parseModelText(match[1]);
      if (parsed) return parsed;
    }
    if (/gemini|claude|grok|gpt|chatgpt/i.test(label) || /gemini|claude|grok|gpt|chatgpt/i.test(text)) {
      const parsed = parseModelText(label + " " + text);
      if (parsed) return parsed;
    }
  }

  // 2. Fallback to any button with model pattern
  for (const b of allButtons) {
    const label = b.getAttribute("aria-label") || "";
    const match = /(?:选择模型|select model)[（(]([^）)]+)[）)]/i.exec(label);
    if (match) {
      const parsed = parseModelText(match[1]);
      if (parsed) return parsed;
    }
  }

  return null;
}

export function useCurrentModel(): { family: Family; pool?: "gemini" | "claude" } | null {
  const [model, setModel] = useState<{ family: Family; pool?: "gemini" | "claude" } | null>(() => detectCurrentModelInfo());
  useEffect(() => {
    const check = () => {
      const cur = detectCurrentModelInfo();
      setModel((prev) => {
        if (!cur && !prev) return prev;
        if (cur && prev && cur.family === prev.family && cur.pool === prev.pool) return prev;
        return cur;
      });
    };
    check();
    const interval = setInterval(check, 1000);
    const observer = typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body
      ? new MutationObserver(check)
      : null;
    observer?.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      clearInterval(interval);
      observer?.disconnect();
    };
  }, []);
  return model;
}

export function QuotaFooter(props: PluginSidebarItemProps) { return <HostQuotaFooter key={props.host.id} {...props} />; }
function HostQuotaFooter(props: PluginSidebarItemProps) {
  const { theme, host } = props;
  const [open, setOpen] = useState(false);

  const [rowWidth, setRowWidth] = useState(240);
  const dense = rowWidth < 230;
  const detected = useCurrentModel();
  const [browsedFamily, setBrowsedFamily] = useState<Family | null>(null);

  // Footer displays currently active model in chat
  const footerFamily = detected?.family ?? "codex";
  // Modal defaults to active model, but allows browsing other channels
  const panelFamily = browsedFamily ?? footerFamily;
  const onPanelFamilyChange = (f: Family) => setBrowsedFamily(f);

  const online = useHosts().find((h) => h.serverId === host.id)?.status === "online";
  const quota = useQuota(host.id, footerFamily, null, true);
  const rpc = useRpc(getQuota);
  const queries = useQueryClient();
  const refresh = useMutation({
    mutationFn: (selected: Family) => {
      if (selected === "go") throw new Error("此渠道已停用");
      return rpc({ family: selected, refresh: true });
    },
    onSuccess(result, selected) {
      queries.setQueriesData<any>({ queryKey: ["tietiezhi", "quota", host.id, selected, null, true] }, (old: any) => {
        if (!old) return result;
        const newQuotas = Array.isArray(old.quotas) ? [...old.quotas] : [];
        for (const q of result.quotas) {
          const idx = newQuotas.findIndex(item => item.accountId === q.accountId);
          if (idx >= 0) newQuotas[idx] = q; else newQuotas.push(q);
        }
        return { ...old, ...result, quotas: newQuotas };
      });
      queries.setQueryData(["tietiezhi", "quota", host.id, selected, null, false], result);
    },
  });
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const data = quota.data ?? queries.getQueryData<QuotaSnapshot>(["tietiezhi", "quota", host.id, footerFamily, null, false]);
  const q = data?.quotas.find((a: any) => a.accountId === data.currentAccountId) ?? data?.quotas[0];
  const stale = !online || quota.isError || q?.stale || (refresh.variables === footerFamily && refresh.isError);
  const label = quotaFooterLabel(footerFamily, q?.windows ?? [], Date.now(), Boolean(stale), quota.isFetching, true);
  const windows = q?.windows ?? [];
  const activePool = detected?.pool ?? (footerFamily === "antigravity" ? "gemini" : null);
  const meters = [{ name: "", window: selectQuotaWindow(footerFamily, activePool, windows) }];
  const time = meters[0]?.window ? naturalCountdown(meters[0].window.resetAt, Date.now()) : quota.isFetching ? "读取中…" : "—";
  return <>
    <Pressable testID="quota-footer-card" accessibilityRole="button" accessibilityLabel={label}
      onPress={() => { setOpen(true); if (online) refresh.mutate(footerFamily); }} onLayout={(event) => setRowWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34, paddingHorizontal: dense ? 6 : 10, paddingVertical: 4, borderRadius: 6, gap: dense ? 4 : 8 }}>
      <View testID="quota-footer-trigger" pointerEvents="none"
        style={{ flexShrink: 1, minWidth: 0, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <VendorMark family={footerFamily} size={15} />
        <Text testID="quota-footer-countdown" accessibilityLabel={`下次额度刷新 ${time}${stale ? "，缓存" : ""}`} numberOfLines={1}
          style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", lineHeight: 16, fontVariant: ["tabular-nums"], flexShrink: 1 }}>{time}</Text>
      </View>
      <View testID="quota-footer-refresh" pointerEvents="none"
        aria-disabled={!online || quota.isFetching || refresh.isPending}
        style={{ minHeight: 30, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, opacity: online ? 1 : 0.55 }}>
        {(meters.length ? meters : [{ name: "", window: null }]).map((meter) => <View key={meter.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {meter.name ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{meter.name}</Text> : null}
          <QuotaMeter theme={theme} used={meter.window?.usedPercent ?? null} size={14} remaining ringRemaining circleAfter={false}
            compact prefix="" textSize={12} strokeWidth={1.8} />
        </View>)}
      </View>
    </Pressable>
    <Modal title="模型额度" icon={<VendorMark family={panelFamily} size={18} />} open={open} onOpenChange={(val) => { setOpen(val); if (!val) setBrowsedFamily(null); }}>
      <Modal.Content scrollable={false} style={{ backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 10, flex: 1 }}>
        <QuotaPanel {...props} family={panelFamily} onFamilyChange={onPanelFamilyChange} />
      </Modal.Content>
    </Modal>
  </>;
}
