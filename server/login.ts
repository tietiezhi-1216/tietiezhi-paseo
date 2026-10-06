import { randomUUID } from "node:crypto";
import { findPackageJSON } from "node:module";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { AccountService, defaultAccountPaths } from "./accounts.ts";
import type { LoginFamily, LoginState } from "../shared/login.ts";

type Interaction = {
  signal: AbortSignal;
  prompt(input: { type: string; options?: readonly { id: string }[] }): Promise<string>;
  notify(event: { type: string; verificationUri?: string; url?: string; userCode?: string }): void;
};
export type OAuthFlow = { login(interaction: Interaction): Promise<Record<string, unknown>> };
type Session = { state: LoginState; controller: AbortController; timer: ReturnType<typeof setTimeout>; job: Promise<void> };

export async function loadLoginFlow(family: LoginFamily): Promise<OAuthFlow> {
  let entry: string;
  try {
    const manifest = findPackageJSON("@earendil-works/pi-ai", import.meta.url);
    if (!manifest) throw new Error("缺少登录依赖");
    entry = join(dirname(manifest), "dist", "oauth.js");
  }
  catch {
    // Subprocess code is bundled outside the installation; resolve from its declared package.
    const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    const directory = config.plugins?.tietiezhi?.path;
    if (typeof directory !== "string") throw new Error("登录模块不可用");
    entry = join(directory, "node_modules", "@earendil-works", "pi-ai", "dist", "oauth.js");
  }
  const file = join(dirname(entry), "auth", "oauth", family === "codex" ? "openai-codex.js" : "xai.js");
  const module = await import(pathToFileURL(file).href);
  return family === "codex" ? module.openaiCodexOAuth : module.xaiOAuth;
}

export class LoginService {
  private session?: Session;
  private stopped = false;
  private readonly load: (family: LoginFamily) => Promise<OAuthFlow>;
  private readonly save?: (family: LoginFamily, credential: Record<string, unknown>, signal: AbortSignal) => Promise<void>;
  private readonly timeout: number;
  constructor(options: {
    load?: (family: LoginFamily) => Promise<OAuthFlow>;
    save?: (family: LoginFamily, credential: Record<string, unknown>, signal: AbortSignal) => Promise<void>;
    timeout?: number;
  } = {}) {
    this.load = options.load ?? loadLoginFlow;
    this.save = options.save;
    this.timeout = options.timeout ?? 15 * 60_000;
  }
  begin(family: LoginFamily, confirmed: true): LoginState {
    if (confirmed !== true || !["codex", "xai"].includes(family)) throw new Error("请确认支持的登录渠道");
    if (this.stopped) throw new Error("插件已停止");
    if (this.session && ["starting", "waiting", "saving"].includes(this.session.state.status)) throw new Error("已有登录流程，请先取消");
    const paths = this.save ? null : defaultAccountPaths();
    const controller = new AbortController();
    const state: LoginState = { id: randomUUID(), family, status: "starting", url: null, userCode: null, error: null };
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const session: Session = { state, controller, timer, job: Promise.resolve() };
    this.session = session;
    session.job = this.run(session, paths);
    return { ...state };
  }
  private async run(session: Session, paths: ReturnType<typeof defaultAccountPaths> | null): Promise<void> {
    const { state, controller } = session;
    try {
      const oauth = await this.load(state.family);
      if (controller.signal.aborted) throw new Error("取消登录");
      const credential = await oauth.login({
        signal: controller.signal,
        async prompt(input) {
          if (input.type === "select" && input.options?.some((option) => option.id === "device_code")) return "device_code";
          throw new Error("仅支持设备码登录");
        },
        notify(event) {
          if (controller.signal.aborted || event.type !== "device_code") return;
          const url = new URL(event.verificationUri ?? event.url ?? "");
          const hosts = state.family === "codex" ? ["auth.openai.com"] : ["auth.x.ai", "accounts.x.ai", "grok.com"];
          if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new Error("非法验证页");
          if (!event.userCode || event.userCode.length > 100) throw new Error("设备码无效");
          state.url = url.href; state.userCode = event.userCode; state.status = "waiting";
        },
      });
      if (controller.signal.aborted) throw new Error("取消登录");
      state.status = "saving";
      state.url = null; state.userCode = null;
      if (this.save) await this.save(state.family, credential, controller.signal);
      else {
        if (!paths || defaultAccountPaths().auth !== paths.auth || defaultAccountPaths().archive !== paths.archive) throw new Error("目标授权路径已变化");
        await new AccountService(paths).addLogin(state.family, credential, controller.signal);
      }
      // A committed archive remains successful even when cancellation races readback.
      state.status = "done";
    } catch {
      if (state.status !== "cancelled") {
        state.status = "error";
        state.error = controller.signal.aborted ? "登录已超时，请重试" : "登录未完成，请重试（Codex 需启用设备码授权）";
      }
    } finally { clearTimeout(session.timer); state.url = null; state.userCode = null; }
  }
  status(id: string): LoginState {
    if (this.stopped || !this.session || this.session.state.id !== id) throw new Error("登录会话已失效");
    return { ...this.session.state };
  }
  cancel(id: string): LoginState {
    const state = this.status(id);
    if (["starting", "waiting"].includes(state.status)) {
      this.session!.state.status = "cancelled";
      this.session!.controller.abort();
      this.session!.state.url = null; this.session!.state.userCode = null;
      clearTimeout(this.session!.timer);
    } else if (state.status === "saving") throw new Error("正在保存，请稍候");
    return { ...this.session!.state };
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    const session = this.session;
    if (!session) return;
    if (["starting", "waiting"].includes(session.state.status)) session.state.status = "cancelled";
    session.controller.abort();
    clearTimeout(session.timer);
    await session.job;
    session.state.url = null; session.state.userCode = null;
  }
}
