import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useHosts, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountsPanel } from "./accounts.tsx";
import { LoginPanel } from "./login.tsx";
import { PiManagerPanel } from "./pi-manager.tsx";
import { hexAlpha } from "./ui.tsx";
import type { Family } from "../shared/accounts.ts";

export function ManagerEntry(props: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="PanelsTopLeft"
      label="铁铁汁"
      active={props.currentScreen?.screenId === "manager"}
      onPress={() => props.openScreen({ screenId: "manager" })}
    />
  );
}

export function ManagerScreen(props: PluginScreenProps) {
  return <ManagerBody key={props.host.id} {...props} />;
}

function ManagerBody(props: PluginScreenProps) {
  const { theme, host, layout } = props;
  const hosts = useHosts();
  const online = hosts.some((entry) => entry.serverId === host.id && entry.status === "online");
  const [tab, setTab] = useState<"accounts" | "plugins">("accounts");
  const [login, setLogin] = useState<Family | null>(null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{
        maxWidth: 960,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: layout.compact ? 12 : 24,
        paddingVertical: layout.compact ? 12 : 18,
        gap: 16,
      }}
    >
      {/* Top Bar: Segmented Tabs + Quick Login Actions + Device Badge */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: hexAlpha(theme.colors.border, 0.4),
          paddingBottom: 14,
        }}
      >
        {/* Segmented Control */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: theme.colors.surface1,
            borderRadius: 7,
            padding: 3,
            borderWidth: 1,
            borderColor: hexAlpha(theme.colors.border, 0.6),
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="账号"
            onPress={() => { setTab("accounts"); setLogin(null); }}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 16,
              borderRadius: 5,
              backgroundColor: tab === "accounts" ? hexAlpha(theme.colors.foreground, 0.08) : "transparent",
            }}
          >
            <Text
              style={{
                color: tab === "accounts" ? theme.colors.foreground : theme.colors.foregroundMuted,
                fontSize: 12,
                fontWeight: tab === "accounts" ? "600" : "400",
              }}
            >
              账号
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pi 插件"
            onPress={() => { setTab("plugins"); setLogin(null); }}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 16,
              borderRadius: 5,
              backgroundColor: tab === "plugins" ? hexAlpha(theme.colors.foreground, 0.08) : "transparent",
            }}
          >
            <Text
              style={{
                color: tab === "plugins" ? theme.colors.foreground : theme.colors.foregroundMuted,
                fontSize: 12,
                fontWeight: tab === "plugins" ? "600" : "400",
              }}
            >
              Pi 插件
            </Text>
          </Pressable>
        </View>

        {/* Right Actions: Add Account & Device Badge */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {tab === "accounts" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {(["codex", "xai", "antigravity"] as const).map((fam) => (
                <Pressable
                  key={fam}
                  accessibilityRole="button"
                  accessibilityLabel={`登录 ${fam}`}
                  disabled={!online}
                  onPress={() => setLogin(login === fam ? null : fam)}
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderRadius: 5,
                    borderWidth: 1,
                    borderColor: login === fam ? theme.colors.accent : hexAlpha(theme.colors.border, 0.6),
                    backgroundColor: login === fam ? hexAlpha(theme.colors.accent, 0.1) : hexAlpha(theme.colors.foreground, 0.03),
                    opacity: !online ? 0.4 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: login === fam ? theme.colors.accent : theme.colors.foreground,
                      fontSize: 11,
                      fontWeight: "500",
                    }}
                  >
                    + {fam === "codex" ? "Codex" : fam === "xai" ? "xAI" : "Antigravity"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {/* Body Area */}
      {tab === "plugins" ? (
        <PiManagerPanel {...props} />
      ) : (
        <View style={{ gap: 12 }}>
          {login ? (
            <LoginPanel
              key={`${host.id}:${login}`}
              {...props}
              family={login}
              autoStart={true}
              onClose={() => setLogin(null)}
            />
          ) : null}
          <AccountsPanel {...props} />
        </View>
      )}
    </ScrollView>
  );
}
