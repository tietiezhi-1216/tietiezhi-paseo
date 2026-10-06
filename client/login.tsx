import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FAMILY_LABELS, type Family } from "../shared/accounts.ts";
import { cancelLogin, loginStatus, startLogin, type LoginState } from "../shared/login.ts";
import { Action, Notice } from "./ui.tsx";

export function LoginPanel({ theme, host, family, onClose }: PluginSurfaceProps & { family: Family; onClose(): void }) {
  const start = useRpc(startLogin), status = useRpc(loginStatus), cancel = useRpc(cancelLogin);
  const queries = useQueryClient();
  const online = useHosts().find((entry) => entry.serverId === host.id)?.status === "online";
  const [initial, setInitial] = useState<LoginState | null>(null);
  const [error, setError] = useState("");
  const active = useRef<string | null>(null), alive = useRef(true), completed = useRef(false);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const supported = family === "codex" || family === "xai";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) {
        void cancelRef.current({ id: active.current }).catch(() => {});
        queries.removeQueries({ queryKey: ["tietiezhi", "login", host.id, active.current] });
      }
    };
  }, [queries, host.id]);
  const begin = useMutation({
    mutationFn: () => start({ family: family as "codex" | "xai", confirmed: true }),
    onSuccess(state) {
      if (!alive.current) { void cancel({ id: state.id }).catch(() => {}); return; }
      active.current = state.id; setInitial(state); setError("");
    },
    onError() { if (alive.current) setError("无法启动登录，请重试"); },
  });
  const query = useQuery({
    queryKey: ["tietiezhi", "login", host.id, initial?.id],
    queryFn: () => status({ id: initial!.id }),
    enabled: !!initial && online,
    refetchInterval: (q) => q.state.data && ["done", "error", "cancelled"].includes(q.state.data.status) ? false : 1000,
    retry: false, gcTime: 0,
  });
  const state = query.data ?? initial;
  useEffect(() => {
    if (state?.status === "done" && !completed.current) {
      completed.current = true;
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "accounts", host.id] });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", host.id, family] });
    }
  }, [state?.status, queries, host.id, family]);
  return <View testID="quota-login-panel" style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>登录 {FAMILY_LABELS[family]}</Text>
      <Action theme={theme} title={state?.status === "done" ? "完成" : "取消"} disabled={state?.status === "saving"} onPress={onClose} />
    </View>
    {!supported ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
      此渠道暂未接入面板登录。请在 {host.label} 的 Pi 中使用 /login，完成后重新打开面板。
    </Text> : <>
      {!initial ? <>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>保存到 {host.label}，不会自动切换默认账号。</Text>
        <Action theme={theme} title={begin.isPending ? "准备中…" : "开始登录"} disabled={!online || begin.isPending} onPress={() => begin.mutate()} />
      </> : null}
      {state?.userCode && state.url ? <>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>在官方验证页输入设备码：</Text>
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "600", letterSpacing: 2 }}>{state.userCode}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Action theme={theme} title="打开验证页" disabled={!online} onPress={() => { void Linking.openURL(state.url!).catch(() => setError("无法打开验证页，请复制链接")); }} />
          <Action theme={theme} title="复制链接" onPress={() => { void copyText(state.url!).catch(() => setError("复制失败")); }} />
        </View>
      </> : null}
      {state?.status === "starting" || state?.status === "saving" ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{state.status === "saving" ? "正在保存…" : "正在获取设备码…"}</Text> : null}
      {state?.status === "done" ? <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>已保存，可在账号列表中切换。</Text> : null}
      {error || state?.error || query.isError ? <Notice theme={theme} error text={error || state?.error || "登录状态读取失败"} /> : null}
    </>}
  </View>;
}
