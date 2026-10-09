import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fetch as undiciFetch, ProxyAgent } from "undici";

export type Fetcher = typeof fetch;

// Never pass an undici 8 dispatcher to the daemon's built-in undici 7 fetch.
// The request implementation and dispatcher must come from the same package.
export const quotaFetch: Fetcher = (url, init) =>
  undiciFetch(url as Parameters<typeof undiciFetch>[0], init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;

type Env = Record<string, string | undefined>;
export function resolveQuotaProxy(env: Env, configured: Env = {}): string | null {
  for (const source of [env, configured]) {
    const proxy = source.HTTPS_PROXY || source.https_proxy || source.HTTP_PROXY || source.http_proxy;
    if (proxy) return proxy;
    if (source.PROXY_HOST && source.PROXY_PORT) return `http://${source.PROXY_HOST}:${source.PROXY_PORT}`;
  }
  // Compatibility with existing installations; a missing local proxy falls back to direct.
  return "http://127.0.0.1:12334";
}

function configuredPiEnv(): Env {
  try {
    const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    return config?.agents?.providers?.pi?.env ?? {};
  } catch { return {}; }
}

const dispatchers = new Map<string, ProxyAgent>();
function dispatcher() {
  const proxy = resolveQuotaProxy(process.env, configuredPiEnv());
  if (!proxy) return undefined;
  let agent = dispatchers.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    dispatchers.set(proxy, agent);
  }
  return agent;
}

export async function fetchWithQuotaProxy(fetcher: Fetcher, url: string, init: RequestInit): Promise<Response> {
  init.signal?.throwIfAborted();
  const proxy = dispatcher();
  if (!proxy) return fetcher(url, init);
  try {
    return await fetcher(url, { ...init, dispatcher: proxy } as RequestInit);
  } catch (error) {
    // Abort is not a network-route failure. Do not retry a cancelled request.
    if (init.signal?.aborted) throw error;
    return fetcher(url, init);
  }
}

export async function closeQuotaHttp(): Promise<void> {
  const agents = [...dispatchers.values()];
  dispatchers.clear();
  await Promise.all(agents.map((agent) => agent.destroy()));
}
