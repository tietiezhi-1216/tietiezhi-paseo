import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const TerminalProbeRequestSchema = z.object({
  requestId: z.uuid(), serverId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200),
  kind: z.enum(["system", "pi-antigravity"]).optional(),
});
export const TerminalProbeResultSchema = TerminalProbeRequestSchema.extend({
  state: z.enum(["pending", "running", "completed", "failed", "expired"]),
  terminalId: z.string().nullable(), existingTerminals: z.array(z.string()).max(200),
  output: z.string().max(4000), cleanedUp: z.boolean(), error: z.string().nullable(),
});
export type TerminalProbeRequest = z.infer<typeof TerminalProbeRequestSchema>;
export type TerminalProbeResult = z.infer<typeof TerminalProbeResultSchema>;
export const requestTerminalProbe = defineRpc({
  name: "terminals.probe.request", input: z.object({ serverId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200), kind: z.enum(["system", "pi-antigravity"]).optional() }),
  output: z.object({ requestId: z.uuid() }),
});
export const pendingTerminalProbes = defineRpc({
  name: "terminals.probe.pending", input: z.object({}), output: z.object({ requests: z.array(TerminalProbeRequestSchema).max(8) }),
});
export const claimTerminalProbe = defineRpc({
  name: "terminals.probe.claim", input: z.object({ requestId: z.uuid(), claimant: z.uuid() }), output: z.object({ accepted: z.boolean() }),
});
export const reportTerminalProbe = defineRpc({
  name: "terminals.probe.report", input: z.object({ claimant: z.uuid(), result: TerminalProbeResultSchema }), output: z.object({ accepted: z.boolean() }),
});
export const collectTerminalProbe = defineRpc({
  name: "terminals.probe.collect", input: z.object({ requestId: z.uuid() }), output: TerminalProbeResultSchema,
});
