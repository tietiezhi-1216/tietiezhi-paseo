import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { contributeAgentsPills } from "../../client/agents-pill.tsx";
import { Runtime, setTestRuntime, setAgentSyncEnvironment } from "./agents-sync-sdk.jsx";

const calls = [];
const hosts = [{ serverId: "a", label: "本机 A", status: "online" }, { serverId: "b", label: "远端 B", status: "online" }];
const native = (id, extra = {}) => ({ id, title: id === "current" ? "插件开发" : id, workspaceId: "workspace", status: "running", requiresAttention: false, attentionReason: null, labels: {}, updatedAt: new Date().toISOString(), ...extra });
const rows = {
  a: [native("current", { status: "idle" }), native("shared-id"), native("a2"), native("a3"), native("child", { labels: { "paseo.parent-agent-id": "current" } }), native("archived", { status: "idle", attentionReason: "finished", archivedAt: "2026-10-08T00:00:00Z" })],
  b: [native("current", { status: "idle" }), native("shared-id"), native("b2"), native("b3"), native("completed", { status: "idle", requiresAttention: true, attentionReason: "finished" }), native("idle", { status: "idle" })],
};
const remote = (hostId, row) => ({ hostId, hostName: hostId, serverId: hostId, id: row.id, name: row.title, status: row.status, requiresAttention: row.requiresAttention, attentionReason: row.attentionReason, createdAt: null, updatedAt: row.updatedAt, lastUserMessageAt: null, workspaceId: row.workspaceId, workspace: hostId, archivedAt: row.archivedAt ?? null, parentAgentId: row.labels["paseo.parent-agent-id"] ?? null });
const listeners = { a: new Set(), b: new Set() };
const subscriptions = new Set();
const observations = new Map();
let subscriptionId = 0;
let listGate, rpcGate;
const emit = (hostId, row, remove = false) => {
  const index = rows[hostId].findIndex(item => item.id === row.id);
  const next = { ...row, ...(remove ? { archivedAt: new Date().toISOString() } : {}) };
  if (index >= 0) rows[hostId][index] = next; else rows[hostId].push(next);
  const update = remove ? { kind: "remove", agentId: row.id } : { kind: "upsert", agent: next, project: { workspaceName: hostId } };
  for (const listener of listeners[hostId]) listener(update);
  for (const observation of observations.values()) {
    if (observation.hostId !== hostId) continue;
    for (const observer of observation.observers) observer.update({ type: "agent_update", payload: update });
  }
};
const apis = Object.fromEntries(hosts.map(({ serverId }) => [serverId, { agents: {
  subscribe: listener => { listeners[serverId].add(listener); return () => listeners[serverId].delete(listener); },
  list: async options => {
    const entries = structuredClone(rows[serverId]).map(agent => ({ agent, project: { workspaceName: serverId } }));
    let subscription;
    if (options.subscribe) {
      const id = ++subscriptionId; subscriptions.add(id);
      const observation = { hostId: serverId, observers: new Set() };
      observations.set(id, observation);
      subscription = {
        subscribe(observer) { observation.observers.add(observer); observer.snapshot({ entries, pageInfo: { hasMore: false }, subscriptionId: String(id) }); return () => observation.observers.delete(observer); },
        async release() { subscriptions.delete(id); observations.delete(id); },
      };
    }
    if (listGate?.hostId === serverId && options.filter) {
      const gate = listGate; listGate = null;
      await new Promise(resolve => { gate.release = resolve; globalThis.__agentsSync.releaseList = resolve; });
    }
    return { entries, subscription, pageInfo: { hasMore: false, nextCursor: null } };
  },
  ref: id => ({ archive: async () => { emit(serverId, rows[serverId].find(row => row.id === id), true); } }),
} }]));
const environment = { hosts, apis };
setAgentSyncEnvironment(environment);
setTestRuntime({ hosts, calls });
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const dark = { surface0: "#171c19", surface1: "#212722", surface2: "#292f29", border: "#394139", foreground: "#efefef", foregroundMuted: "#9aa59c", accent: "#56aa88", statusSuccess: "#56aa88", statusWarning: "#aa8844", statusDanger: "#dd5555" };
const light = { ...dark, surface0: "#fff", surface1: "#f3f5f3", foreground: "#222", foregroundMuted: "#657069", border: "#cbd3ce" };

function App() {
  const [hostId, setHost] = useState("a");
  const [active, setActive] = useState(true);
  const [open, setOpen] = useState(false);
  const [isLight, setLight] = useState(false);
  const [pill, setPill] = useState(null);
  const theme = { colors: isLight ? light : dark };
  const props = { host: { id: hostId, label: hosts.find(h => h.serverId === hostId).label }, layout: { platform: "web", compact: innerWidth < 600 }, theme, context: "agent", workspaceId: "workspace", agentId: "current" };
  globalThis.__agentsSync = {
    ...globalThis.__agentsSync, calls, subscriptions, listeners,
    setHost: id => { setOpen(false); setHost(id); }, light: setLight,
    emit: (host, id, status, attentionReason = null) => emit(host, native(id, { status, attentionReason, requiresAttention: attentionReason === "finished" })),
    archive: (host, id) => emit(host, rows[host].find(row => row.id === id), true),
    rename: (host, id, title) => emit(host, { ...rows[host].find(row => row.id === id), title }),
    unrelatedRemoval: (host, id) => { for (const listener of listeners[host]) listener({ kind: "remove", agentId: id }); },
    stop: () => { setOpen(false); setActive(false); },
    gateList: hostId => { listGate = { hostId }; },
    gateRpc: () => { rpcGate = {}; },
    refresh: () => queries.invalidateQueries({ queryKey: ["slotgame-agent-activity"] }),
    watcherCounts: () => ({ a: listeners.a.size, b: listeners.b.size, subscriptions: subscriptions.size }),
  };
  useEffect(() => {
    if (!active) { setPill(null); return; }
    return contributeAgentsPills({
      paseo: apis[hostId],
      // Reproduce the old text path: only THREE working agents, no done.
      rpc: async () => { calls.push({ kind: "direct-rpc" }); return { agents: rows.a.filter(row => row.status === "running" && !row.labels["paseo.parent-agent-id"]).map(row => remote("a", row)), hosts: [] }; },
      addComposerPill(input) {
        if (input.agentId !== "current") return { update() {}, remove() {} };
        const record = { ...input, button: { ...input.button } };
        setPill(record);
        return {
          update(patch) { Object.assign(record.button, patch); setPill({ ...record }); },
          remove() { setPill(null); },
        };
      },
    });
  }, [hostId, active]);
  const runtime = { hosts, paseo: apis[hostId], async rpc(name, input) {
    if (name === "slotgame.agent.unarchive" || name === "slotgame.agent.reload") {
      calls.push({ kind: "lifecycle", name, input });
      const targetHost = input.currentHost ? hostId : input.serverId;
      if (!input.currentHost && (!input.target || input.password !== " secret ")) throw new Error("PASSWORD_REQUIRED: 目标是远程设备，尚未配置连接密码与地址");
      const row = rows[targetHost]?.find(row => row.id === input.agentId);
      if (!row) throw new Error("Agent not found");
      emit(targetHost, { ...row, archivedAt: null, status: "idle", attentionReason: "finished" });
      return { agentId: row.id, unarchived: true, hostId: targetHost };
    }
    if (name !== "slotgame.agent.activity") throw new Error("Unexpected RPC " + name);
    calls.push({ kind: "hook-rpc", hostId });
    const agents = [...rows.a.map(row => remote("a", row)), ...rows.b.map(row => remote("b", { ...row, status: "running", attentionReason: null }))];
    if (rpcGate) {
      rpcGate = null;
      agents.push(remote("ghost", native("stale-ghost", { status: "idle", attentionReason: "finished" })));
      await new Promise(resolve => { globalThis.__agentsSync.releaseRpc = resolve; });
    }
    return { agents, hosts: [], fetchedAt: new Date().toISOString() };
  } };
  const Icon = pill?.button.icon;
  const Content = pill?.button.behavior.Content;
  return <QueryClientProvider client={queries}><Runtime.Provider value={runtime}>
    <div style={{ background: theme.colors.surface0, color: theme.colors.foreground, minHeight: "100vh", padding: 16 }}>
      {active && pill ? <>
        <button data-testid="agents-pill" onClick={() => setOpen(!open)} style={{ background: theme.colors.surface1, color: theme.colors.foreground, border: "1px solid " + theme.colors.border, borderRadius: 20, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon {...props} size={16} color={theme.colors.foreground} /><span data-testid="agents-pill-label">{pill.button.label}</span>
        </button>
        {open ? <div data-testid="agents-popover" style={{ width: innerWidth < 600 ? 330 : 400, marginTop: 12 }}><Content {...props} close={() => setOpen(false)} /></div> : null}
      </> : null}
    </div>
  </Runtime.Provider></QueryClientProvider>;
}
createRoot(document.getElementById("root")).render(<App />);
