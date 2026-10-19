import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { getPaseoClient, useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { exportSyncBundle, importSyncBundle, type SyncExportOutput, type SyncImportOutput } from "../shared/sync.ts";
import { Action, Loading, Notice, hexAlpha } from "./ui.tsx";

export function SyncPanel(props: PluginSurfaceProps) {
  const { theme, host } = props;
  const hosts = useHosts();
  const currentHostId = host.id;
  const otherHosts = hosts.filter((h) => h.serverId !== currentHostId);

  const [mode, setMode] = useState<"online" | "manual">("online");
  const [targetHostId, setTargetHostId] = useState<string>(() => otherHosts[0]?.serverId || "");
  const [includeAccounts, setIncludeAccounts] = useState(true);
  const [includePiPackages, setIncludePiPackages] = useState(true);
  const [includeModelOverrides, setIncludeModelOverrides] = useState(true);
  const [includePaseoProxy, setIncludePaseoProxy] = useState(false);
  const [password, setPassword] = useState("");
  const [manualPayload, setManualPayload] = useState("");
  const [exportedResult, setExportedResult] = useState<SyncExportOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportRpc = useRpc(exportSyncBundle);
  const importRpc = useRpc(importSyncBundle);

  const syncOptions = {
    includeAccounts,
    includePiPackages,
    includeModelOverrides,
    includePaseoProxy,
  };

  const handleOnlineSync = async () => {
    if (!targetHostId) {
      setError("请先选择目标设备");
      return;
    }
    const targetHost = hosts.find((h) => h.serverId === targetHostId);
    if (!targetHost || targetHost.status !== "online") {
      setError("目标设备离线，无法进行在线同步");
      return;
    }

    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      // 1. Export from source host (current host)
      setNotice(`正在从 [${host.label}] 打包配置…`);
      const exportRes = await exportRpc({
        options: syncOptions,
        password: password.trim() || undefined,
      });

      // 2. Import into target host via getPaseoClient
      setNotice(`正在向 [${targetHost.label}] 传输并合并…`);
      const client = getPaseoClient(targetHostId) as any;
      const importRes = (await client.invokePluginRpc("tietiezhi", "tietiezhi.sync.import", {
        payload: exportRes.payload,
        password: password.trim() || undefined,
        confirmed: true,
        strategy: "merge",
      })) as SyncImportOutput;

      setNotice(`🎉 同步成功！${importRes.notice} 目标设备 [${targetHost.label}] 已应用。`);
    } catch (err: any) {
      setError(err?.message || "同步失败，请检查两端网络或重试");
    } finally {
      setBusy(false);
    }
  };

  const handleExportManual = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const exportRes = await exportRpc({
        options: syncOptions,
        password: password.trim() || undefined,
      });
      setExportedResult(exportRes);
      setNotice(`已生成备份包（包含 ${exportRes.summary.accountCount} 个账号凭据）。可复制下方内容保存。`);
    } catch (err: any) {
      setError(err?.message || "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const handleImportManual = async () => {
    if (!manualPayload.trim()) {
      setError("请粘贴备份数据文本");
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const importRes = await importRpc({
        payload: manualPayload.trim(),
        password: password.trim() || undefined,
        confirmed: true,
        strategy: "merge",
      });
      setNotice(`🎉 导入成功！${importRes.notice}`);
      setManualPayload("");
    } catch (err: any) {
      setError(err?.message || "导入失败，请检查密码或备份文本完整性");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {/* Segmented Mode Switcher */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: theme.colors.surface1,
          borderRadius: 7,
          padding: 3,
          borderWidth: 1,
          borderColor: hexAlpha(theme.colors.border, 0.6),
          alignSelf: "flex-start",
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => { setMode("online"); setNotice(null); setError(null); }}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 16,
            borderRadius: 5,
            backgroundColor: mode === "online" ? hexAlpha(theme.colors.foreground, 0.08) : "transparent",
          }}
        >
          <Text
            style={{
              color: mode === "online" ? theme.colors.foreground : theme.colors.foregroundMuted,
              fontSize: 12,
              fontWeight: mode === "online" ? "600" : "400",
            }}
          >
            🌐 在线设备直连同步
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => { setMode("manual"); setNotice(null); setError(null); }}
          style={{
            paddingVertical: 5,
            paddingHorizontal: 16,
            borderRadius: 5,
            backgroundColor: mode === "manual" ? hexAlpha(theme.colors.foreground, 0.08) : "transparent",
          }}
        >
          <Text
            style={{
              color: mode === "manual" ? theme.colors.foreground : theme.colors.foregroundMuted,
              fontSize: 12,
              fontWeight: mode === "manual" ? "600" : "400",
            }}
          >
            📦 离线备份与还原
          </Text>
        </Pressable>
      </View>

      {/* Sync Items Checklist */}
      <View
        style={{
          backgroundColor: hexAlpha(theme.colors.surface1, 0.5),
          borderWidth: 1,
          borderColor: hexAlpha(theme.colors.border, 0.4),
          borderRadius: 8,
          padding: 12,
          gap: 8,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          选择要同步的内容：
        </Text>
        <View style={{ gap: 6 }}>
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            onPress={() => setIncludeAccounts(!includeAccounts)}
          >
            <Text style={{ color: includeAccounts ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 14 }}>
              {includeAccounts ? "☑" : "☐"}
            </Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              所有账号授权凭据（包含 6 个 Anti-Gravity Google 账号、Codex、xAI）
            </Text>
          </Pressable>
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            onPress={() => setIncludeModelOverrides(!includeModelOverrides)}
          >
            <Text style={{ color: includeModelOverrides ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 14 }}>
              {includeModelOverrides ? "☑" : "☐"}
            </Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              Pi 自定义模型名称与覆盖配置 (models.json)
            </Text>
          </Pressable>
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            onPress={() => setIncludePiPackages(!includePiPackages)}
          >
            <Text style={{ color: includePiPackages ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 14 }}>
              {includePiPackages ? "☑" : "☐"}
            </Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              Pi 扩展包安装列表 (npm:pi-antigravity 等)
            </Text>
          </Pressable>
          <Pressable
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            onPress={() => setIncludePaseoProxy(!includePaseoProxy)}
          >
            <Text style={{ color: includePaseoProxy ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 14 }}>
              {includePaseoProxy ? "☑" : "☐"}
            </Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              Paseo HTTP/HTTPS 代理配置（默认关闭，保持各设备网络独立）
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Mode A: Online Host-to-Host */}
      {mode === "online" ? (
        <View
          style={{
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: hexAlpha(theme.colors.border, 0.5),
            borderRadius: 8,
            padding: 14,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: 60 }}>源设备：</Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              {host.label}（当前设备）
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: 60 }}>目标设备：</Text>
            {otherHosts.length === 0 ? (
              <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
                未发现其他已连接的 Paseo 设备。若要同步到新设备，请先在 Paseo App 中配对该设备。
              </Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 }}>
                {otherHosts.map((h) => {
                  const selected = h.serverId === targetHostId;
                  const isOnline = h.status === "online";
                  return (
                    <Pressable
                      key={h.serverId}
                      onPress={() => setTargetHostId(h.serverId)}
                      style={{
                        paddingVertical: 4,
                        paddingHorizontal: 10,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: selected ? theme.colors.accent : hexAlpha(theme.colors.border, 0.4),
                        backgroundColor: selected ? hexAlpha(theme.colors.accent, 0.1) : hexAlpha(theme.colors.foreground, 0.02),
                        opacity: isOnline ? 1 : 0.5,
                      }}
                    >
                      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: selected ? "600" : "400" }}>
                        {isOnline ? "🟢" : "⚪"} {h.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Action
              theme={theme}
              title={busy ? "同步中…" : "一键同步到目标设备"}
              disabled={busy || otherHosts.length === 0}
              onPress={handleOnlineSync}
            />
          </View>
        </View>
      ) : (
        /* Mode B: Manual Export / Import */
        <View
          style={{
            backgroundColor: theme.colors.surface1,
            borderWidth: 1,
            borderColor: hexAlpha(theme.colors.border, 0.5),
            borderRadius: 8,
            padding: 14,
            gap: 12,
          }}
        >
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              可选安全保护密码（若设置密码，备份包将使用 AES-256-GCM 强加密）：
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="可选密码（留空则生成无密码明文备份）"
              placeholderTextColor={theme.colors.foregroundMuted}
              secureTextEntry
              style={{
                color: theme.colors.foreground,
                backgroundColor: theme.colors.surface0,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 8,
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Action
              theme={theme}
              title={busy ? "处理中…" : "导出当前设备备份包"}
              disabled={busy}
              onPress={handleExportManual}
            />
          </View>

          {exportedResult ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                备份数据（已包含所选账号与配置，可复制并在另一台设备上导入）：
              </Text>
              <TextInput
                value={exportedResult.payload}
                editable={false}
                multiline
                numberOfLines={4}
                style={{
                  color: theme.colors.foreground,
                  backgroundColor: theme.colors.surface0,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 10,
                  fontFamily: "monospace",
                  height: 80,
                }}
              />
            </View>
          ) : null}

          <View style={{ height: 1, backgroundColor: hexAlpha(theme.colors.border, 0.3), marginVertical: 4 }} />

          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
              从备份包导入到当前设备：
            </Text>
            <TextInput
              value={manualPayload}
              onChangeText={setManualPayload}
              placeholder="粘贴从其他设备导出的备份数据…"
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              numberOfLines={3}
              style={{
                color: theme.colors.foreground,
                backgroundColor: theme.colors.surface0,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 8,
                borderRadius: 6,
                fontSize: 10,
                fontFamily: "monospace",
                height: 70,
              }}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Action
                theme={theme}
                title={busy ? "导入中…" : "开始还原合并"}
                disabled={busy || !manualPayload.trim()}
                onPress={handleImportManual}
              />
            </View>
          </View>
        </View>
      )}

      {/* Feedback Messages */}
      {busy ? <Loading theme={theme} /> : null}
      {notice ? <Notice theme={theme} text={notice} /> : null}
      {error ? <Notice theme={theme} error text={error} /> : null}
    </View>
  );
}
