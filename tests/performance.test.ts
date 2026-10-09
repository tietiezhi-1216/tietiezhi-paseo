import assert from "node:assert/strict";
import { test } from "node:test";
import { PerformanceService } from "../server/performance.ts";
import {
  TurnPerformanceSchema,
  ModelPerformanceStatsSchema,
  PerformanceOverviewSchema,
} from "../shared/performance.ts";

test("TurnPerformanceSchema validates valid performance data", () => {
  const sample = {
    model: "openai-codex/gpt-6-astra",
    provider: "openai-codex",
    inputTokens: 1250,
    outputTokens: 640,
    cachedTokens: 8900,
    durationMs: 12500,
    tps: 51.2,
    timestamp: Date.now(),
  };
  const parsed = TurnPerformanceSchema.parse(sample);
  assert.equal(parsed.tps, 51.2);
  assert.equal(parsed.outputTokens, 640);
});

test("PerformanceService calculates delta usage and records turn performance", async () => {
  const service = new PerformanceService();
  const agentId = `test-agent-${Date.now()}`;

  // 模拟 turn_started
  service.onTurnStarted({
    agent: {
      id: agentId,
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "pi",
      cwd: "/test",
      title: "Test Agent",
    },
    turnId: "turn-1",
  });

  // 模拟 context.paseo
  const mockContext = {
    paseo: {
      agents: {
        ref: (_id: string) => ({
          refresh: async () => ({
            agent: {
              id: agentId,
              runtimeInfo: { model: "gpt-6-astra", provider: "openai-codex" },
              lastUsage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 2000 },
            },
          }),
          timeline: {
            append: async (item: unknown) => {
              assert.ok(item);
            },
          },
        }),
      },
    },
  };

  const result = await service.onTurnEnded(
    {
      agent: {
        id: agentId,
        workspaceId: "ws-1",
        parentAgentId: null,
        provider: "openai-codex",
        cwd: "/test",
        title: "Test Agent",
      },
      turnId: "turn-1",
      outcome: { kind: "completed" },
      timeline: [],
    },
    mockContext as any,
  );

  assert.ok(result);
  assert.equal(result.outputTokens, 500);
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.model, "gpt-6-astra");
  assert.ok(result.tps > 0);

  // 聚合总览
  const overview = service.getOverview("gpt-6-astra");
  assert.ok(overview.models.length > 0);
  const modelStat = overview.models.find((m) => m.model === "gpt-6-astra");
  assert.ok(modelStat);
  assert.equal(modelStat.totalOutputTokens >= 500, true);
  assert.ok(modelStat.avgTps > 0);
});
