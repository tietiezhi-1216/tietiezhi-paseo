import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPaseoApi, type PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { AgentHostSchema, isListedAgent, isDisplayableAgent, parentAgentIdFromLabels, resolveHostServerId, resolveReloadHost } from "../shared/agents.ts";

const AGENT_CACHE_MS = 15_000;
const DAEMON_HOME = process.env.PASEO_HOME || join(homedir(), ".paseo");
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
  if (target.startsWith("http://")) return `ws://${target.slice("http://".length).replace(/\/$/, "")}/ws`;
  if (target.startsWith("https://")) return `wss://${target.slice("https://".length).replace(/\/$/, "")}/ws`;
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
      const listed = await entry.client.agents.list({ filter: { includeArchived: true } });
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
      } satisfies RemoteAgentResult)).filter(isDisplayableAgent);
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

function getLocalCredential(): string | undefined {
  try {
    const credPath = join(DAEMON_HOME, "local-credential");
    if (existsSync(credPath)) {
      const token = readFileSync(credPath, "utf8").trim();
      if (token) return token;
    }
  } catch {}
  return undefined;
}

export function saveAgentHostConfig(hostUpdate: {
  id: string;
  name?: string;
  target?: string;
  password?: string;
  serverId?: string | null;
  workspace?: string;
}) {
  const primaryPath = join(homedir(), ".paseo", "tietiezhi-devices.json");
  const configPath = AGENT_CONFIG_PATHS.find((path) => existsSync(path)) ?? primaryPath;
  let hosts: Array<ReturnType<typeof configuredAgentHosts>[number]> = [];
  if (existsSync(configPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
      if (Array.isArray(parsed)) {
        hosts = parsed.map((item) => AgentHostSchema.parse(item));
      }
    } catch {}
  }
  const index = hosts.findIndex((h) => h.id === hostUpdate.id || (hostUpdate.serverId && h.serverId === hostUpdate.serverId));
  if (index >= 0) {
    hosts[index] = {
      ...hosts[index],
      ...(hostUpdate.name ? { name: hostUpdate.name } : {}),
      ...(hostUpdate.target ? { target: hostUpdate.target } : {}),
      ...(hostUpdate.password !== undefined ? { password: hostUpdate.password } : {}),
      ...(hostUpdate.serverId ? { serverId: hostUpdate.serverId } : {}),
      ...(hostUpdate.workspace ? { workspace: hostUpdate.workspace } : {}),
    };
  } else if (hostUpdate.target) {
    hosts.push({
      id: hostUpdate.id || hostUpdate.serverId || `host-${Date.now()}`,
      name: hostUpdate.name || hostUpdate.id || "Remote Host",
      target: hostUpdate.target,
      password: hostUpdate.password ?? "",
      serverId: hostUpdate.serverId || undefined,
      workspace: hostUpdate.workspace,
    });
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(hosts, null, 2), "utf8");
}

function getLocalDaemonUrl(): string {
  try {
    const configPath = join(DAEMON_HOME, "config.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf8"));
      const listen = parsed?.daemon?.listen;
      if (typeof listen === "string" && listen.trim()) {
        return targetUrl(listen.trim());
      }
    }
  } catch {}
  return "ws://127.0.0.1:6767/ws";
}

export function localDaemonAuth(password?: string, credential?: string) {
  // DaemonClient prioritizes localCredential over password. An explicit retry
  // must use the supplied password, not the same potentially stale token.
  return {
    password: password || undefined,
    localCredential: !password && credential ? () => credential : undefined,
  };
}

export function reloadConnectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("PASSWORD_REQUIRED:")) return error instanceof Error ? error : new Error(message);
  if (/password|incorrect/i.test(message) || (error as any)?.name === "DaemonAuthenticationError") {
    return new Error("PASSWORD_REQUIRED: 本机 Daemon 需要连接凭据或密码");
  }
  return error instanceof Error ? error : new Error(message);
}

async function getLocalDaemonClient(password?: string): Promise<DaemonClient> {
  const localCred = getLocalCredential();
  const daemon = new DaemonClient({
    url: getLocalDaemonUrl(),
    ...localDaemonAuth(password, localCred),
    clientId: `${AGENT_CLIENT_PREFIX}-local`,
    clientType: "cli",
    connectTimeoutMs: REMOTE_CLIENT_CONNECT_TIMEOUT_MS,
    reconnect: { enabled: false },
  });
  try {
    await daemon.connect();
    return daemon;
  } catch (error) {
    await daemon.close().catch(() => {});
    throw error;
  }
}

const execFileAsync = promisify(execFile);

export async function reloadViaLocalCli(
  agentId: string,
  execute: (file: string, args: string[], options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string }> = execFileAsync,
) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(agentId)) throw new Error("无效的 Agent ID");
  // Use the native local-home resolver (live daemon endpoint / IPC / credentials),
  // not the plugin's guessed config.json listen address. Never pass --host.
  const env = { ...process.env };
  delete env.PASEO_PASSWORD;
  const { stdout } = await execute("paseo", ["agent", "reload", agentId, "--home", DAEMON_HOME, "--json"], {
    timeout: 60_000, maxBuffer: 512_000, env,
  });
  const result = JSON.parse(stdout);
  const data = result.data ?? result;
  if (data.agentId !== agentId || data.status !== "reloaded") {
    throw new Error("Paseo 未确认当前 Agent 已重载");
  }
  return data;
}

export async function reloadCurrentHostAgent(
  agentId: string,
  paseo: Pick<PaseoApi, "agents">,
  connect: () => Promise<{ refreshAgent(id: string): Promise<unknown>; close(): Promise<void> }> = async () => ({
    refreshAgent: (id) => reloadViaLocalCli(id),
    close: async () => {},
  }),
) {
  // The handler's SDK is bound to the daemon hosting this plugin, not an App
  // connection id. Verify ownership before invoking the real runtime restart.
  let phase = "验证当前设备 Agent";
  let daemon: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    if (!await paseo.agents.ref(agentId).refresh()) {
      throw new Error("当前设备不存在此 Agent，未执行重载");
    }
    phase = "连接当前设备 Daemon";
    daemon = await connect();
    phase = "重启 Agent 运行时";
    await daemon.refreshAgent(agentId);
    agentCache = null;
    return { agentId, hostId: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authentication = /password|incorrect|authentication/i.test(message);
    // Report phase and device, never credential contents or unfiltered errors.
    console.error("[tietiezhi reload]", { phase, device: hostname(), authentication, daemonHome: DAEMON_HOME, credentialPresent: Boolean(getLocalCredential()) });
    if (authentication) {
      throw new Error(`${phase}失败（设备：${hostname()}）：认证被拒绝；请检查该设备的 Daemon 凭据，不是模型账号密码`);
    }
    throw error;
  } finally {
    if (daemon) await daemon.close().catch(() => {});
  }
}

export async function reloadRemoteAgent(input: {
  currentHost?: boolean;
  hostId?: string;
  serverId?: string | null;
  agentId: string;
  password?: string;
  target?: string;
  savePassword?: boolean;
}, paseo?: PaseoApi) {
  if (input.currentHost) {
    if (!paseo || input.target || input.serverId || input.hostId || input.password !== undefined) {
      throw new Error("当前设备重载不能混用远程连接参数");
    }
    return reloadCurrentHostAgent(input.agentId, paseo);
  }
  const hosts = configuredAgentHosts();
  let host = resolveReloadHost(hosts, input);

  if (!host && input.target) {
    host = {
      id: input.hostId || input.serverId || "custom-host",
      name: input.hostId || "Remote Host",
      target: input.target,
      password: input.password ?? "",
      serverId: input.serverId ?? undefined,
    };
  } else if (host && (input.password !== undefined || input.target)) {
    host = { ...host, password: input.password ?? host.password, target: input.target || host.target };
  }

  if (host) {
    try {
      const entry = await ensureRemoteAgentClient(host);
      await entry.daemon.refreshAgent(input.agentId);
      agentCache = null;
      if (input.password !== undefined && input.savePassword !== false) {
        saveAgentHostConfig(host);
      }
      return { agentId: input.agentId, hostId: host.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/password|incorrect/i.test(msg) || (err as any)?.name === "DaemonAuthenticationError") {
        throw new Error("PASSWORD_REQUIRED: 目标主机需要密码或连接密码错误");
      }
      throw err;
    }
  }

  if (input.hostId || input.serverId) throw new Error("PASSWORD_REQUIRED: 目标是远程设备，尚未配置连接密码与地址");
  let daemon: DaemonClient | null = null;
  try {
    daemon = await getLocalDaemonClient(input.password);
    if (input.serverId && input.serverId !== daemon.getLastServerInfoMessage()?.serverId) {
      throw new Error("PASSWORD_REQUIRED: 目标是远程设备，尚未配置连接密码与地址");
    }
    await daemon.refreshAgent(input.agentId);
  } catch (err: unknown) {
    throw reloadConnectionError(err);
  } finally {
    if (daemon) await daemon.close().catch(() => {});
  }
  agentCache = null;
  return { agentId: input.agentId, hostId: "" };
}

type AgentLifecycleInput = Parameters<typeof reloadRemoteAgent>[0];
export async function archiveRemoteAgent(input: AgentLifecycleInput, localPaseo?: PaseoApi) {
  if (input.currentHost) {
    if (!localPaseo || input.hostId || input.serverId || input.target || input.password !== undefined) throw new Error("当前设备归档不能混用远程连接参数");
    await localPaseo.agents.ref(input.agentId).archive();
  } else {
    let host = resolveReloadHost(configuredAgentHosts(), input);
    if (!host && input.target) host = { id: input.hostId || input.serverId || "custom-host", name: input.hostId || "Remote Host", target: input.target, password: input.password ?? "", serverId: input.serverId ?? undefined };
    else if (host && (input.password !== undefined || input.target)) host = { ...host, password: input.password ?? host.password, target: input.target || host.target };
    if (!host) throw new Error("PASSWORD_REQUIRED: 目标是远程设备，尚未配置连接密码与地址");
    try {
      const entry = await ensureRemoteAgentClient(host);
      await entry.client.agents.ref(input.agentId).archive();
      if (input.password !== undefined && input.savePassword !== false) saveAgentHostConfig(host);
    } catch (error) { throw reloadConnectionError(error); }
  }
  agentCache = null;
  return { agentId: input.agentId, archived: true };
}

export async function unarchiveRemoteAgent(input: AgentLifecycleInput, localPaseo?: PaseoApi) {
  // Runtime reload is the native restoration operation. Metadata ref.refresh()
  // alone does not unarchive. Keep scope and credentials identical to reload.
  await reloadRemoteAgent(input, localPaseo);
  return { agentId: input.agentId, unarchived: true };
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
