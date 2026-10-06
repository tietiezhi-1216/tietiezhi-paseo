import type { Family } from "../shared/accounts.ts";
import type { PluginTheme } from "@getpaseo/plugin";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Platform as RNPlatform, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { vendorIconUri, type VendorId } from "./vendor-icons.ts";
import { usedLabel } from "../shared/ui-format.ts";
import { quotaMeterAppearance, quotaRingPoint } from "../shared/quota-meter.ts";

export function hexAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const n = parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function VendorMark({ family, size = 16 }: { family: Family; size?: number }) {
  if (family === "go") return null;
  const label = family === "codex" ? "OpenAI" : family === "xai" ? "Grok" : "Antigravity";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Image accessibilityLabel={label} source={{ uri: vendorIconUri(family) }} resizeMode="contain" style={{ width: size, height: size }} />
    </View>
  );
}

export function RemainingBar({ used, theme, size = 16, remaining = false, strokeWidth }: {
  used: number | null | undefined;
  theme: PluginTheme;
  size?: number;
  remaining?: boolean;
  strokeWidth?: number;
}) {
  const { amount: value, color } = quotaMeterAppearance(used, remaining);
  const px = size;
  const stroke = Math.min(px / 2, strokeWidth ?? (px <= 16 ? 1.6 : 2.4));
  const track = hexAlpha(theme.colors.foregroundMuted, 0.22);
  const amount = value ?? 0;
  const label = `${remaining ? "剩余额度" : "已用额度"} ${value === null ? "未知" : `${Math.round(amount)}%`}`;
  if (RNPlatform.OS === "web") {
    const inner = Math.max(0, (1 - stroke / (px / 2)) * 100);
    const mask = `radial-gradient(farthest-side, transparent ${inner}%, #000 calc(${inner}% + 0.6px))`;
    return <View accessibilityLabel={label} style={{
      width: px,
      height: px,
      borderRadius: px / 2,
      ...({
        backgroundImage: `conic-gradient(from 0deg, ${color} ${amount}%, ${track} 0)`,
        WebkitMaskImage: mask,
        maskImage: mask,
      } as Record<string, string>),
    }} />;
  }
  const segments = 90;
  return <View accessibilityLabel={label} style={{ width: px, height: px }}>
    <View style={{ position: "absolute", width: px, height: px, borderRadius: px / 2, borderWidth: stroke, borderColor: track }} />
    {Array.from({ length: Math.round(amount / 100 * segments) }, (_, index) => <View key={index}
      style={{ position: "absolute", ...quotaRingPoint(index, segments, px, stroke), width: stroke, height: stroke, borderRadius: stroke / 2, backgroundColor: color }} />)}
  </View>;
}

export function QuotaMeter({ used, theme, size = 16, muted = false, remaining = true, ringRemaining = false, emphasized = false, compact = false, strokeWidth, prefix = "", textSize, circleAfter = false }: {
  used: number | null | undefined;
  theme: PluginTheme;
  size?: number;
  muted?: boolean;
  remaining?: boolean;
  ringRemaining?: boolean;
  emphasized?: boolean;
  compact?: boolean;
  strokeWidth?: number;
  prefix?: string;
  textSize?: number;
  circleAfter?: boolean;
}) {
  const displayVal = used === null || used === undefined ? null : remaining ? Math.max(0, 100 - used) : used;
  return (
    <View style={{ flexDirection: circleAfter ? "row-reverse" : "row", alignItems: "center", gap: compact ? 4 : 6, height: size }}>
      <RemainingBar used={used} theme={theme} size={size} remaining={ringRemaining} strokeWidth={strokeWidth} />
      <Text numberOfLines={1} style={{
        color: muted ? theme.colors.foregroundMuted : theme.colors.foreground,
        fontSize: textSize ?? (compact ? 12 : size >= 16 ? 13 : 11),
        fontWeight: emphasized ? "600" : "400",
        lineHeight: size,
        minWidth: compact ? 26 : 32,
        textAlign: "right",
        fontVariant: ["tabular-nums"],
      }}>
        {prefix}{usedLabel(displayVal)}
      </Text>
    </View>
  );
}

export function Action({ theme, title, label = title, onPress, disabled = false, testID }: {
  theme: PluginTheme; title: string; label?: string; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} testID={testID}
    style={{ paddingHorizontal: 12, paddingVertical: 6, minHeight: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, backgroundColor: hexAlpha(theme.colors.foreground, 0.04), opacity: disabled ? 0.45 : 1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
  </Pressable>;
}

export function IconAction({ theme, title, icon, onPress, disabled = false, testID }: {
  theme: PluginTheme; title: string; icon: string; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} testID={testID}
    style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>
    <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
  </Pressable>;
}

export function Tabs<Id extends string>({ theme, items, value, onChange, prefix }: {
  theme: PluginTheme; items: readonly (readonly [Id, string])[]; value: Id; onChange: (value: Id) => void; prefix?: string;
}) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
    {items.map(([id, title]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ selected: value === id }} testID={prefix ? `${prefix}-${id}` : undefined} onPress={() => onChange(id)}
      style={{ paddingHorizontal: 9, paddingVertical: 8, minHeight: 32, borderBottomWidth: 2, borderBottomColor: value === id ? theme.colors.accent : "transparent" }}>
      <Text style={{ color: value === id ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: value === id ? "600" : "400", fontSize: 12 }}>{title}</Text>
    </Pressable>)}
  </View>;
}

export function ChannelTabs<Id extends string>({ theme, items, value, onChange, prefix }: {
  theme: PluginTheme;
  items: readonly (readonly [Id, string, VendorId])[];
  value: Id;
  onChange: (value: Id) => void;
  prefix?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.colors.surface1, padding: 3, borderRadius: 8, borderWidth: 1, borderColor: hexAlpha(theme.colors.border, 0.5) }}>
      {items.map(([id, title, vendor]) => {
        const on = value === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={title}
            testID={prefix ? `${prefix}-${id}` : undefined}
            onPress={() => onChange(id)}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minHeight: 32,
              paddingVertical: 6,
              paddingHorizontal: 8,
              borderRadius: 6,
              backgroundColor: on ? theme.colors.surface2 : "transparent",
              opacity: on ? 1 : 0.7,
            }}
          >
            <VendorMark family={vendor} size={16} />
            <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: on ? "700" : "500" }}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Disclosure({ theme, title = "详情", children, testID }: {
  theme: PluginTheme; title?: string; children: ReactNode; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} testID={testID}
      onPress={() => setOpen(!open)} style={{ minHeight: 28, justifyContent: "center", alignSelf: "flex-start" }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{open ? "⌄" : "›"} {title}</Text>
    </Pressable>
    {open ? <View style={{ gap: 4 }}>{children}</View> : null}
  </View>;
}

export function Notice({ theme, text, error = false }: { theme: PluginTheme; text: string; error?: boolean }) {
  return <Text accessibilityRole={error ? "alert" : undefined}
    style={{ color: error ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{text}</Text>;
}

export function Loading({ theme }: { theme: PluginTheme }) {
  return <View style={{ padding: 12 }}><ActivityIndicator color={theme.colors.accent} /></View>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
