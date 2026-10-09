import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AccountSnapshotSchema, FamilySchema, familyOfSlot, type Family } from "./accounts.ts";

const SlotSchema = z.string().max(128).regex(/^(openai-codex|openai-codex-fast|xai|antigravity)(-account-[A-Za-z0-9_-]+)?$/);
export function resolveQuotaRoute(provider: string | null | undefined, model: string | null | undefined): { family: Family; slot: string } | null {
  if (!provider || !/^pi(?:\/|$)/.test(provider)) return null;
  // The route must be explicit. A model name alone cannot distinguish providers.
  const modelParts = (model ?? "").split("/");
  const modelSlot = modelParts[0] === "pi" ? modelParts[1] : modelParts[0];
  const providerSlot = provider.split("/")[1];
  const slot = SlotSchema.safeParse(modelSlot).success ? modelSlot : providerSlot;
  return slot && SlotSchema.safeParse(slot).success ? { family: familyOfSlot(slot)!, slot } : null;
}
export const QuotaWindowSchema = z.object({
  id: z.string().max(200), label: z.string().max(100),
  usedPercent: z.number().min(0).max(100), resetAt: z.number().nullable(),
  pool: z.enum(["gemini", "claude", "shared"]),
  usageSource: z.enum(["reported", "protobuf-default"]).optional(),
});
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Rec : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function percent(v: unknown): number | null { const n = num(v); return n === null ? null : Math.min(100, Math.max(0, n)); }
function epoch(v: unknown): number | null {
  if (typeof v === "string") { const d = Date.parse(v); return Number.isFinite(d) ? d : null; }
  const n = num(v); return n === null || n <= 0 ? null : n < 1e10 ? n * 1000 : n;
}
export function normalizeWindow(id: string, label: string, used: unknown, reset: unknown, pool: QuotaWindow["pool"] = "shared"): QuotaWindow | null {
  const p = percent(used);
  return p === null ? null : { id: id.slice(0, 200), label: label.slice(0, 100), usedPercent: p, resetAt: epoch(reset), pool };
}
export function legacyQuotaWindows(value: unknown): QuotaWindow[] {
  const usage = rec(value);
  const windows: QuotaWindow[] = [];
  for (const [id, label] of [["primary", "主窗口"], ["secondary", "次窗口"]] as const) {
    const w = rec(usage[id]), normalized = normalizeWindow(id, label, w.usedPercent, w.resetAt);
    if (normalized) windows.push(normalized);
  }
  for (const raw of (Array.isArray(usage.windows) ? usage.windows : []).slice(0, 100)) {
    const w = rec(raw), label = text(w.label);
    const existingPool = w.pool === "gemini" || w.pool === "claude" ? (w.pool as "gemini" | "claude") : null;
    const pool = existingPool ?? (/gemini/i.test(label) ? "gemini" : /claude|gpt|anthropic/i.test(label) ? "claude" : "shared");
    const normalized = normalizeWindow(text(w.id) || `legacy-${windows.length}`, label, w.usedPercent, w.resetAt, pool);
    if (normalized) windows.push({ ...normalized, ...(w.usageSource === "reported" || w.usageSource === "protobuf-default" ? { usageSource: w.usageSource } : {}) });
  }
  return windows.slice(0, 100);
}
export function selectQuotaWindow(family: Family, model: string | null, windows: readonly QuotaWindow[]): QuotaWindow | null {
  let candidates = [...windows];
  if (family === "antigravity") {
    const pool = /gemini/i.test(model ?? "") ? "gemini" : /claude|gpt-oss/i.test(model ?? "") ? "claude" : null;
    if (!pool) return null;
    candidates = candidates.filter((w) => w.pool === pool || w.pool === "shared");
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const now = Date.now();
  // 1. Critical bottleneck: if any quota is critically low (remaining <= 20%, i.e. used >= 80%),
  // always surface the worst critical bottleneck to warn the user!
  const critical = candidates.filter((w) => w.usedPercent >= 80);
  if (critical.length) {
    return critical.reduce((worst, w) => w.usedPercent > worst.usedPercent ? w : worst);
  }

  // 2. Short-term window priority: short-term rolling limits (e.g. 5-hour window, or resetting within 12h)
  // are the immediate lifeline for continuous coding.
  const shortTerm = candidates.filter((w) => {
    const isFiveHour = /5小时|5h|five.?hour/i.test(w.label) || /5小时|5h/i.test(w.id);
    const resetsSoon = w.resetAt != null && (w.resetAt - now) <= 12 * 3600 * 1000;
    return isFiveHour || resetsSoon;
  });
  if (shortTerm.length) {
    return shortTerm.reduce((worst, w) => w.usedPercent > worst.usedPercent ? w : worst);
  }

  // 3. Fallback: pick the window with lowest remaining percentage (highest used)
  return candidates.reduce<QuotaWindow | null>((worst, w) => !worst || w.usedPercent > worst.usedPercent ? w : worst, null);
}
export const AccountQuotaSchema = z.object({
  accountId: z.string(), windows: z.array(QuotaWindowSchema).max(100), plan: z.string().nullable(),
  fetchedAt: z.number().nullable(), checkedAt: z.number().nullable(), stale: z.boolean(), error: z.string().nullable(),
});
export type AccountQuota = z.infer<typeof AccountQuotaSchema>;
export const QuotaSnapshotSchema = z.object({
  snapshot: AccountSnapshotSchema, family: FamilySchema, currentAccountId: z.string().nullable(),
  quotas: z.array(AccountQuotaSchema),
});
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;
export const getQuota = defineRpc({
  name: "tietiezhi.quota.get",
  input: z.object({
    family: z.enum(["codex", "xai", "antigravity"]),
    slot: SlotSchema.nullable().optional(),
    all: z.boolean().optional(), refresh: z.boolean().optional(),
  }),
  output: QuotaSnapshotSchema,
});
