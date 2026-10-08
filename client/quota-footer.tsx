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
import { activeAccountStore, persistentQuotaStore, updatePersistentQuotas } from "./quota-cache.ts";

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

function isElementVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (typeof window === "undefined" || !window.getComputedStyle) return true;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

export function detectCurrentModelInfo(): { family: Family; pool?: "gemini" | "claude" } | null {
  if (typeof document === "undefined") return null;

  // 1. Look for visible combined-model-selector (both real Paseo and test mock have this testID!)
  // Search bottom-to-top so active chat composer takes precedence
  const byTestId = Array.from(document.querySelectorAll(
    '[data-testid="combined-model-selector"], [data-testid="agent-controls-model"]'
  )).filter(isElementVisible);

  byTestId.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  for (const el of byTestId) {
    const raw = (el.getAttribute("aria-label") || "") + " " + (el.textContent || "");
    const parsed = parseModelText(raw);
    if (parsed) return parsed;
  }

  // 2. Visible button matching "选择模型（...）" or "Select model (...)" in active chat
  const activeBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter((b) => isElementVisible(b) && /(?:选择模型|select model)[（(].+[）)]/i.test(b.getAttribute("aria-label") || ""));

  activeBtns.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  for (const b of activeBtns) {
    const raw = (b.getAttribute("aria-label") || "") + " " + (b.textContent || "");
    const parsed = parseModelText(raw);
    if (parsed) return parsed;
  }

  // 3. Fallback: look near the active textarea in composer
  const textareas = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).filter(isElementVisible);
  textareas.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  const activeInput = textareas[0];
  if (activeInput) {
    let container: Element | null = activeInput.parentElement;
    for (let depth = 0; depth < 5 && container; depth++) {
      const modelBtn = Array.from(container.querySelectorAll('button, [role="button"]')).find((b) => {
        const txt = (b.getAttribute("aria-label") || "") + " " + (b.textContent || "");
        return /gemini|claude|grok|gpt|chatgpt/i.test(txt);
      });
      if (modelBtn) {
        const txt = (modelBtn.getAttribute("aria-label") || "") + " " + (modelBtn.textContent || "");
        const parsed = parseModelText(txt);
        if (parsed) return parsed;
      }
      container = container.parentElement;
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
      updatePersistentQuotas(result.quotas);
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

  if (quota.data?.quotas) {
    updatePersistentQuotas(quota.data.quotas, footerFamily, quota.data.currentAccountId);
  }

  const cachedData = queries.getQueryData<QuotaSnapshot>(["tietiezhi", "quota", host.id, footerFamily, null, true]);
  const data = (quota.data?.family === footerFamily ? quota.data : undefined)
    ?? (cachedData?.family === footerFamily ? cachedData : undefined);
  const activeAccountId = data?.currentAccountId ?? activeAccountStore[footerFamily];
  const q = (activeAccountId ? data?.quotas.find((a: any) => a.accountId === activeAccountId) : undefined)
    ?? (activeAccountId ? persistentQuotaStore[activeAccountId] : undefined)
    ?? data?.quotas.find((a: any) => a.accountId === data?.currentAccountId)
    ?? data?.quotas[0]
    ?? (activeAccountId ? persistentQuotaStore[activeAccountId] : undefined);

  const stale = !online || quota.isError || q?.stale || (refresh.variables === footerFamily && refresh.isError);
  const label = quotaFooterLabel(footerFamily, q?.windows ?? [], Date.now(), Boolean(stale), quota.isFetching, true);
  const windows = q?.windows ?? [];
  const activePool = detected?.pool ?? (footerFamily === "antigravity" ? "gemini" : null);
  const activeWindow = selectQuotaWindow(footerFamily, activePool, windows);
  const isAuthError = Boolean(q?.error && /授权已失效|401|登录|invalid_grant|unauthorized/i.test(q.error));
  const isExpired = Boolean(activeWindow && activeWindow.resetAt != null && activeWindow.resetAt <= Date.now());
  const meters = [{ name: "", window: isAuthError ? null : activeWindow }];
  const time = isAuthError
    ? "需登录"
    : activeWindow
      ? (isExpired ? "已重置" : naturalCountdown(activeWindow.resetAt, Date.now()))
      : quota.isFetching
        ? "读取中…"
        : "—";
  return <>
    <View testID="quota-footer-card" onLayout={(event) => setRowWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34, paddingHorizontal: dense ? 6 : 10, paddingVertical: 4, borderRadius: 6, gap: dense ? 4 : 8 }}>
      <Pressable testID="quota-footer-trigger" accessibilityRole="button" accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={{ flex: 1, minWidth: 0, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <VendorMark family={footerFamily} size={15} />
        <Text testID="quota-footer-countdown" accessibilityLabel={`下次额度刷新 ${time}${stale ? "，缓存" : ""}`} numberOfLines={1} pointerEvents="none"
          style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500", lineHeight: 16, fontVariant: ["tabular-nums"], flexShrink: 1 }}>{time}</Text>
      </Pressable>
      <Pressable testID="quota-footer-refresh" accessibilityRole="button" accessibilityLabel="刷新额度"
        disabled={!online || quota.isFetching || refresh.isPending}
        onPress={() => { setOpen(true); if (online) refresh.mutate(footerFamily); }}
        style={{ minHeight: 30, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4, opacity: online ? 1 : 0.55 }}>
        {(meters.length ? meters : [{ name: "", window: null }]).map((meter) => <View key={meter.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {meter.name ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{meter.name}</Text> : null}
          <QuotaMeter theme={theme} used={meter.window?.usedPercent ?? null} size={14} remaining ringRemaining circleAfter={false}
            compact prefix="" textSize={12} strokeWidth={1.8} />
        </View>)}
      </Pressable>
    </View>
    <Modal title={`模型额度 · ${host.label}`} icon={<VendorMark family={panelFamily} size={18} />} open={open} onOpenChange={(val) => { setOpen(val); if (!val) setBrowsedFamily(null); }}>
      <Modal.Content scrollable={false} style={{ backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 10, flex: 1 }}>
        <QuotaPanel {...props} family={panelFamily} onFamilyChange={onPanelFamilyChange} />
      </Modal.Content>
    </Modal>
  </>;
}
