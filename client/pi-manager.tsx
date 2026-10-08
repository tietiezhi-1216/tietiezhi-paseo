import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useHosts, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { piInventory, piPackageChange, PiPackageSource } from "../shared/pi-manager.ts";
import { Action, Notice, Loading } from "./ui.tsx";

export function PiManagerPanel(props: PluginSurfaceProps) {
  return <HostPiManager key={props.host.id} {...props} />;
}
function HostPiManager({ host, theme }: PluginSurfaceProps) {
  const online = useHosts().some((entry) => entry.serverId === host.id && entry.status === "online");
  const list = useRpc(piInventory), change = useRpc(piPackageChange);
  const inventory = useQuery({ queryKey: ["tietiezhi", "pi", host.id], queryFn: () => list({}), enabled: online, retry: false, gcTime: 0 });
  const [source, setSource] = useState("");
  const [confirmation, setConfirmation] = useState<{ operation: "install" | "remove" | "update"; source: string; revision: string } | null>(null);
  const [notice, setNotice] = useState("");
  const mutation = useMutation({
    mutationFn: (selection: NonNullable<typeof confirmation>) => change({ ...selection, confirmed: true }),
    onSuccess: (result) => { setConfirmation(null); setNotice(result.notice); void inventory.refetch(); },
    onError: () => { setConfirmation(null); void inventory.refetch(); },
  });
  const choose = (operation: "install" | "remove" | "update", value: string) => {
    if (inventory.data) setConfirmation({ operation, source: value, revision: inventory.data.revision });
    setNotice("");
  };
  const disabled = !online || mutation.isPending || !inventory.data;
  const text = { color: theme.colors.foreground, fontSize: 13 };
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={text}>Pi · {inventory.data?.version ?? "未知"}</Text>
      <Action theme={theme} title="刷新插件列表" label="刷新" disabled={!online || mutation.isPending} onPress={() => { void inventory.refetch(); }} />
    </View>
    {!online ? <Notice theme={theme} text="目标设备离线，不能读取或修改。不会回退到本机。" /> : null}
    {inventory.isPending && online ? <Loading theme={theme} /> : null}
    {inventory.error ? <Notice theme={theme} error text="无法读取目标设备的 Pi 插件。请确认该设备已安装并更新铁铁汁插件。" /> : null}
    <Notice theme={theme} text="管理所选设备的全局 npm 插件。项目插件、Git 安装和配置编辑将在后续加入。" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      <TextInput accessibilityLabel="Pi 插件安装来源" placeholder="npm:包名@版本" placeholderTextColor={theme.colors.foregroundMuted}
        value={source} onChangeText={setSource} editable={!disabled} autoCapitalize="none" autoCorrect={false}
        style={{ ...text, flex: 1, minWidth: 180, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 }} />
      <Action theme={theme} title="安装插件" disabled={disabled || !PiPackageSource.safeParse(source.trim()).success} onPress={() => choose("install", source.trim())} />
    </View>
    {inventory.data?.packages.map((entry) => <View key={entry.source} style={{ paddingVertical: 10, gap: 6 }}>
      <Text selectable style={{ ...text, fontWeight: "600" }}>{entry.name}</Text>
      <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>版本 {entry.version ?? "未知／未安装"} · {entry.source}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Action theme={theme} title={`更新 ${entry.name}`} label="更新" disabled={disabled || !entry.managed} onPress={() => choose("update", entry.source)} />
        <Action theme={theme} title={`卸载 ${entry.name}`} label="卸载" disabled={disabled || !entry.managed} onPress={() => choose("remove", entry.source)} />
      </View>
    </View>)}
    {inventory.data?.localExtensions.length ? <Notice theme={theme} text={`本地扩展（只读）：${inventory.data.localExtensions.join("、")}`} /> : null}
    {confirmation ? <View style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}>
      <Text style={text}>确认在 {host.label} 上{confirmation.operation === "install" ? "安装" : confirmation.operation === "remove" ? "卸载" : "更新"} {confirmation.source}？</Text>
      <Notice theme={theme} text="Pi 插件可执行代码、读取文件和账号。只安装信任的插件；变更可能影响正在运行的会话。" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Action theme={theme} title={mutation.isPending ? "执行中…" : "确认操作"} disabled={disabled} onPress={() => mutation.mutate(confirmation)} />
        <Action theme={theme} title="取消" disabled={mutation.isPending} onPress={() => setConfirmation(null)} />
      </View>
    </View> : null}
    {mutation.error ? <Notice theme={theme} error text={mutation.error instanceof Error ? mutation.error.message : "操作失败，请刷新核对"} /> : null}
    {notice ? <Notice theme={theme} text={notice} /> : null}
  </View>;
}
