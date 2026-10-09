import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** A deduplication key, not a secret; native runtimes may lack Web Crypto. */
export function createForkOperationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export const forkReply = defineRpc({
  name: "slotgame.reply.fork",
  input: z.object({
    agentId: z.string().min(1), serverId: z.string().min(1),
    recordId: z.string().min(1), replyAt: z.number().finite(),
    target: z.enum(["tab", "workspace"]),
    prompt: z.string().trim().min(1).max(20_000),
    operationId: z.string().uuid(),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string(), serverId: z.string() }),
});
