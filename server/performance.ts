import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { ModelPerformanceStats, PerformanceOverview, TurnPerformanceData } from "../shared/performance.ts";

interface RawTurnRecord {
  id: string;
  agentId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  tps: number;
  timestamp: number;
}

const MAX_STORED_RECORDS = 2_000;
const STORE_PATH = join(homedir(), ".paseo", "tietiezhi", "model-performance.json");

export class PerformanceService {
  private turnStartTimes = new Map<string, number>();
  private lastKnownUsage = new Map<string, { input: number; output: number; cached: number }>();
  private records: RawTurnRecord[] = [];
  private loaded = false;

  constructor() {
    this.load();
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (existsSync(STORE_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(STORE_PATH, "utf8"));
        if (Array.isArray(raw)) {
          this.records = raw.slice(-MAX_STORED_RECORDS);
        }
      } catch {
        this.records = [];
      }
    }
  }

  private save() {
    try {
      mkdirSync(dirname(STORE_PATH), { recursive: true });
      writeFileSync(STORE_PATH, JSON.stringify(this.records.slice(-MAX_STORED_RECORDS), null, 2), "utf8");
    } catch {}
  }

  onTurnStarted(event: PluginLifecycleEvents["agent.turn_started"]) {
    this.turnStartTimes.set(event.agent.id, Date.now());
  }

  async onTurnEnded(
    event: PluginLifecycleEvents["agent.turn_ended"],
    context: PluginHookContext,
  ): Promise<TurnPerformanceData | null> {
    const startTime = this.turnStartTimes.get(event.agent.id) ?? (Date.now() - 1_000);
    this.turnStartTimes.delete(event.agent.id);
    const durationMs = Math.max(120, Date.now() - startTime);

    let modelName = "unknown";
    let providerName = event.agent.provider || "ai";

    let deltaInput = 0;
    let deltaOutput = 0;
    let deltaCached = 0;

    try {
      const agentHandle = context.paseo.agents.ref(event.agent.id);
      const snapshot = await agentHandle.refresh();
      if (snapshot?.agent?.runtimeInfo?.model) {
        modelName = snapshot.agent.runtimeInfo.model;
      }
      if (snapshot?.agent?.runtimeInfo?.provider) {
        providerName = snapshot.agent.runtimeInfo.provider;
      }

      const current = snapshot?.agent?.lastUsage;
      if (current) {
        const prev = this.lastKnownUsage.get(event.agent.id) ?? { input: 0, output: 0, cached: 0 };
        deltaInput = Math.max(0, (current.inputTokens ?? 0) - prev.input);
        deltaOutput = Math.max(0, (current.outputTokens ?? 0) - prev.output);
        deltaCached = Math.max(0, (current.cachedInputTokens ?? 0) - prev.cached);

        this.lastKnownUsage.set(event.agent.id, {
          input: current.inputTokens ?? 0,
          output: current.outputTokens ?? 0,
          cached: current.cachedInputTokens ?? 0,
        });
      }
    } catch {}

    // Only record and display if output tokens were generated
    if (deltaOutput <= 0) return null;

    const durationSec = durationMs / 1000;
    const tps = Number((deltaOutput / durationSec).toFixed(1));

    const perfData: TurnPerformanceData = {
      model: modelName,
      provider: providerName,
      inputTokens: deltaInput,
      outputTokens: deltaOutput,
      cachedTokens: deltaCached,
      durationMs,
      tps,
      timestamp: Date.now(),
    };

    // 1. Record persistently
    this.records.push({
      id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentId: event.agent.id,
      ...perfData,
    });
    this.save();

    // 2. Append directly to timeline so UI immediately draws the badge under AI message
    try {
      await context.paseo.agents.ref(event.agent.id).timeline.append({
        type: "plugin",
        id: `perf-badge-${event.turnId || Date.now()}`,
        kind: "turn-performance",
        version: 1,
        data: perfData,
      });
    } catch (err) {
      console.error("[PERFORMANCE] timeline.append error:", err);
    }

    return perfData;
  }

  getOverview(query = ""): PerformanceOverview {
    this.load();
    const q = query.trim().toLowerCase();
    const filtered = q
      ? this.records.filter((r) => r.model.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q))
      : this.records;

    const groupMap = new Map<string, RawTurnRecord[]>();
    for (const record of filtered) {
      const key = `${record.provider}::${record.model}`;
      const list = groupMap.get(key) ?? [];
      list.push(record);
      groupMap.set(key, list);
    }

    let totalOutput = 0;
    let totalInput = 0;
    let totalDurationSec = 0;

    const modelStatsList: ModelPerformanceStats[] = [];

    for (const records of groupMap.values()) {
      if (!records.length) continue;
      const first = records[0];
      const model = first.model;
      const provider = first.provider;

      let mInput = 0;
      let mOutput = 0;
      let mCached = 0;
      let mDurationMs = 0;
      let maxTps = 0;
      let minTps = Infinity;
      let lastUsedAt = 0;
      let latestTps = 0;

      for (const r of records) {
        mInput += r.inputTokens;
        mOutput += r.outputTokens;
        mCached += r.cachedTokens;
        mDurationMs += r.durationMs;
        if (r.tps > maxTps) maxTps = r.tps;
        if (r.tps < minTps) minTps = r.tps;
        if (r.timestamp > lastUsedAt) {
          lastUsedAt = r.timestamp;
          latestTps = r.tps;
        }
      }

      totalInput += mInput;
      totalOutput += mOutput;
      totalDurationSec += mDurationMs / 1000;

      const durationSec = Math.max(0.001, mDurationMs / 1000);
      const avgTps = Number((mOutput / durationSec).toFixed(1));

      modelStatsList.push({
        model,
        provider,
        turnCount: records.length,
        avgTps,
        maxTps: maxTps === 0 ? 0 : maxTps,
        minTps: minTps === Infinity ? 0 : minTps,
        totalInputTokens: mInput,
        totalOutputTokens: mOutput,
        totalCachedTokens: mCached,
        avgDurationMs: Math.round(mDurationMs / records.length),
        latestTps,
        lastUsedAt,
      });
    }

    modelStatsList.sort((a, b) => b.turnCount - a.turnCount || b.lastUsedAt - a.lastUsedAt);

    const overallAvgTps = totalDurationSec > 0 ? Number((totalOutput / totalDurationSec).toFixed(1)) : 0;

    return {
      models: modelStatsList,
      overallAvgTps,
      totalTurns: filtered.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
    };
  }
}
