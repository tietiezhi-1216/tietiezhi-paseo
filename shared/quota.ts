import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AccountSnapshotSchema, FamilySchema, familyOfSlot, type Family } from "./accounts.ts";

const SlotSchema = z.string().max(128).regex(/^(openai-codex|xai|antigravity)(-account-[A-Za-z0-9_-]+)?$/);
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
});
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;
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
