import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceService } from "../server/performance.ts";
import {
  TurnPerformanceSchema,
  ModelPerformanceStatsSchema,
  PerformanceOverviewSchema,
  matchReplyPerformance,
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

test("PerformanceService records attributed native turn performance", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tietiezhi-performance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const service = new PerformanceService(join(dir, "records.json"));
  const agentId = `test-agent-${Date.now()}`;

  const nativeHandle = join(dir, "session.jsonl");
  const start = 1_700_000_000_000;
  let now = start;
  t.mock.method(Date, "now", () => now);
  writeFileSync(nativeHandle, [
    { type: "message", timestamp: new Date(start).toISOString(), message: { role: "user" } },
    { type: "message", timestamp: new Date(start + 2000).toISOString(), message: {
      role: "assistant", durationMs: 1000, usage: { input: 1000, output: 500, cacheRead: 2000 }, text: "Final reply",
    } },
  ].map(row => JSON.stringify(row)).join("\n"));
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

  now += 2000;
  // 模拟 context.paseo
  const mockContext = {
    paseo: {
      agents: {
        ref: (_id: string) => ({
          refresh: async () => ({
            agent: {
              id: agentId,
              persistence: { nativeHandle },
              runtimeInfo: { model: "gpt-6-astra", provider: "openai-codex" },
              lastUsage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 2000 },
            },
          }),
          timeline: {
            append: async (item: unknown) => {
              assert.fail("Unified replies must not append a second performance row");
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
      timeline: [{ type: "assistant_message", text: "Final reply", messageId: "reply-1" }],
    },
    mockContext as any,
  );

  assert.ok(result);
  assert.equal(result.outputTokens, 500);
  assert.equal(result.inputTokens, 1000);
  assert.equal(result.model, "gpt-6-astra");
  assert.ok(result.tps > 0);
  assert.equal(result.content, "Final reply");
  assert.equal(result.messageId, "reply-1");
  assert.equal(service.getAgentTurns("another-agent").records.length, 0);
  assert.equal(service.getAgentTurns(agentId).records.length, 1);
  assert.equal(new PerformanceService(join(dir, "records.json")).getAgentTurns(agentId).records[0].messageId, "reply-1");

  // 聚合总览
  const overview = service.getOverview("gpt-6-astra");
  assert.ok(overview.models.length > 0);
  const modelStat = overview.models.find((m) => m.model === "gpt-6-astra");
  assert.ok(modelStat);
  assert.equal(modelStat.totalOutputTokens >= 500, true);
  assert.ok(modelStat.avgTps > 0);
});

test("formatTokens formats values >= 1000 with k and M accurately", async () => {
  const { formatTokens } = await import("../shared/performance.ts");
  assert.equal(formatTokens(252), "252");
  assert.equal(formatTokens(684), "684");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1.0k");
  assert.equal(formatTokens(1250), "1.3k");
  assert.equal(formatTokens(9468), "9.5k");
  assert.equal(formatTokens(17000), "17k");
  assert.equal(formatTokens(643024), "643k");
  assert.equal(formatTokens(1500000), "1.5M");
  assert.equal(formatTokens(9300000), "9.3M");
});
