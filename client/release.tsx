import React, { useEffect, useMemo, useState, useLayoutEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, Text as NativeText, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type PluginSurfaceProps, openExternalUrl, useHosts, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  RELEASE_SNAPSHOT_QUERY_KEY,
  displayTitle, recordEmphasis,
  stageTiming,
  partnerStateLabel,
  releaseSnapshot, releasePulse, releasePreferences,
  stateLabel,
  sitePresentation,
  type PartnerRecord,
  type PullRequestDisplayState,
  type PullRequestRelease,
  type SiteAvailability,
} from "../shared/release.ts";

type Theme = PluginSurfaceProps["theme"];
function Text({style, ...props}: React.ComponentProps<typeof NativeText>) {
  return <NativeText {...props} style={[{fontFamily:"monospace"}, style]} />;
}

type PanelTab = "pulls" | "commits";

function stateColor(state: PullRequestDisplayState, theme: Theme): string {
  switch (state) {
    case "checking":
    case "running":
    case "batched":
      return theme.colors.accent;
    case "waiting":
    case "pending":
    case "verifying":
    case "queued":
      return theme.colors.statusWarning;
    case "no_runtime":
      return theme.colors.foregroundMuted;
    case "success":
      return theme.colors.statusSuccess;
    case "failure":
      return theme.colors.statusDanger;
  }
}

function DeploymentCard({source, item, now, stale, theme}: {source: "GIT" | "SVN"; item: PullRequestRelease | PartnerRecord; now: number; stale: boolean; theme: Theme}) {
  const timing = stageTiming(item, now);
  const phase = "phase" in item ? item.phase : null;
  const color = stateColor(item.state, theme);
  return <View accessibilityLabel={source === "GIT" ? "GitHub 部署" : "SVN 部署"} style={{borderWidth:1,borderColor:color,borderRadius:8,overflow:"hidden",backgroundColor:theme.colors.surface1}}>
    {!stale && timing.determinate ? <View style={{position:"absolute",left:0,top:0,bottom:0,width:`${timing.progress*100}%`,backgroundColor:color,opacity:0.12}} /> : null}
    <View style={{padding:9,gap:6}}>
      <View style={{flexDirection:"row",alignItems:"center",gap:6}}>
        <Text style={{fontSize:11,fontWeight:"800",color,paddingHorizontal:5,paddingVertical:2,borderRadius:4,backgroundColor:theme.colors.surface0}}>{source}</Text>
        <Text numberOfLines={1} style={{fontSize:11,color,fontWeight:"600",flexShrink:1}}>{stale ? "状态待确认 · #" : "id" in item && item.id.startsWith("jenkins:queue:") ? "排队 · Q" : `${phase === "building" ? "构建中" : phase === "deploying" ? "安装中" : phase === "verifying" ? "验证中" : stateLabel(item.state)} · #`}{item.number}</Text>
        <View style={{flex:1}} />
        <Text numberOfLines={1} style={{fontSize:10,color,fontVariant:["tabular-nums"]}}>{stale ? "上次记录" : timing.time}</Text>
      </View>
      <Text selectable style={{fontSize:12,color:theme.colors.foreground}}>{displayTitle(item.title)}</Text>
      {"batchNote" in item && item.batchNote ? <Text selectable style={{fontSize:10,color:theme.colors.foregroundMuted}}>{item.batchNote}</Text> : null}
      {"queuedIds" in item && item.queuedIds?.length ? <Text numberOfLines={1} style={{fontSize:10,color:theme.colors.statusWarning}}>另有 {item.queuedIds.length} 项排队 · {item.queuedIds.map(id=>`Q${id}`).join(", ")}</Text> : null}
    </View>
  </View>;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function relativeTime(value: string, now: number): string {
  const delta = Math.max(0, now - Date.parse(value));
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}小时前`;
  return `${Math.floor(delta / 86_400_000)}天前`;
}

function hoverDetail(input: {
  title: string;
  subtitleLabel: string;
  subtitle: string;
  batchNote?: string | null;
  failureReason?: string | null;
}): string {
  return [
    input.title,
    input.subtitle ? `${input.subtitleLabel} ${input.subtitle}` : "",
    input.batchNote ?? "",
    input.failureReason ?? "",
  ].filter(Boolean).join("\n");
}

function CompactRow({
  numberLabel,
  author,
  title,
  titleTag,
  status,
  statusColor,
  time,
  detail,
  url,
  theme,
  onHover,
  progress = 0,
  emphasis = 1,
}: {
  numberLabel: string;
  author: string;
  title: string;
  titleTag: string | null;
  status: string;
  statusColor: string;
  time: string;
  detail: string;
  url: string | null;
  theme: Theme;
  onHover: (detail: string | null) => void;
  progress?: number;
  emphasis?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = (
    <View style={{ position: "relative", overflow: "hidden", opacity: emphasis }}>
      {progress > 0 ? (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(progress * 100)}%`, backgroundColor: statusColor, opacity: 0.13 }} />
      ) : null}
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>{numberLabel}</Text>
          <Text numberOfLines={1} style={{ color: statusColor, fontSize: 11, fontWeight: "600", flexShrink: 1 }}>{status}</Text>
          <Text numberOfLines={1} style={{maxWidth:96, fontSize:10, color:theme.colors.foregroundMuted}}>{author}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>{time}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {titleTag ? <Text numberOfLines={1} style={{ maxWidth: 90, color: theme.colors.foregroundMuted, fontSize: 10 }}>{titleTag}</Text> : null}
          <Text numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{displayTitle(title)}</Text>
        </View>
      </View>
    </View>
  );
  return (
    <View><Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${numberLabel} ${title} ${status} ${time}`}
      accessibilityHint={detail}
      onHoverIn={() => onHover(detail)}
      onHoverOut={() => onHover(null)}
      onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => ({
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface1 : theme.colors.surface0,
      })}
    >
      {body}
    </Pressable>
    {expanded ? <View style={{ padding: 12, gap: 8, backgroundColor: theme.colors.surface1 }}>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 19 }}>{detail}</Text>
      {url && /^https?:\/\//i.test(url) ? <Pressable accessibilityRole="link" accessibilityLabel="在浏览器打开记录"
        onPress={() => { void openExternalUrl(url).catch(() => onHover("无法打开链接，请稍后重试")); }}>
        <Text style={{ color: theme.colors.accent, fontSize: 12, paddingVertical: 8 }}>在浏览器打开记录 ↗</Text>
      </Pressable> : null}
    </View> : null}</View>
  );
}

function PullRequestRow({
  item,
  now,
  theme,
  onHover,
  stale,
}: {
  stale: boolean;
  item: PullRequestRelease;
  now: number;
  theme: Theme;
  onHover: (detail: string | null) => void;
}) {
  const timing = stageTiming(item, now);
  return (
    <CompactRow
      numberLabel={`#${item.number}`}
      author={`@${item.author ?? "未知"}`}
      title={item.title}
      titleTag={item.titleTag}
      status={stale && timing.active ? "状态待确认" : item.phase === "building" ? "构建中" : item.phase === "deploying" ? "安装中" : item.phase === "verifying" ? "验证中" : stateLabel(item.state)}
      statusColor={stateColor(item.state, theme)}
      time={stale && timing.active ? "旧数据" : timing.time ?? relativeTime(item.updatedAt, now)}
      progress={!stale && timing.active ? timing.progress : 0}
      emphasis={recordEmphasis(item.state, item.updatedAt, now)}
      detail={hoverDetail({
        title: `${item.title}\n作者: ${item.author ?? "未知"}\n分类: ${item.titleTag ?? "无"}`,
        subtitleLabel: "分支",
        subtitle: item.branchName,
        batchNote: item.batchNote,
        failureReason: item.failureReason,
      })}
      url={item.url}
      theme={theme}
      onHover={onHover}
    />
  );
}

function PartnerRow({
  item,
  now,
  theme,
  onHover,
  stale,
}: {
  stale: boolean;
  item: PartnerRecord;
  now: number;
  theme: Theme;
  onHover: (detail: string | null) => void;
}) {
  const timing = stageTiming(item, now);
  return (
    <CompactRow
      numberLabel={item.kind === "commit" ? `r${item.number}` : `#${item.number}`}
      author={`作者 ${item.author ?? "未知"}`}
      title={item.title}
      titleTag={item.titleTag}
      status={stale && timing.active ? "状态待确认" : partnerStateLabel(item.kind, item.state)}
      statusColor={stateColor(item.state, theme)}
      time={stale && timing.active ? "旧数据" : timing.time ?? relativeTime(item.updatedAt, now)}
      progress={!stale && timing.active ? timing.progress : 0}
      emphasis={recordEmphasis(item.state, item.updatedAt, now)}
      detail={hoverDetail({
        title: `${item.title}\n作者: ${item.author ?? "未知"}`,
        subtitleLabel: item.kind === "commit" ? "作者" : "任务",
        subtitle: item.subtitle,
        failureReason: item.failureReason,
      })}
      url={item.url}
      theme={theme}
      onHover={onHover}
    />
  );
}

function AttentionDot({ theme }: { theme: Theme }) {
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.statusDanger }} accessibilityLabel="有新内容" />;
}

function SitePill({ site, stale, theme }: { site: SiteAvailability | null; stale: boolean; theme: Theme }) {
  const presentation = sitePresentation(site, stale);
  const color = presentation.tone === "healthy" ? theme.colors.statusSuccess
    : presentation.tone === "unhealthy" ? theme.colors.statusDanger : theme.colors.statusWarning;
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
      <Text style={{ color, fontSize: 13, fontWeight: "700" }}>{presentation.label}</Text>
    </View>
  );
}

function isNewer(value: string, seen: number): boolean {
  if (seen <= 0) return value.length > 0;
  const at = Date.parse(value);
  return Number.isFinite(at) && at > seen;
}

export function ReleaseSurface({ theme, host }: PluginSurfaceProps) {
  const invokeSnapshot = useRpc(releaseSnapshot);
  const now = useNow();
  const preferences = useSettings(releasePreferences);
  const tab = preferences.status === "ready" ? preferences.values.tab : "pulls";
  const seenPulls = preferences.status === "ready" ? preferences.values.seenPulls : 0;
  const seenSvn = preferences.status === "ready" ? preferences.values.seenSvn : 0;
  const [hover, setHover] = useState<string | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const hosts = useHosts();
  const online = hosts.some(entry => entry.serverId === host.id && entry.status === "online");
  const client = useQueryClient();
  const key = [...RELEASE_SNAPSHOT_QUERY_KEY, host.id];
  const pulse = useRpc(releasePulse);
  const wake = useQuery({ queryKey: ["tietiezhi-release-pulse", host.id], queryFn: () => pulse({}),
    enabled: online, refetchInterval: 5_000, retry: false });
  const revision = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wake.data && revision.current !== wake.data.revision) {
      if (revision.current !== undefined) void client.invalidateQueries({ queryKey: key });
      revision.current = wake.data.revision;
    }
  }, [wake.data?.revision, host.id, client]);
  const query = useQuery({
    queryKey: key,
    enabled: online,
    queryFn: () => invokeSnapshot({}),
    retry: 1,
    refetchInterval: query => query.state.error || query.state.data?.error
      || query.state.data?.pullRequests.some(item => ["checking", "waiting", "pending", "verifying", "queued", "batched", "running"].includes(item.state))
      || query.state.data?.partnerRecords.some(item => item.kind === "deploy") ? 15_000 : 60_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchOnMount: "always",
  });
  const stats = tab === "pulls" ? query.data?.githubStats : query.data?.svnStats;
  const stale = !online || !!query.error || !!query.data?.error || !query.data
    || !Number.isFinite(Date.parse(query.data.fetchedAt)) || now - Date.parse(query.data.fetchedAt) > 95_000;
  const items = query.data?.pullRequests ?? [];
  const partnerItems = query.data?.partnerRecords ?? [];
  const partnerDeploys = useMemo(
    () => partnerItems.filter((item) => item.kind === "deploy" && ["running", "queued"].includes(item.state)),
    [partnerItems],
  );
  const partnerCommits = useMemo(
    () => partnerItems.filter((item) => item.kind === "commit"),
    [partnerItems],
  );
  const githubUnseen = tab !== "pulls" && items.some((item) => isNewer(item.updatedAt, seenPulls));
  const svnUnseen = tab !== "commits" && partnerCommits.some((item) => isNewer(item.updatedAt, seenSvn));
  const running = items.find((item) => item.state === "running");
  const githubActive = items.some((item) => ["running", "queued", "batched"].includes(item.state));

  useEffect(() => {
    if (preferences.status !== "ready" || preferences.saving || !query.data || query.data.error) return;
    const at = Date.parse(query.data.fetchedAt);
    const field = tab === "pulls" ? "seenPulls" : "seenSvn";
    if (Number.isFinite(at) && preferences.values[field] < at) {
      void preferences.save({ ...preferences.values, [field]: at }, preferences.revision);
    }
  }, [tab, query.data?.fetchedAt, preferences.status === "ready" ? preferences.revision : null, preferences.saving]);

  const selectTab = (next: PanelTab) => {
    setHover(null);
    if (preferences.status === "ready") void preferences.save({
      ...preferences.values, tab: next, [next === "pulls" ? "seenPulls" : "seenSvn"]: Date.now(),
    }, preferences.revision);
  };

  function publishedTime(stamp: string | null | undefined): string {
    if (!stamp) return "暂无数据";
    const date = new Date(stamp);
    return date.toLocaleString(undefined, { ...(date.toDateString() === new Date(now).toDateString() ? {} : {month:"2-digit",day:"2-digit"} as const), hour:"2-digit", minute:"2-digit", hour12:false });
  }

  const tabs: Array<{ id: PanelTab; label: string; unseen: boolean }> = [
    { id: "pulls", label: "GIT", unseen: githubUnseen },
    { id: "commits", label: "SVN", unseen: svnUnseen },
  ];

  if (preferences.status !== "ready") return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>发布面板设置{preferences.status === "loading" ? "读取中…" : "读取失败，请重新打开面板"}</Text>;

  return (
    <View testID="tietiezhi-release-board" style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
        <SitePill site={query.data?.site ?? null} stale={stale} theme={theme} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", gap: 2, borderRadius: 7, padding: 2, backgroundColor: theme.colors.surface1 }}>
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => selectTab(item.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 5,
                  backgroundColor: selected ? theme.colors.surface0 : "transparent",
                }}
              >
                <Text style={{ color: selected ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12, fontWeight: "800" }}>
                  {item.label}
                </Text>
                {item.unseen ? <AttentionDot theme={theme} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ paddingHorizontal: 8, paddingBottom: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <Pressable accessibilityRole="button" accessibilityLabel="发布统计详情" accessibilityState={{ expanded: statsExpanded }} onPress={() => setStatsExpanded(value => !value)}>
        <Text numberOfLines={1} style={{ color: stale ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 11 }}>
          {`最近 ${publishedTime(stats?.lastPublishedAt)} · ${tab === "pulls" ? "预计" : "Jenkins"} ${stats && stats.sampleCount > 0 && stats.estimatedDurationMs ? `${Math.floor(Math.round(stats.estimatedDurationMs / 1000) / 60)}分${Math.round(stats.estimatedDurationMs / 1000) % 60}秒` : "暂无数据"}${stale ? " · 旧数据" : ""}`}
        </Text>
        </Pressable>
        {statsExpanded ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>完成时间：{stats?.lastPublishedAt ? new Date(stats.lastPublishedAt).toLocaleString() : "暂无数据"} · {stats?.sampleCount ?? 0} 次成功样本\n{query.data?.releaseSummary ?? ""}</Text> : null}
        {githubActive && (running ?? items.find(item => ["queued", "batched"].includes(item.state))) ? <DeploymentCard source="GIT" item={(running ?? items.find(item => ["queued", "batched"].includes(item.state)))!} now={now} stale={stale} theme={theme} /> : null}
        {partnerDeploys.map(item => <DeploymentCard key={item.id} source="SVN" item={item} now={now} stale={stale || !!query.data?.warnings.some(warning => warning.includes("Jenkins"))} theme={theme} />)}
      </View>
      {!online || query.error || query.data?.error ? <Text style={{ color: theme.colors.statusWarning, fontSize: 12, padding: 8 }}>{!online ? "当前 Host 离线，保留上次记录；不会切换到其他设备" : "等待同步 · 保留上次记录，自动重试中"}</Text> : null}
      {preferences.saveError ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>面板偏好保存失败，请重试切换</Text> : null}
      {(query.data?.warnings ?? []).map((warning) => (
        <Text key={warning} numberOfLines={1} style={{ color: theme.colors.statusWarning, fontSize: 10, paddingHorizontal: 8 }}>{warning}</Text>
      ))}

      <HistoryTransition identity={tab}><ScrollView key={tab} nestedScrollEnabled showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        {tab === "pulls" ? (
          items.length === 0
            ? <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center", marginTop: 28, fontSize: 12 }}>{query.isPending ? "正在读取发布记录…" : query.error || query.data?.error ? "读取暂不可用，自动重试中" : "最近 24 小时没有 PR"}</Text>
            : items.map((item) => <PullRequestRow key={item.number} item={item} now={now} stale={stale} theme={theme} onHover={setHover} />)
        ) : null}
        {tab === "commits" ? (
          partnerCommits.length === 0
            ? <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center", marginTop: 28, fontSize: 12 }}>{query.isPending ? "正在读取 SVN 记录…" : query.error || query.data?.error ? "读取暂不可用，自动重试中" : query.data?.warnings.some(warning => warning.includes("SVN")) ? "SVN 记录读取待确认，稍后自动重试" : "最近 24 小时没有 SVN 提交"}</Text>
            : partnerCommits.map((item) => <PartnerRow key={item.id} item={item} now={now} stale={stale} theme={theme} onHover={setHover} />)
        ) : null}
      </ScrollView></HistoryTransition>
      {hover ? (
        <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 10, lineHeight: 13, paddingHorizontal: 10, paddingVertical: 4, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          {hover}
        </Text>
      ) : null}
    </View>
  );
}

function HistoryTransition({identity, children}: {identity:string;children:React.ReactNode}) {
 const [reduced,setReduced]=useState(true);const opacity=useRef(new Animated.Value(1)).current;
 useEffect(()=>{let alive=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setReduced(v)});const sub=AccessibilityInfo.addEventListener("reduceMotionChanged",setReduced);return()=>{alive=false;sub.remove()}},[]);
 useLayoutEffect(()=>{opacity.stopAnimation();opacity.setValue(reduced?1:0);const a=Animated.timing(opacity,{toValue:1,duration:reduced?0:160,useNativeDriver:false});a.start();return()=>a.stop()},[identity,reduced,opacity]);
 return <Animated.View style={{flex:1,opacity}}>{children}</Animated.View>;
}
