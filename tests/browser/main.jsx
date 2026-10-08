import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import contribute from "../../index.client.tsx";
import { DashboardScreen } from "../../client/dashboard.tsx";
import { Runtime, setTestRuntime } from "./sdk.jsx";

const dark = {
  surface0: "#121417",
  surface1: "#1b1f24",
  surface2: "#24292f",
  border: "#30363d",
  foreground: "#f0f6fc",
  foregroundMuted: "#8b949e",
  accent: "#2ea043",
  statusSuccess: "#2ea043",
  statusWarning: "#d29922",
  statusDanger: "#f85149",
};
const light = {
  surface0: "#ffffff",
  surface1: "#f6f8fa",
  surface2: "#eaeef2",
  border: "#d0d7de",
  foreground: "#24292f",
  foregroundMuted: "#57606a",
  accent: "#1f883d",
  statusSuccess: "#1a7f37",
  statusWarning: "#9a6700",
  statusDanger: "#cf222e",
};

const hosts = [
  { serverId: "local", label: "MacBook-Air", status: "online" },
  { serverId: "remote", label: "公网服务器", status: "online" },
];
const calls = [];
const account = (id, label, active) => ({
  id: `codex:${id}`, family: "codex", label, slot: "openai-codex", authType: "oauth",
  plan: "Plus", expiresAt: Date.now() + 86400000, subscriptionExpiresAt: Date.now() + 86400000,
  active, canSwitch: true, problem: null,
});
const snapshots = {
  local: { revision: "a".repeat(64), accounts: [account("a", "测试账号 A", true), account("b", "测试账号 B", false)], warnings: [] },
  remote: { revision: "b".repeat(64), accounts: [account("a", "远程账号 A", true), account("b", "远程账号 B", false)], warnings: [] },
};
const loginSessions = new Map();
let delayQuota = false;
let releaseQuota;
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const slots = { header: [], footer: [] };
let mountedPills = [];
let pillRegistrations = 0;

function registerSidebar(location, contribution) {
  slots[location].push(contribution);
  return () => { slots[location] = slots[location].filter((item) => item !== contribution); };
}
const ignore = () => () => {};

let pillVersionTrigger = () => {};

const stopRegistrations = contribute({
  addComposerPill: (pill) => {
    throw new Error("不得注册 Composer 胶囊");
    pillRegistrations++;
    const pillState = { ...pill };
    mountedPills.push(pillState);
    return {
      update: (patch) => {
        Object.assign(pillState.button, patch);
        pillVersionTrigger();
      },
      remove: () => {
        mountedPills = mountedPills.filter((p) => p !== pillState);
        pillRegistrations = Math.max(0, pillRegistrations - 1);
        pillVersionTrigger();
      },
    };
  },
  addSidebarHeaderItem: (item) => registerSidebar("header", item),
  addSidebarFooterItem: (item) => registerSidebar("footer", item),
  addScreen: ignore, addSettingsScreen: ignore, addWorkspacePanel: ignore,
  addCommandCenterItem: ignore, addSlashCommand: ignore,
  paseo: {
    agents: {
      subscribe: () => () => {},
      list: async () => ({
        entries: [{ agent: { id: "agent-1", workspaceId: "ws-1", provider: "openai-codex", model: "gpt-5.5" } }],
        pageInfo: { hasMore: false },
      }),
    },
  },
});

function App() {
  const [hostId, setHostId] = useState("local");
  const [currentHosts, setHosts] = useState(hosts);
  const [isDark, setDark] = useState(true);
  const [pluginActive, setPluginActive] = useState(true);
  const [agentModel, setAgentModel] = useState("openai-codex/gpt-5.5");
  const [quotaFailure, setQuotaFailure] = useState(false);
  const [quotaResetOffset, setQuotaResetOffset] = useState(3 * 3600000);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [, setPillTick] = useState(0);
  pillVersionTrigger = () => setPillTick((t) => t + 1);

  const state = { hosts: currentHosts, calls };
  setTestRuntime(state);
  globalThis.__preview = {
    calls,
    pillRegistrations: () => pillRegistrations,
    offline: () => setHosts(hosts.map((h) => h.serverId === "remote" ? { ...h, status: "offline" } : h)),
    online: () => setHosts(hosts),
    selectHost: setHostId,
    light: () => setDark(false),
    selectModel: setAgentModel,
    quotaFailure: setQuotaFailure,
    quotaResetOffset: setQuotaResetOffset,
    delayNextQuota: () => { delayQuota = true; },
    releaseQuota: () => releaseQuota?.(),
    seedQuotaAccounts: (family, count) => {
      snapshots.local.accounts = snapshots.local.accounts.filter((account) => account.family !== family);
      for (let i = 0; i < count; i++) snapshots.local.accounts.push({
        ...account(String(i), "preview-" + i + "@example.invalid", i === 0),
        id: family + ":" + String(i).padStart(24, "0"), family, slot: family,
      });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "accounts", "local"] });
      void queries.invalidateQueries({ queryKey: ["tietiezhi", "quota", "local", family] });
    },
    refreshPanelQuota: () => queries.refetchQueries({ queryKey: ["tietiezhi", "quota", hostId, "codex"] }),
    sidebarItems: () => ({ header: slots.header.map((item) => item.id), footer: slots.footer.map((item) => item.id) }),
    stopPlugin: async () => { await stopRegistrations(); setPluginActive(false); },
  };

  const theme = { colors: isDark ? dark : light };
  const layout = { compact: innerWidth < 600, platform: "web" };
  const runtime = {
    hosts: currentHosts, theme, layout, agentModel,
    async rpc(name, input) {
      if (name.startsWith("tietiezhi.login.")) {
        calls.push({ kind: name, serverId: hostId, input });
        if (name.endsWith(".start")) {
          const session = { id: "12345678-1234-4123-8123-123456789abc", family: input.family, status: "waiting", url: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH", error: null };
          loginSessions.set(hostId, session); return structuredClone(session);
        }
        const session = loginSessions.get(hostId);
        if (!session || session.id !== input.id) throw new Error("登录会话已失效");
        if (name.endsWith(".cancel")) { session.status = "cancelled"; session.url = null; session.userCode = null; }
        return structuredClone(session);
      }
      if (name === "tietiezhi.quota.get") {
        if ((input.refresh || input.all) && delayQuota) { delayQuota = false; await new Promise((resolve) => { releaseQuota = resolve; }); }
        calls.push({ kind: "quota", serverId: hostId, input });
        const snapshot = structuredClone(snapshots[hostId]);
        const rows = snapshot.accounts.filter((a) => a.family === input.family);
        const current = input.slot?.includes("-account-") ? rows.find((a) => a.slot === input.slot) : rows.find((a) => a.active);
        const targets = input.all ? rows : rows.filter((a) => a.id === current?.id);
        return {
          snapshot,
          family: input.family,
          currentAccountId: current?.id ?? null,
          quotas: targets.map((a) => ({
            accountId: a.id,
            plan: "Plus",
            fetchedAt: 1791090000000,
            checkedAt: Date.now(),
            stale: quotaFailure,
            error: quotaFailure ? "模拟网络失败" : null,
            windows: a.family === "antigravity" ? [
              { id: "gemini-week", label: "Gemini · 本周", pool: "gemini", usedPercent: 20, resetAt: Date.now() + quotaResetOffset },
              { id: "claude-5h", label: "Claude · 5小时", pool: "claude", usedPercent: 65, resetAt: Date.now() + quotaResetOffset },
            ] : [{ id: "5h", label: a.family === "xai" ? "账期" : "5小时", pool: "shared", usedPercent: a.id.startsWith("codex:b") ? 65 : hostId === "remote" ? 24 : 28, resetAt: Date.now() + quotaResetOffset }],
          })),
        };
      }
      if (name.endsWith(".list")) return structuredClone(snapshots[hostId]);
      calls.push({ kind: "switch", serverId: hostId, input });
      snapshots[hostId] = { ...snapshots[hostId], revision: "c".repeat(64), accounts: snapshots[hostId].accounts.map((a) => ({ ...a, active: a.id === input.id })) };
      return { snapshot: structuredClone(snapshots[hostId]), backupCreated: true, notice: "测试切换成功" };
    },
  };

  const sidebarProps = {
    host: { id: hostId, label: currentHosts.find((h) => h.serverId === hostId).label },
    theme,
    layout,
    currentScreen: null,
    openScreen: (input) => calls.push({ kind: "open-screen", ...input }),
  };

  const currentPill = mountedPills[0];
  const IconComp = currentPill && typeof currentPill.button.icon === "function" ? currentPill.button.icon : null;
  const ContentComp = currentPill && currentPill.button.behavior.kind === "popover" ? currentPill.button.behavior.Content : null;

  return (
    <QueryClientProvider client={queries}><Runtime.Provider value={runtime}>
      <div style={{ minHeight: "100vh", background: theme.colors.surface0, color: theme.colors.foreground, fontFamily: "system-ui",
        display: "flex", flexDirection: layout.compact ? "column" : "row", position: "relative" }}>
        <aside data-testid="demo-sidebar-preview" style={{ width: layout.compact ? "auto" : 240, height: "100vh",
          boxSizing: "border-box", position: layout.compact ? "relative" : "sticky", top: 0, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: `1px solid ${theme.colors.border}`, borderBottom: `1px solid ${theme.colors.border}` }}>
          <div style={{ padding: 16, fontSize: 13 }}>tietiezhi · SDK 模拟外壳</div>
          {pluginActive ? slots.header.map(({ id, Component }) => <Component key={id} {...sidebarProps} />) : null}
          <div data-testid="sidebar-project-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", color: theme.colors.foregroundMuted }}>
            {Array.from({ length: 16 }, (_, i) => <div key={i} style={{ padding: 12, fontSize: 13 }}>示例工作区 {i + 1}</div>)}
          </div>
          <div data-testid="sidebar-add-project" style={{ padding: 12, fontSize: 13 }}>＋ 添加项目（模拟）</div>
          <div data-testid="sidebar-footer-slot">
            {pluginActive ? slots.footer.map(({ id, Component }) => <Component key={id} {...sidebarProps} />) : null}
          </div>
          <div data-testid="sidebar-system-icons" style={{ padding: 12, fontSize: 12, borderTop: `1px solid ${theme.colors.border}` }}>主机 · 设置（模拟原生栏）</div>
        </aside>
        <main style={{ flex: 1, minWidth: 0 }}>
          <header style={{ padding: 16, borderBottom: `1px solid ${theme.colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>模拟数据预览</span>
            <button data-testid="combined-model-selector" aria-label={`模型 · ${agentModel}`} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, background: theme.colors.surface1, color: theme.colors.foreground, border: `1px solid ${theme.colors.border}` }}>{agentModel}</button>
          </header>
          <div style={{ maxWidth: 1000, margin: "auto", height: "calc(100vh - 56px)" }}>
            {pluginActive ? <DashboardScreen host={{ id: hostId, label: currentHosts.find((h) => h.serverId === hostId).label }}
              theme={theme} layout={layout} params={{}}
              navigation={{ openAgent: (target) => calls.push({ kind: "navigate", ...target }) }} /> : null}
          </div>
        </main>

        {pluginActive && currentPill ? (
          <div data-testid="mock-composer-toolbar" style={{
            position: "fixed", bottom: 20, right: 24, zIndex: 120,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <button
              data-testid="composer-quota-pill"
              onClick={() => setPopoverOpen(!popoverOpen)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", borderRadius: 16,
                backgroundColor: theme.colors.surface1, border: `1px solid ${theme.colors.border}`,
                color: theme.colors.foreground, cursor: "pointer", fontSize: 12,
              }}
            >
              {IconComp ? <IconComp {...sidebarProps} size={16} context="agent" workspaceId="ws-1" agentId="agent-1" color={theme.colors.foreground} /> : null}
              <span>{currentPill.button.label && currentPill.button.label !== "—" ? currentPill.button.label : currentPill.button.title}</span>
            </button>
            {popoverOpen && ContentComp ? (
              <div
                data-testid="composer-quota-popover"
                style={{
                  position: "absolute", bottom: 42, right: 0,
                  borderRadius: 10, border: `1px solid ${theme.colors.border}`,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.4)", overflow: "hidden",
                  backgroundColor: theme.colors.surface0,
                }}
              >
                <ContentComp {...sidebarProps} context="agent" workspaceId="ws-1" agentId="agent-1" close={() => setPopoverOpen(false)} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Runtime.Provider></QueryClientProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
