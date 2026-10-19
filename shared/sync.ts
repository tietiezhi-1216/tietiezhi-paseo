import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SyncOptionsSchema = z.object({
  includeAccounts: z.boolean().default(true),
  includePiPackages: z.boolean().default(true),
  includeModelOverrides: z.boolean().default(true),
  includePaseoProxy: z.boolean().default(false),
});
export type SyncOptions = z.infer<typeof SyncOptionsSchema>;

export const SyncAccountItemSchema = z.object({
  id: z.string(),
  family: z.string(),
  slot: z.string(),
  label: z.string(),
  credential: z.record(z.string(), z.unknown()),
  plan: z.string().nullable().optional(),
  subscriptionExpiresAt: z.number().nullable().optional(),
  active: z.boolean().optional(),
});
export type SyncAccountItem = z.infer<typeof SyncAccountItemSchema>;

export const SyncBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number(),
  sourceDevice: z.string(),
  accounts: z.array(SyncAccountItemSchema).optional(),
  piConfig: z.object({
    packages: z.array(z.string()).optional(),
    modelsJson: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  paseoConfig: z.object({
    piEnv: z.record(z.string(), z.string()).optional(),
  }).optional(),
});
export type SyncBundle = z.infer<typeof SyncBundleSchema>;

export const SyncExportInputSchema = z.object({
  options: SyncOptionsSchema.optional(),
  password: z.string().optional(),
});
export type SyncExportInput = z.infer<typeof SyncExportInputSchema>;

export const SyncExportOutputSchema = z.object({
  encrypted: z.boolean(),
  payload: z.string(),
  summary: z.object({
    accountCount: z.number(),
    families: z.array(z.string()),
    hasPiPackages: z.boolean(),
    hasModelOverrides: z.boolean(),
    hasPaseoProxy: z.boolean(),
    exportedAt: z.number(),
    sourceDevice: z.string(),
  }),
});
export type SyncExportOutput = z.infer<typeof SyncExportOutputSchema>;

export const SyncImportInputSchema = z.object({
  payload: z.string(),
  password: z.string().optional(),
  confirmed: z.literal(true),
  strategy: z.enum(["merge", "overwrite"]).default("merge"),
});
export type SyncImportInput = z.input<typeof SyncImportInputSchema>;

export const SyncImportOutputSchema = z.object({
  success: z.boolean(),
  importedAccounts: z.number(),
  families: z.array(z.string()),
  updatedPiConfig: z.boolean(),
  updatedPaseoConfig: z.boolean(),
  notice: z.string(),
});
export type SyncImportOutput = z.infer<typeof SyncImportOutputSchema>;

export const exportSyncBundle = defineRpc({
  name: "tietiezhi.sync.export",
  input: SyncExportInputSchema,
  output: SyncExportOutputSchema,
});

export const importSyncBundle = defineRpc({
  name: "tietiezhi.sync.import",
  input: SyncImportInputSchema,
  output: SyncImportOutputSchema,
});
