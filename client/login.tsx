import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FAMILY_LABELS, type Family } from "../shared/accounts.ts";
import { cancelLogin, loginStatus, startLogin, type LoginState } from "../shared/login.ts";
import { Action, Notice, hexAlpha } from "./ui.tsx";

export function LoginPanel({
  theme,
  host,
  family,
  onClose,
  autoStart = false,
}: PluginSurfaceProps & { family: Family; onClose(): void; autoStart?: boolean }) {
  const start = useRpc(startLogin), status = useRpc(loginStatus), cancel = useRpc(cancelLogin);
  const queries = useQueryClient();
  const [initial, setInitial] = useState<LoginState | null>(null);
  const [error, setError] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const active = useRef<string | null>(null), alive = useRef(true), completed = useRef(false);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const supported = family === "codex" || family === "xai" || family === "antigravity";

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
    mutationFn: () => start({ family: family as "codex" | "xai" | "antigravity", confirmed: true }),
    onSuccess(state) {
      if (!alive.current) { void cancel({ id: state.id }).catch(() => {}); return; }
      active.current = state.id;
      setInitial(state);
      setError("");
    },
    onError(err) {
      if (alive.current) setError(err instanceof Error ? err.message : "无法启动登录，请重试");
    },
  });

  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && supported && !startedRef.current && !initial && !begin.isPending) {
      startedRef.current = true;
      begin.mutate();
    }
  }, [autoStart, supported, initial, begin]);

  const query = useQuery({
    queryKey: ["tietiezhi", "login", host.id, initial?.id],
    queryFn: () => status({ id: initial!.id }),
    enabled: Boolean(initial?.id),
    refetchInterval: (q) => q.state.data && ["done", "error", "cancelled"].includes(q.state.data.status) ? false : 800,
    retry: false,
    gcTime: 0,
  });

  const state = query.data ?? initial;

  useEffect(() => {
    if (state?.status === "done" && !completed.current) {
      completed.current = true;
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "accounts", host.id] });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", host.id, family] });
    }
  }, [state?.status, queries, host.id, family]);

  const isAntigravity = family === "antigravity";

  return (
    <View
      testID="quota-login-panel"
      style={{
        gap: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: hexAlpha(theme.colors.border, 0.7),
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          登录 {FAMILY_LABELS[family]}
        </Text>
        <Action
          theme={theme}
          title={state?.status === "done" ? "完成" : "取消"}
          disabled={state?.status === "saving"}
          onPress={onClose}
        />
      </View>

      {!supported ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          此渠道暂未接入面板登录。
        </Text>
      ) : (
        <>
          {!initial && !autoStart ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                保存到当前设备，不影响正在运行的会话。
              </Text>
              <Action
                theme={theme}
                title={begin.isPending ? "准备中…" : "开始登录"}
                disabled={begin.isPending}
                onPress={() => begin.mutate()}
              />
            </View>
          ) : null}

          {state?.status === "starting" || begin.isPending ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              正在连接官方授权服务…
            </Text>
          ) : null}

          {state?.url ? (
            <View style={{ gap: 8 }}>
              {!isAntigravity && state.userCode ? (
                <>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                    请在官方验证页输入设备码：
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: theme.colors.foreground,
                      fontSize: 24,
                      fontWeight: "700",
                      letterSpacing: 2,
                    }}
                  >
                    {state.userCode}
                  </Text>
                </>
              ) : (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  请在打开的 Google 页面中完成授权，完成后将自动保存：
                </Text>
              )}

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Action
                  theme={theme}
                  title={isAntigravity ? "打开 Google 授权页" : "打开验证页"}
                  onPress={() => {
                    void Linking.openURL(state.url!).catch(() => setError("无法打开验证页，请复制链接"));
                  }}
                />
                {!isAntigravity && state.userCode ? (
                  <Action
                    theme={theme}
                    title={copiedCode ? "已复制" : "复制授权码"}
                    label={copiedCode ? "已复制" : "复制授权码"}
                    onPress={() => {
                      void copyText(state.userCode!).then(() => {
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 1500);
                      });
                    }}
                  />
                ) : null}
                <Action
                  theme={theme}
                  title={copiedUrl ? "已复制链接" : "复制链接"}
                  label={copiedUrl ? "已复制链接" : "复制链接"}
                  onPress={() => {
                    void copyText(state.url!).then(() => {
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 1500);
                    });
                  }}
                />
              </View>
            </View>
          ) : null}

          {state?.status === "saving" ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              正在保存授权…
            </Text>
          ) : null}

          {state?.status === "done" ? (
            <Text style={{ color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "600" }}>
              ✓ 登录成功，已保存到账号列表。
            </Text>
          ) : null}

          {error || (state?.status === "error" && state?.error) ? (
            <Notice theme={theme} error text={error || state?.error || "登录失败，请重试"} />
          ) : null}
        </>
      )}
    </View>
  );
}
