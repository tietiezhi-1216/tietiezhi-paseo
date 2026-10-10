import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ProbeRequestSchema = z.object({ requestId: z.uuid(), agentId: z.uuid() });
export const ProbeHostResultSchema = z.object({
  serverId: z.string().min(1).max(200),
  label: z.string().max(200),
  state: z.enum(["found", "not_found", "offline", "error"]),
  agent: z.object({
    id: z.uuid(), title: z.string().nullable(), provider: z.string(),
    status: z.string(), model: z.string().nullable(), workspaceId: z.string().nullable(),
  }).nullable(),
});
export const ProbeResultSchema = z.object({
  requestId: z.uuid(), agentId: z.uuid(),
  state: z.enum(["pending", "found", "expired"]),
  hosts: z.array(ProbeHostResultSchema).max(64),
});
export type ProbeHostResult = z.infer<typeof ProbeHostResultSchema>;
export const requestAgentProbe = defineRpc({
  name: "agents.probe.request", input: z.object({ agentId: z.uuid() }),
  output: z.object({ requestId: z.uuid() }),
});
export const pendingAgentProbes = defineRpc({
  name: "agents.probe.pending", input: z.object({}),
  output: z.object({ requests: z.array(ProbeRequestSchema).max(16) }),
});
export const reportAgentProbe = defineRpc({
  name: "agents.probe.report",
  input: z.object({ requestId: z.uuid(), hosts: z.array(ProbeHostResultSchema).max(64) }),
  output: z.object({ accepted: z.boolean() }),
});
export const collectAgentProbe = defineRpc({
  name: "agents.probe.collect", input: z.object({ requestId: z.uuid() }),
  output: ProbeResultSchema,
});
