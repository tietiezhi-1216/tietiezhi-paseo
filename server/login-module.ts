import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const OAUTH_FILE = { codex: "openai-codex.js", xai: "xai.js" } as const;
export type OAuthLoginFamily = keyof typeof OAUTH_FILE;

function oauthFile(packageRoot: string, family: OAuthLoginFamily): string | undefined {
  const file = join(packageRoot, "dist", "auth", "oauth", OAUTH_FILE[family]);
  return existsSync(file) ? file : undefined;
}

function fromRequireBase(base: string, family: OAuthLoginFamily): string | undefined {
  try {
    const root = dirname(createRequire(base).resolve("@earendil-works/pi-ai/package.json"));
    return oauthFile(root, family);
  } catch {
    return undefined;
  }
}

/** Paseo compiles plugin servers to CJS, where import.meta is an empty object. */
export async function resolveLoginModulePath(family: OAuthLoginFamily, options: {
  moduleUrl?: string;
  pluginDirectory?: string;
  home?: string;
} = {}): Promise<string> {
  const moduleUrl = options.moduleUrl ?? (typeof import.meta.url === "string" ? import.meta.url : undefined);
  if (moduleUrl?.startsWith("file:")) {
    const found = fromRequireBase(moduleUrl, family);
    if (found) return found;
  }
  const directories = new Set<string>();
  if (options.pluginDirectory) directories.add(options.pluginDirectory);
  if (options.pluginDirectory === undefined) {
    const home = options.home ?? process.env.PASEO_HOME ?? join(homedir(), ".paseo");
    try {
      const raw = await readFile(join(home, "config.json"), "utf8");
      if (raw.length <= 1_000_000) {
        const path = (JSON.parse(raw) as { plugins?: { tietiezhi?: { path?: unknown } } }).plugins?.tietiezhi?.path;
        if (typeof path === "string" && path.length > 0 && path.length < 1000) directories.add(path);
      }
    } catch { /* Installed path is optional when module resolution already succeeded. */ }
  }
  for (const directory of directories) {
    const found = oauthFile(join(directory, "node_modules", "@earendil-works", "pi-ai"), family)
      ?? fromRequireBase(join(directory, "package.json"), family);
    if (found) return found;
  }
  throw new Error("缺少登录依赖");
}
