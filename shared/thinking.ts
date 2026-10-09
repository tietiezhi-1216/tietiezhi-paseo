import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { reasoningSummary } from "./activity.ts";

export const TurnThinkingSchema = z.object({
  turnId: z.string(),
  phase: z.enum(["active", "complete"]),
  activity: z.enum(["thinking", "working", "idle"]),
  records: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
  truncated: z.boolean(),
});
export type TurnThinkingData = z.infer<typeof TurnThinkingSchema>;

export const initializeThinking = defineRpc({
  name: "tietiezhi.thinking.initialize",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ attached: z.boolean() }),
});

export function thinkingPreview(data: TurnThinkingData): string {
  return reasoningSummary(data.records.at(-1)?.text ?? "");
}

/** Use serialized UTF-8 size, including JSON escaping, not a character estimate. */
function bytes(text: string): number {
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}
export function boundedThinking(data: TurnThinkingData): TurnThinkingData {
  const records = data.records.slice(-12).map(record => ({ ...record, text: record.text.slice(0, 12000) }));
  let truncated = data.truncated || records.length < data.records.length || records.some((record, index) => record.text !== data.records.slice(-12)[index].text);
  // Leave ample room below Paseo's 64 KiB plugin-data limit.
  while (bytes(JSON.stringify({ ...data, records, truncated })) > 48 * 1024) {
    truncated = true;
    if (records.length > 1) records.shift();
    else {
      if (!records[0]?.text.length) throw new Error("Thinking metadata exceeds the preview limit");
      records[0].text = records[0].text.slice(0, Math.floor(records[0].text.length / 2));
    }
  }
  return { ...data, records, truncated };
}
