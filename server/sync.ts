import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { AccountService, defaultAccountPaths } from "./accounts.ts";
import { LIVE_SLOTS, type Family } from "../shared/accounts.ts";
import {
  SyncBundleSchema,
  type SyncAccountItem,
  type SyncBundle,
  type SyncExportInput,
  type SyncExportOutput,
  type SyncImportInput,
  type SyncImportOutput,
} from "../shared/sync.ts";

export function encryptPayload(data: string, password?: string): { encrypted: boolean; payload: string } {
  if (!password || !password.trim()) {
    return { encrypted: false, payload: Buffer.from(data, "utf8").toString("base64") };
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    alg: "aes-256-gcm",
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("base64"),
  };
  return { encrypted: true, payload: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64") };
}

export function decryptPayload(payloadBase64: string, password?: string): string {
  const raw = Buffer.from(payloadBase64, "base64").toString("utf8");
  let envelope: { alg?: string; salt?: string; iv?: string; tag?: string; ciphertext?: string } | null = null;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!envelope || envelope.alg !== "aes-256-gcm") {
    return raw;
  }
  if (!password || !password.trim()) {
    throw new Error("此备份包已加密，请输入解密密码");
  }
  try {
    const salt = Buffer.from(envelope.salt!, "hex");
    const iv = Buffer.from(envelope.iv!, "hex");
    const tag = Buffer.from(envelope.tag!, "hex");
    const ciphertext = Buffer.from(envelope.ciphertext!, "base64");
    const key = scryptSync(password, salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("解密失败：密码错误或备份数据已损坏");
  }
}

export class SyncService {
  private readonly accounts: () => AccountService;
  private readonly piDir: () => string;
  private readonly paseoHome: () => string;

  constructor(
    accounts: () => AccountService = () => new AccountService(),
    piDir = () => dirname(defaultAccountPaths().auth),
    paseoHome = () => process.env.PASEO_HOME || join(homedir(), ".paseo"),
  ) {
    this.accounts = accounts;
    this.piDir = piDir;
    this.paseoHome = paseoHome;
  }

  async exportBundle(input: SyncExportInput = {}): Promise<SyncExportOutput> {
    const options = {
      includeAccounts: input.options?.includeAccounts ?? true,
      includePiPackages: input.options?.includePiPackages ?? true,
      includeModelOverrides: input.options?.includeModelOverrides ?? true,
      includePaseoProxy: input.options?.includePaseoProxy ?? false,
    };

    let accounts: SyncAccountItem[] | undefined;
    const families = new Set<string>();

    if (options.includeAccounts) {
      const candidates = await this.accounts().exportCandidates();
      const currentActiveIds = new Set<string>();
      for (const family of ["antigravity", "codex", "xai"] as const) {
        try {
          const qc = await this.accounts().quotaCredentials(family, LIVE_SLOTS[family]);
          if (qc.currentAccountId) currentActiveIds.add(qc.currentAccountId);
        } catch {}
      }

      accounts = candidates.map((c) => {
        families.add(c.family);
        return {
          id: c.id,
          family: c.family,
          slot: c.slot,
          label: c.label,
          credential: c.credential,
          plan: c.plan,
          subscriptionExpiresAt: c.subscriptionExpiresAt,
          active: currentActiveIds.has(c.id),
        };
      });
    }

    let piConfig: SyncBundle["piConfig"] | undefined;
    const piPath = this.piDir();

    if (options.includePiPackages) {
      try {
        const settingsRaw = await readFile(join(piPath, "settings.json"), "utf8");
        const settings = JSON.parse(settingsRaw);
        if (Array.isArray(settings?.packages)) {
          const pkgs = settings.packages
            .map((p: unknown) => (typeof p === "string" ? p : (p as { source?: string })?.source))
            .filter((p: unknown): p is string => typeof p === "string");
          piConfig = { ...piConfig, packages: pkgs };
        }
      } catch {}
    }

    if (options.includeModelOverrides) {
      try {
        const modelsRaw = await readFile(join(piPath, "models.json"), "utf8");
        const modelsJson = JSON.parse(modelsRaw);
        if (modelsJson && typeof modelsJson === "object") {
          piConfig = { ...piConfig, modelsJson };
        }
      } catch {}
    }

    let paseoConfig: SyncBundle["paseoConfig"] | undefined;
    if (options.includePaseoProxy) {
      try {
        const configRaw = await readFile(join(this.paseoHome(), "config.json"), "utf8");
        const config = JSON.parse(configRaw);
        const piEnv = config?.agents?.providers?.pi?.env;
        if (piEnv && typeof piEnv === "object") {
          paseoConfig = { piEnv };
        }
      } catch {}
    }

    const bundle: SyncBundle = {
      version: 1,
      exportedAt: Date.now(),
      sourceDevice: hostname(),
      ...(accounts ? { accounts } : {}),
      ...(piConfig ? { piConfig } : {}),
      ...(paseoConfig ? { paseoConfig } : {}),
    };

    const serialized = JSON.stringify(bundle, null, 2);
    const { encrypted, payload } = encryptPayload(serialized, input.password);

    return {
      encrypted,
      payload,
      summary: {
        accountCount: accounts?.length ?? 0,
        families: [...families],
        hasPiPackages: !!piConfig?.packages?.length,
        hasModelOverrides: !!piConfig?.modelsJson,
        hasPaseoProxy: !!paseoConfig?.piEnv,
        exportedAt: bundle.exportedAt,
        sourceDevice: bundle.sourceDevice,
      },
    };
  }

  async importBundle(input: SyncImportInput, signal?: AbortSignal): Promise<SyncImportOutput> {
    if (input.confirmed !== true) {
      throw new Error("请确认导入并覆盖或合并配置");
    }

    const decrypted = decryptPayload(input.payload, input.password);
    let parsed: unknown;
    try {
      parsed = JSON.parse(decrypted);
    } catch {
      throw new Error("备份数据格式无效，不是合法的 JSON");
    }

    const bundleResult = SyncBundleSchema.safeParse(parsed);
    if (!bundleResult.success) {
      throw new Error(`备份数据校验失败: ${bundleResult.error.issues.map((i) => i.message).join(", ")}`);
    }
    const bundle = bundleResult.data;

    let importedAccounts = 0;
    const affectedFamilies = new Set<string>();

    if (bundle.accounts && bundle.accounts.length > 0) {
      const candidates = bundle.accounts.map((a) => ({
        id: a.id,
        family: a.family as Family,
        slot: a.slot,
        label: a.label,
        credential: a.credential,
        plan: a.plan,
        subscriptionExpiresAt: a.subscriptionExpiresAt,
        active: a.active,
      }));
      const res = await this.accounts().importAccounts(candidates, input.strategy, signal);
      importedAccounts = res.importedCount + res.updatedCount;
      res.families.forEach((f) => affectedFamilies.add(f));
    }

    let updatedPiConfig = false;
    const piPath = this.piDir();

    // 1. Models.json merge
    if (bundle.piConfig?.modelsJson) {
      await mkdir(piPath, { recursive: true, mode: 0o700 });
      const modelsFilePath = join(piPath, "models.json");
      let existingModels: Record<string, any> = {};
      try {
        existingModels = JSON.parse(await readFile(modelsFilePath, "utf8"));
      } catch {}

      const incomingModels = bundle.piConfig.modelsJson as Record<string, any>;
      const mergedModels: Record<string, any> = { ...existingModels };

      if (incomingModels.providers && typeof incomingModels.providers === "object") {
        mergedModels.providers = mergedModels.providers || {};
        for (const [providerKey, providerVal] of Object.entries(incomingModels.providers)) {
          mergedModels.providers[providerKey] = {
            ...mergedModels.providers[providerKey],
            ...(providerVal as any),
            modelOverrides: {
              ...(mergedModels.providers[providerKey]?.modelOverrides || {}),
              ...((providerVal as any)?.modelOverrides || {}),
            },
          };
        }
      }

      await writeFile(modelsFilePath, `${JSON.stringify(mergedModels, null, 2)}\n`, { mode: 0o644 });
      updatedPiConfig = true;
    }

    // 2. Settings.json packages merge
    if (bundle.piConfig?.packages && bundle.piConfig.packages.length > 0) {
      await mkdir(piPath, { recursive: true, mode: 0o700 });
      const settingsFilePath = join(piPath, "settings.json");
      let existingSettings: Record<string, any> = {};
      try {
        existingSettings = JSON.parse(await readFile(settingsFilePath, "utf8"));
      } catch {}

      const currentPackages: string[] = Array.isArray(existingSettings.packages)
        ? existingSettings.packages
            .map((p: any) => (typeof p === "string" ? p : p?.source))
            .filter((p: any): p is string => typeof p === "string")
        : [];

      const mergedPackages = [...currentPackages];
      for (const pkg of bundle.piConfig.packages) {
        if (!mergedPackages.includes(pkg)) {
          mergedPackages.push(pkg);
        }
      }

      existingSettings.packages = mergedPackages;
      await writeFile(settingsFilePath, `${JSON.stringify(existingSettings, null, 2)}\n`, { mode: 0o600 });
      updatedPiConfig = true;
    }

    // 3. Paseo config proxy merge
    let updatedPaseoConfig = false;
    if (bundle.paseoConfig?.piEnv) {
      const configPath = join(this.paseoHome(), "config.json");
      try {
        const configRaw = await readFile(configPath, "utf8");
        const config = JSON.parse(configRaw);
        if (config?.agents?.providers?.pi) {
          config.agents.providers.pi.env = {
            ...(config.agents.providers.pi.env || {}),
            ...bundle.paseoConfig.piEnv,
          };
          await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
          updatedPaseoConfig = true;
        }
      } catch {}
    }

    const notices: string[] = [];
    if (importedAccounts > 0) {
      notices.push(`已同步 ${importedAccounts} 个账号凭据`);
    }
    if (updatedPiConfig) {
      notices.push("已同步 Pi 模型配置与扩展列表");
    }
    if (updatedPaseoConfig) {
      notices.push("已更新 Paseo 环境变量配置");
    }

    return {
      success: true,
      importedAccounts,
      families: [...affectedFamilies],
      updatedPiConfig,
      updatedPaseoConfig,
      notice: notices.length > 0 ? notices.join("，") + "。" : "配置无变更。",
    };
  }
}
