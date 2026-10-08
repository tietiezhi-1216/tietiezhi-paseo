import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const LoginFamilySchema = z.enum(["codex", "xai", "antigravity"]);
export const LoginStateSchema = z.object({
  id: z.string().uuid(),
  family: LoginFamilySchema,
  status: z.enum(["starting", "waiting", "saving", "done", "error", "cancelled"]),
  url: z.string().nullable(),
  userCode: z.string().nullable(),
  error: z.string().nullable(),
});
export type LoginState = z.infer<typeof LoginStateSchema>;
export type LoginFamily = z.infer<typeof LoginFamilySchema>;
export const startLogin = defineRpc({ name: "tietiezhi.login.start", input: z.object({ family: LoginFamilySchema, confirmed: z.literal(true) }), output: LoginStateSchema });
export const loginStatus = defineRpc({ name: "tietiezhi.login.status", input: z.object({ id: z.string().uuid() }), output: LoginStateSchema });
export const cancelLogin = defineRpc({ name: "tietiezhi.login.cancel", input: z.object({ id: z.string().uuid() }), output: LoginStateSchema });
