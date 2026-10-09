import { z } from "zod";

export const CompactToolSchema = z.object({
  name: z.string(), status: z.string(),
  detail: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});
export const CompactReasoningSchema = z.object({ text: z.string(), phase: z.enum(["streaming", "complete"]) });

export const CompactActivityGroupSchema = z.object({ items: z.array(z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("compact-tool"), version: z.literal(1), timestamp: z.iso.datetime(), data: CompactToolSchema }),
  z.object({ id: z.string(), kind: z.literal("compact-reasoning"), version: z.literal(1), timestamp: z.iso.datetime(), data: CompactReasoningSchema }),
])).min(1) });

export function activitySummary(detail: Record<string, unknown>): string {
  for (const key of ["filePath", "command", "query", "url", "label"]) {
    if (typeof detail[key] === "string") return (detail[key] as string).replace(/\s+/g, " ").trim();
  }
  return "";
}

export function reasoningSummary(text: string): string {
  return text.split("\n").map(line => line.replace(/^[#*>\s]+/, "").replace(/\*\*/g, "").trim()).find(Boolean) || "";
}
