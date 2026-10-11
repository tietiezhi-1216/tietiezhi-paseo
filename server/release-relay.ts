import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { releaseEnvironment } from "./release-http.ts";

export function releaseWakeEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; event?: { kind?: unknown } };
  const kind = String(message.event?.kind ?? "").toLowerCase();
  return message.type === "state" || message.type === "github_event" && !["workflow_job", "check_run"].includes(kind);
}
// One connection/reconnect timer per plugin instance, never sent to the client.
export function createReleaseRelay(changed: () => void, overrides: {
  loadUrl?: () => Promise<string | undefined>;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  open?: (url: string, proxy?: string) => WebSocket;
} = {}) {
  let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stopped = true, generation = 0, attempt = 0, awaitingPong = false;
  async function configuration() {
    for (const path of [join(homedir(), "Library/Application Support/GitHub118/relay.json"), join(homedir(), ".paseo/slotgame-release-relay.json")]) {
      try {
        const config = JSON.parse(await readFile(path, "utf8"));
        const url = new URL(config.url);
        if (!["ws:", "wss:"].includes(url.protocol) || typeof config.token !== "string" || !config.token) continue;
        if (!url.searchParams.has("token")) url.searchParams.set("token", config.token);
        return url.toString();
      } catch { /* Optional trusted local configuration. Never log it. */ }
    }
  }
  function disconnected(source: WebSocket) {
    if (source !== socket) return;
    socket = undefined;
    clearInterval(heartbeat); heartbeat = undefined;
    source.removeAllListeners(); source.on("error", () => {}); source.terminate();
    if (!stopped && !retry) retry = setTimeout(() => { retry = undefined; void connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(++attempt, 5)));
  }
  async function connect() {
    const current = generation;
    const url = await (overrides.loadUrl ?? configuration)();
    const env = await (overrides.environment ?? releaseEnvironment)();
    if (stopped || current !== generation || socket) return;
    if (!url) { retry = setTimeout(() => { retry = undefined; void connect(); }, 60_000); return; }
    const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
    let source: WebSocket;
    try { source = overrides.open ? overrides.open(url, proxy) : new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 1024 * 1024, ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}) }); }
    catch { if (!stopped && !retry) retry = setTimeout(() => { retry = undefined; void connect(); }, 30_000); return; }
    socket = source;
    source.on("open", () => {
      if (source !== socket || stopped) return;
      attempt = 0; awaitingPong = false; changed();
      heartbeat = setInterval(() => {
        if (source !== socket) return;
        if (awaitingPong) { disconnected(source); return; }
        awaitingPong = true; source.ping();
      }, 25_000);
    });
    source.on("pong", () => { if (source === socket) awaitingPong = false; });
    source.on("message", data => {
      if (stopped || source !== socket) return;
      try {
        const event = JSON.parse(data.toString());
        if (releaseWakeEvent(event)) changed();
      } catch { /* Not a supported wake event. */ }
    });
    source.on("error", () => disconnected(source));
    source.on("close", () => disconnected(source));
  }
  return {
    start() { if (!stopped) return; stopped = false; generation++; void connect(); },
    connected: () => socket?.readyState === WebSocket.OPEN,
    stop() { stopped = true; generation++; clearTimeout(retry); retry = undefined; clearInterval(heartbeat); heartbeat = undefined; if (socket) disconnected(socket); },
  };
}
