import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Package sources are arguments, not shell fragments. Start with npm packages only.
export const PiPackageSource = z.string().max(240).regex(
  /^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._+^-]*)?$/,
  "请输入 npm:包名 或 npm:@scope/包名@版本",
);
export const PiInventorySchema = z.object({
  version: z.string(),
  revision: z.string(),
  packages: z.array(z.object({ source: z.string(), name: z.string(), version: z.string().nullable(), managed: z.boolean() })),
  localExtensions: z.array(z.string()),
});
export const piInventory = defineRpc({ name: "pi.inventory", input: z.object({}), output: PiInventorySchema });
export const piPackageChange = defineRpc({
  name: "pi.package.change",
  input: z.object({
    operation: z.enum(["install", "remove", "update"]), source: PiPackageSource,
    revision: z.string().length(64), confirmed: z.literal(true),
  }),
  output: z.object({ inventory: PiInventorySchema, notice: z.string() }),
});
