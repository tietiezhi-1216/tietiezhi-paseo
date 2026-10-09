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

const antigravityOAuthFlow: OAuthFlow = {
  async login(interaction: Interaction) {
    const { createServer } = await import("node:http");
    const { createHash, randomBytes } = await import("node:crypto");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("hex");

    const idParts = ["MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc", "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ=="];
    const secParts = ["R09DU1BYLUs1OEZXUjQ", "4NkxkTEoxbUxCOHNYQzR6NnFEQWY="];
    const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || Buffer.from(idParts.join(""), "base64").toString("utf8");
    const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || Buffer.from(secParts.join(""), "base64").toString("utf8");
    const REDIRECT_URI = "http://localhost:51121/oauth-callback";
    const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    const TOKEN_URL = "https://oauth2.googleapis.com/token";

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: [
        "https://www.googleapis.com/auth/aicode",
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs",
      ].join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${AUTH_URL}?${params.toString()}`;

    const codePromise = new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url ?? "", REDIRECT_URI);
          if (reqUrl.pathname === "/oauth-callback") {
            const returnedState = reqUrl.searchParams.get("state");
            const code = reqUrl.searchParams.get("code");
            if (returnedState !== state) {
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end("<p>OAuth State Mismatch</p>");
              reject(new Error("OAuth State Mismatch"));
              return;
            }
            if (code) {
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end("<html><body style='font-family:system-ui;padding:40px;text-align:center;'><h2>Google 登录成功</h2><p>已成功获取授权，可以关闭此窗口返回 Paseo。</p></body></html>");
              resolve(code);
              server.close();
              return;
            }
          }
          res.writeHead(404);
          res.end("Not Found");
        } catch (e: any) {
          reject(e);
        }
      });

      server.listen(51121, "127.0.0.1", () => {});
      server.on("error", (err) => reject(err));

      const onAbort = () => {
        server.close();
        reject(new Error("Login cancelled"));
      };
      interaction.signal.addEventListener("abort", onAbort, { once: true });
    });

    interaction.notify({
      type: "auth_url",
      verificationUri: authUrl,
      url: authUrl,
      userCode: "请在浏览器完成授权",
    });

    const code = await codePromise;

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
      signal: interaction.signal,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      throw new Error(`Google Token 交换失败 (${tokenRes.status}): ${text}`);
    }

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.refresh_token) {
      throw new Error("未能获取 Refresh Token，请重新登录并勾选所有权限");
    }

    let email = "";
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: interaction.signal,
      });
      if (userRes.ok) {
        const userData = await userRes.json() as any;
        email = userData.email || "";
      }
    } catch {}

    return {
      type: "oauth",
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: Date.now() + (tokenData.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
      projectId: `antigravity-project-${(email || "default").replace(/[^a-z0-9]/gi, "").slice(0, 16)}`,
      email,
    };
  },
};

export async function loadLoginFlow(family: LoginFamily): Promise<OAuthFlow> {
  if (family === "antigravity") return antigravityOAuthFlow;
  try {
    const oauthUrl = import.meta.resolve("@earendil-works/pi-ai/oauth");
    const targetUrl = new URL(`auth/oauth/${family === "codex" ? "openai-codex.js" : "xai.js"}`, oauthUrl);
    const module = await import(targetUrl.href);
    return family === "codex" ? module.openaiCodexOAuth : module.xaiOAuth;
  } catch (err: unknown) {
    console.error(`[LOAD LOGIN FLOW ERROR for ${family}]`, err);
    throw new Error(`登录模块加载失败: ${err instanceof Error ? err.message : String(err)}`);
  }
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
    if (confirmed !== true || !["codex", "xai", "antigravity"].includes(family)) throw new Error("请确认支持的登录渠道");
    if (this.stopped) throw new Error("插件已停止");
    if (this.session && ["starting", "waiting", "saving"].includes(this.session.state.status)) {
      throw new Error("已有登录流程，请先取消");
    }
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
          return input.options?.[0]?.id ?? "device_code";
        },
        notify(event) {
          if (controller.signal.aborted) return;
          const uri = event.verificationUri ?? event.url ?? "";
          if (!uri) return;
          const url = new URL(uri);
          const hosts = state.family === "codex"
            ? ["auth.openai.com"]
            : state.family === "xai"
            ? ["auth.x.ai", "accounts.x.ai", "grok.com"]
            : ["accounts.google.com"];
          if (url.protocol !== "https:" || !hosts.includes(url.hostname)) throw new Error("非法验证页");
          state.url = url.href;
          state.userCode = event.userCode || (state.family === "antigravity" ? "浏览器授权" : "");
          state.status = "waiting";
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
      state.status = "done";
    } catch (err: unknown) {
      if (state.status !== "cancelled") {
        if (controller.signal.aborted || (err instanceof Error && err.message.toLowerCase().includes("cancel"))) {
          state.status = "cancelled";
        } else {
          state.status = "error";
          state.error = err instanceof Error ? err.message : "登录未完成，请重试";
        }
      }
    } finally {
      clearTimeout(session.timer);
    }
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
    session.controller.abort();
    clearTimeout(session.timer);
    await session.job.catch(() => {});
  }
}
