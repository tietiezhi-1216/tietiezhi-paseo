import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetch as httpFetch, EnvHttpProxyAgent } from "undici";

const run = promisify(execFile);
let environment: Promise<NodeJS.ProcessEnv> | undefined;
let agent: EnvHttpProxyAgent | undefined;
export function systemProxyEnvironment(text: string, original: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...original };
  const value = (key: string) => new RegExp("^\\s*" + key + "\\s*:\\s*(.*?)\\s*$", "m").exec(text)?.[1];
  for (const [prefix, upper, lower] of [["HTTPS", "HTTPS_PROXY", "https_proxy"], ["HTTP", "HTTP_PROXY", "http_proxy"]]) {
    if (env[upper] || env[lower] || value(prefix + "Enable") !== "1") continue;
    const host = value(prefix + "Proxy"), port = Number(value(prefix + "Port"));
    if (host && /^[a-zA-Z0-9.:-]+$/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535)
      env[upper] = "http://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + port;
  }
  return env;
}
export function releaseEnvironment(): Promise<NodeJS.ProcessEnv> {
  return environment ??= (async () => {
    if (process.platform !== "darwin") return { ...process.env };
    try {
      const { stdout } = await run("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 2000 });
      return systemProxyEnvironment(stdout, process.env);
    } catch { return { ...process.env }; }
  })();
}
export async function releaseFetch(url: string, init: Parameters<typeof httpFetch>[1]) {
  init?.signal?.throwIfAborted();
  const env = await releaseEnvironment();
  init?.signal?.throwIfAborted();
  agent ??= new EnvHttpProxyAgent({ httpProxy: env.HTTP_PROXY || env.http_proxy,
    httpsProxy: env.HTTPS_PROXY || env.https_proxy, noProxy: env.NO_PROXY || env.no_proxy });
  return httpFetch(url, { ...init, dispatcher: agent });
}
export async function closeReleaseHttp() { await agent?.close(); agent = undefined; }
