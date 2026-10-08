import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { defaultAccountPaths } from "./accounts.ts";
import { PiPackageSource } from "../shared/pi-manager.ts";

const execute = promisify(execFile);
export function npmPackageName(source: string): string {
  PiPackageSource.parse(source);
  const value = source.slice(4);
  const versionAt = value.lastIndexOf("@");
  return versionAt > 0 ? value.slice(0, versionAt) : value;
}

export class PiManager {
  private busy = false;
  private readonly directory: () => string;
  private readonly run: typeof execute;
  constructor(directory = () => dirname(defaultAccountPaths().auth), run: typeof execute = execute) {
    this.directory = directory;
    this.run = run;
  }
  private async settings() {
    const dir = this.directory();
    let raw: string;
    try { raw = await readFile(join(dir, "settings.json"), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("无法读取目标设备 Pi 设置");
      raw = "{}";
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error("Pi 设置 JSON 损坏，操作已停止"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pi 设置格式错误");
    return { dir, parsed, revision: createHash("sha256").update(raw).digest("hex") };
  }
  async inventory(signal?: AbortSignal) {
    const { dir, parsed, revision } = await this.settings();
    let version = "未找到 Pi";
    try {
      const result = await this.run("pi", ["--version"], { cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: dir }, timeout: 15_000, maxBuffer: 512_000, signal });
      version = result.stdout.trim().slice(0, 160);
    } catch { signal?.throwIfAborted(); }
    const packages = await Promise.all((Array.isArray(parsed.packages) ? parsed.packages : []).map(async (entry: unknown) => {
      const source = typeof entry === "string" ? entry : (entry as { source?: string })?.source;
      if (typeof source !== "string") return null;
      const managed = PiPackageSource.safeParse(source).success;
      const name = managed ? npmPackageName(source) : source;
      let installedVersion: string | null = null;
      if (managed) {
        try {
          const manifest = JSON.parse(await readFile(join(dir, "npm", "node_modules", name, "package.json"), "utf8"));
          if (typeof manifest.version === "string") installedVersion = manifest.version;
        } catch { /* Not installed or unavailable: never invent a version. */ }
      }
      return { source, name, version: installedVersion, managed };
    }));
    let localExtensions: string[] = [];
    try { localExtensions = await readdir(join(dir, "extensions")); } catch { /* optional */ }
    return { version, revision, packages: packages.filter((entry): entry is NonNullable<typeof entry> => entry !== null), localExtensions };
  }
  async change(input: { operation: "install" | "remove" | "update"; source: string; revision: string; confirmed: true }, signal?: AbortSignal) {
    PiPackageSource.parse(input.source);
    if (input.confirmed !== true) throw new Error("需要确认操作");
    if (this.busy) throw new Error("目标设备已有插件操作正在执行，请稍后刷新");
    this.busy = true;
    try {
      const before = await this.inventory(signal);
      if (before.revision !== input.revision) throw new Error("Pi 配置已变更，请刷新后重新确认");
      if (input.operation !== "install" && !before.packages.some((entry) => entry.source === input.source)) throw new Error("包已不在安装列表中，请刷新");
      const dir = this.directory();
      try {
        await this.run("pi", [input.operation, input.source, "--no-approve"], {
          cwd: dir, env: { ...process.env, PI_CODING_AGENT_DIR: dir },
          timeout: 90_000, maxBuffer: 1_000_000, signal,
        });
      } catch {
        signal?.throwIfAborted();
        throw new Error("Pi 命令失败或超时；可能已发生部分修改，请刷新核对，不要重复提交");
      }
      return { inventory: await this.inventory(signal), notice: "操作完成。已有 Pi 会话需要空闲后重载才能应用插件变更。" };
    } finally { this.busy = false; }
  }
}
