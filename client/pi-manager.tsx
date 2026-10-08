import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { piInventory, piPackageChange, PiPackageSource } from "../shared/pi-manager.ts";
import { Action, Notice, Loading, hexAlpha } from "./ui.tsx";

export function PiManagerPanel(props: PluginSurfaceProps) {
  return <HostPiManager key={props.host.id} {...props} />;
}

function HostPiManager({ host, theme }: PluginSurfaceProps) {
  const online = useHosts().some((entry) => entry.serverId === host.id && entry.status === "online");
  const list = useRpc(piInventory), change = useRpc(piPackageChange);
  const inventory = useQuery({ queryKey: ["tietiezhi", "pi", host.id], queryFn: () => list({}), enabled: online, retry: false, gcTime: 0 });
  const [source, setSource] = useState("");
  const [confirmation, setConfirmation] = useState<{ operation: "install" | "remove" | "update" | "update-pi"; source: string; revision: string } | null>(null);
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (selection: NonNullable<typeof confirmation>) => change({ ...selection, confirmed: true }),
    onSuccess: (result) => { setConfirmation(null); setNotice(result.notice); void inventory.refetch(); },
    onError: () => { setConfirmation(null); void inventory.refetch(); },
  });

  const choose = (operation: "install" | "remove" | "update" | "update-pi", value: string) => {
    if (inventory.data) setConfirmation({ operation, source: value, revision: inventory.data.revision });
    setNotice("");
  };

  const disabled = !online || mutation.isPending || !inventory.data;

  return (
    <View style={{ gap: 12 }}>
      {/* Top Action Bar */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Pi · {inventory.data?.version ?? "..."}
          </Text>
          <Action
            theme={theme}
            title="更新 Pi"
            label="更新 Pi"
            disabled={disabled}
            onPress={() => choose("update-pi", "pi")}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <TextInput
            accessibilityLabel="Pi 插件安装来源"
            placeholder="npm:包名@版本"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={source}
            onChangeText={setSource}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              color: theme.colors.foreground,
              fontSize: 12,
              minWidth: 180,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderWidth: 1,
              borderColor: hexAlpha(theme.colors.border, 0.7),
              borderRadius: 6,
              backgroundColor: theme.colors.surface1,
            }}
          />
          <Action
            theme={theme}
            title="安装插件"
            label="安装"
            disabled={disabled || !PiPackageSource.safeParse(source.trim()).success}
            onPress={() => choose("install", source.trim())}
          />
          <Action
            theme={theme}
            title="刷新"
            label="刷新"
            disabled={!online || mutation.isPending}
            onPress={() => { void inventory.refetch(); }}
          />
        </View>
      </View>

      {inventory.isPending && online ? <Loading theme={theme} /> : null}
      {inventory.error ? <Notice theme={theme} error text="无法读取 Pi 插件列表" /> : null}

      {/* Confirmation Card */}
      {confirmation ? (
        <View style={{ padding: 12, gap: 8, borderRadius: 8, borderWidth: 1, borderColor: hexAlpha(theme.colors.accent, 0.4), backgroundColor: hexAlpha(theme.colors.accent, 0.05) }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
            {confirmation.operation === "update-pi"
              ? `确认在 ${host.label} 上将 Pi 更新至最新版本？`
              : `确认在 ${host.label} 上${confirmation.operation === "install" ? "安装" : confirmation.operation === "remove" ? "卸载" : "更新"} ${confirmation.source}？`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Action theme={theme} title={mutation.isPending ? "执行中…" : "确认操作"} disabled={disabled} onPress={() => mutation.mutate(confirmation)} />
            <Action theme={theme} title="取消" disabled={mutation.isPending} onPress={() => setConfirmation(null)} />
          </View>
        </View>
      ) : null}

      {mutation.error ? <Notice theme={theme} error text={mutation.error instanceof Error ? mutation.error.message : "操作失败"} /> : null}
      {notice ? <Notice theme={theme} text={notice} /> : null}

      {/* Packages List */}
      <View style={{ gap: 8 }}>
        {inventory.data?.packages.map((entry) => (
          <View
            key={entry.source}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: hexAlpha(theme.colors.border, 0.6),
              backgroundColor: theme.colors.surface1,
              gap: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {entry.name}
                </Text>
                {entry.version ? (
                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, backgroundColor: hexAlpha(theme.colors.foreground, 0.08) }}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>
                      v{entry.version}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text selectable numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {entry.source}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Action theme={theme} title={`更新 ${entry.name}`} label="更新" disabled={disabled || !entry.managed} onPress={() => choose("update", entry.source)} />
              <Action theme={theme} title={`卸载 ${entry.name}`} label="卸载" disabled={disabled || !entry.managed} onPress={() => choose("remove", entry.source)} />
            </View>
          </View>
        ))}
      </View>

      {/* Local Extensions Footer */}
      {inventory.data?.localExtensions?.length ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 2 }}>
            本地扩展（位于 ~/.pi/agent/extensions/ 目录）：
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {inventory.data.localExtensions.map((ext) => (
              <View
                key={ext}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                  backgroundColor: hexAlpha(theme.colors.foreground, 0.05),
                }}
              >
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  {ext === "model-list.ts"
                    ? "model-list.ts（模型目录精简）"
                    : ext === "subagent"
                    ? "subagent（子智能体配置）"
                    : ext}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
