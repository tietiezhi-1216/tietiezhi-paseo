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
  tps: z.number(),
  timestamp: z.number(),
  steps: z.number().optional(),
  content: z.string().optional(),
});
export type TurnPerformanceData = z.infer<typeof TurnPerformanceSchema>;

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
