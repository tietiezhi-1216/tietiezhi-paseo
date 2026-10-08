import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createPaseoApi, type PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { AgentHostSchema, isListedAgent, parentAgentIdFromLabels, resolveHostServerId, resolveReloadHost } from "../shared/agents.ts";

const AGENT_CACHE_MS = 15_000;
const AGENT_CONFIG_PATHS = [
  process.env.SLOTGAME_DEVICES_CONFIG,
  process.env.SLOTGAME_AGENTS_DEVICES_CONFIG,
  process.env.TIETIEZHI_DEVICES_CONFIG,
  join(homedir(), ".paseo", "slotgame-agents-devices.json"),
  join(homedir(), ".paseo", "tietiezhi-devices.json"),
  join(homedir(), ".paseo", "slotgame-release-devices.json"),
  join(process.cwd(), "devices.local.json"),
].filter((value): value is string => Boolean(value));
const AGENT_CLIENT_PREFIX = `tietiezhi-agent-activity-${process.pid}-${Math.random().toString(36).slice(2)}`;
const REMOTE_CLIENT_CONNECT_TIMEOUT_MS = 5_000;

type RemoteAgentResult = {
  hostId: string;
  hostName: string;
  serverId: string | null;
  id: string;
  name: string;
  status: "initializing" | "idle" | "running" | "error" | "closed" | "offline";
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastUserMessageAt: string | null;
  workspaceId: string | null;
  workspace: string | null;
  archivedAt: string | null;
  parentAgentId: string | null;
};
type RemoteAgentClientEntry = { signature: string; daemon: DaemonClient; client: PaseoApi };

let agentCache: { at: number; value: Awaited<ReturnType<typeof readRemoteAgents>> } | null = null;
let agentInFlight: Promise<Awaited<ReturnType<typeof readRemoteAgents>>> | null = null;
const lastAgentsByHost = new Map<string, { agents: RemoteAgentResult[]; serverId: string | null }>();
const remoteAgentClients = new Map<string, RemoteAgentClientEntry>();

function configuredAgentHosts() {
  const configPath = AGENT_CONFIG_PATHS.find((path) => existsSync(path));
  if (!configPath) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    return Array.isArray(parsed) ? parsed.map((item) => AgentHostSchema.parse(item)) : [];
  } catch {
    return [];
  }
}

function targetUrl(target: string): string {
  if (target.startsWith("ws://") || target.startsWith("wss://")) return target.endsWith("/ws") ? target : `${target}/ws`;
  if (target.startsWith("tcp://")) return `ws://${target.slice("tcp://".length).replace(/\/$/, "")}/ws`;
  return `ws://${target.replace(/\/$/, "")}/ws`;
}

function remoteHostSignature(host: ReturnType<typeof configuredAgentHosts>[number]): string {
  return `${host.target}\u0000${host.password}`;
}

function createRemoteAgentClient(host: ReturnType<typeof configuredAgentHosts>[number]): RemoteAgentClientEntry {
  const daemon = new DaemonClient({
    url: targetUrl(host.target),
    password: host.password,
    clientId: `${AGENT_CLIENT_PREFIX}-${host.id}`,
    clientType: "cli",
    appVersion: "0.8.0",
    connectTimeoutMs: REMOTE_CLIENT_CONNECT_TIMEOUT_MS,
    reconnect: { enabled: false },
  });
  return { signature: remoteHostSignature(host), daemon, client: createPaseoApi(daemon) };
}

async function closeRemoteAgentClient(hostId: string, entry: RemoteAgentClientEntry): Promise<void> {
  if (remoteAgentClients.get(hostId) === entry) remoteAgentClients.delete(hostId);
  await entry.daemon.close().catch(() => {});
}

async function ensureRemoteAgentClient(host: ReturnType<typeof configuredAgentHosts>[number]): Promise<RemoteAgentClientEntry> {
  const signature = remoteHostSignature(host);
  let entry = remoteAgentClients.get(host.id);
  if (entry && entry.signature !== signature) {
    await closeRemoteAgentClient(host.id, entry);
    entry = undefined;
  }
  if (!entry || entry.daemon.getConnectionState().status === "disposed") {
    entry = createRemoteAgentClient(host);
    remoteAgentClients.set(host.id, entry);
  }
  try {
    const connecting = entry.daemon.connect();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("REMOTE_HOST_TIMEOUT")), REMOTE_CLIENT_CONNECT_TIMEOUT_MS);
    });
    try {
      await Promise.race([connecting, timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    return entry;
  } catch (error) {
    await closeRemoteAgentClient(host.id, entry);
    throw error;
  }
}

async function readRemoteAgents() {
  const hosts = configuredAgentHosts();
  const configuredHostIds = new Set(hosts.map((host) => host.id));
  await Promise.all(
    [...remoteAgentClients.entries()]
      .filter(([hostId]) => !configuredHostIds.has(hostId))
      .map(([hostId, entry]) => closeRemoteAgentClient(hostId, entry)),
  );
  const results = await Promise.all(hosts.map(async (host) => {
    let entry: RemoteAgentClientEntry | null = null;
    try {
      entry = await ensureRemoteAgentClient(host);
      const serverId = resolveHostServerId(entry.daemon.getLastServerInfoMessage()?.serverId, host.serverId);
      const listed = await entry.client.agents.list({ scope: "active", filter: { includeArchived: false } });
      const agents = listed.entries.map(({ agent, project }) => ({
        hostId: host.id,
        hostName: host.name,
        serverId,
        id: agent.id,
        name: agent.title ?? agent.id,
        status: agent.status,
        requiresAttention: agent.requiresAttention ?? false,
        attentionReason: agent.attentionReason ?? null,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        lastUserMessageAt: agent.lastUserMessageAt,
        workspaceId: agent.workspaceId ?? null,
        workspace: project.workspaceName ?? host.workspace ?? null,
        archivedAt: agent.archivedAt ?? null,
        parentAgentId: parentAgentIdFromLabels(agent.labels),
      } satisfies RemoteAgentResult)).filter(isListedAgent);
      lastAgentsByHost.set(host.id, { agents, serverId });
      return { agents, online: true, serverId };
    } catch {
      if (entry) await closeRemoteAgentClient(host.id, entry);
      const previous = lastAgentsByHost.get(host.id);
      return { agents: previous?.agents ?? [], online: false, serverId: previous?.serverId ?? null };
    }
  }));
  return {
    agents: results.flatMap((result) => result.agents),
    hosts: hosts.map((host, index) => ({
      id: host.id,
      name: host.name,
      serverId: results[index]?.serverId ?? null,
      online: results[index]?.online ?? false,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function reloadRemoteAgent(input: { hostId: string; serverId?: string | null; agentId: string }) {
  const hosts = configuredAgentHosts();
  const host = resolveReloadHost(hosts, input);
  if (!host) throw new Error("找不到这个 Agent 所在的局域网主机");
  const entry = await ensureRemoteAgentClient(host);
  await entry.client.agents.ref(input.agentId).refresh();
  agentCache = null;
  return { agentId: input.agentId, hostId: host.id };
}

export async function closeRemoteAgentClients(): Promise<void> {
  const entries = [...remoteAgentClients.entries()];
  remoteAgentClients.clear();
  await Promise.all(entries.map(([, entry]) => entry.daemon.close().catch(() => {})));
}

export async function handleAgentActivity(input: { refresh?: boolean } = {}) {
  if (!input.refresh && agentCache && Date.now() - agentCache.at < AGENT_CACHE_MS) return agentCache.value;
  if (agentInFlight) return agentInFlight;
  agentInFlight = readRemoteAgents().then((value) => {
    agentCache = { at: Date.now(), value };
    return value;
  }).finally(() => {
    agentInFlight = null;
  });
  if (agentCache) return agentCache.value;
  return agentInFlight;
}
