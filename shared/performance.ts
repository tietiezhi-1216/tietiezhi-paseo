import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

export const TurnPerformanceSchema = z.object({
  model: z.string(),
  provider: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  reasoningTokens: z.number().optional(),
  durationMs: z.number(),
  /** End-to-end turn throughput, including tools/waits (legacy-compatible). */
  tps: z.number(),
  /** Sum of native response durations; includes TTFT, excludes inter-response tools. */
  modelDurationMs: z.number().finite().positive().optional(),
  modelTps: z.number().finite().nonnegative().optional(),
  /** Measured request-to-first-token latency only. Absent when not captured. */
  ttftMs: z.number().finite().nonnegative().optional(),
  timestamp: z.number(),
  steps: z.number().optional(),
  content: z.string().optional(),
  messageId: z.string().optional(),
  recordId: z.string().optional(),
});
export type TurnPerformanceData = z.infer<typeof TurnPerformanceSchema>;

export const AssistantReplySchema = z.object({
  text: z.string(),
  messageId: z.string().optional(),
  phase: z.enum(["streaming", "complete"]),
});
export type AssistantReplyData = z.infer<typeof AssistantReplySchema>;

/** Exact identity first; repeated text without an identity is deliberately ambiguous. */
export function matchReplyPerformance(records: TurnPerformanceData[], reply: AssistantReplyData) {
  const matches = records.filter((record) => reply.messageId && record.messageId
    ? record.messageId === reply.messageId
    : record.content === reply.text);
  return matches.length === 1 ? matches[0] : undefined;
}

export const getAgentTurnPerformance = defineRpc({
  name: "slotgame.performance.agent_turns",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ records: z.array(TurnPerformanceSchema) }),
});

export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${count}`;
}

/** Compact duration; precise seconds are useful for measured TTFT. */
export function formatPerformanceDuration(ms: number | undefined, precise = false): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (precise && ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", seconds || !totalSeconds ? `${seconds}s` : ""].filter(Boolean).join(" ");
}

/** Pi input excludes cache reads. Use raw counts, never rounded display values. */
export function formatCacheHit(input: number, cached: number): string {
  if (!Number.isFinite(input) || !Number.isFinite(cached) || input < 0 || cached < 0 || input + cached <= 0) return "—";
  return `${(100 * cached / (input + cached)).toFixed(1)}%`;
}

export const ModelPerformanceStatsSchema = z.object({
  model: z.string(),
  provider: z.string(),
  turnCount: z.number(),
  avgTps: z.number(),
  maxTps: z.number(),
  minTps: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCachedTokens: z.number(),
  avgDurationMs: z.number(),
  latestTps: z.number(),
  lastUsedAt: z.number(),
});
export type ModelPerformanceStats = z.infer<typeof ModelPerformanceStatsSchema>;

export const PerformanceOverviewSchema = z.object({
  models: z.array(ModelPerformanceStatsSchema),
  overallAvgTps: z.number(),
  totalTurns: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
});
export type PerformanceOverview = z.infer<typeof PerformanceOverviewSchema>;

export const getModelPerformance = defineRpc({
  name: "slotgame.performance.overview",
  input: z.object({
    query: z.string().optional(),
  }),
  output: PerformanceOverviewSchema,
});
