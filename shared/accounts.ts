import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FamilySchema = z.enum(["codex", "xai", "go", "antigravity"]);
export type Family = z.infer<typeof FamilySchema>;
export const FAMILY_LABELS: Record<Family, string> = {
  codex: "Codex", xai: "Grok / xAI", go: "OpenCode Go", antigravity: "Antigravity",
};
export const LIVE_SLOTS: Record<Family, string> = {
  codex: "openai-codex", xai: "xai", go: "opencode-go", antigravity: "antigravity",
};

export function familyOfSlot(slot: string): Family | null {
  for (const [family, base] of Object.entries(LIVE_SLOTS)) {
    if (slot === base || slot.startsWith(`${base}-account-`)) return family as Family;
  }
  return null;
}

export const AccountSchema = z.object({
  id: z.string(),
  family: FamilySchema,
  label: z.string(),
  slot: z.string(),
  active: z.boolean(),
  authType: z.string(),
  expiresAt: z.number().nullable(),
  subscriptionExpiresAt: z.number().nullable(),
  plan: z.string().nullable(),
  canSwitch: z.boolean(),
  problem: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;
export const AccountSnapshotSchema = z.object({
  accounts: z.array(AccountSchema),
  revision: z.string(),
  warnings: z.array(z.string()),
});
export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;

export const listAccounts = defineRpc({
  name: "tietiezhi.accounts.list",
  input: z.object({}),
  output: AccountSnapshotSchema,
});
export const switchAccount = defineRpc({
  name: "tietiezhi.accounts.switch",
  input: z.object({
    id: z.string().regex(/^(codex|xai|go|antigravity):[a-f0-9]{24}$/),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  }),
  output: z.object({
    snapshot: AccountSnapshotSchema,
    backupCreated: z.boolean(),
    notice: z.string(),
  }),
});
