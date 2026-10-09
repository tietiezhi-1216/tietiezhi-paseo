import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { ModelPerformanceStats, PerformanceOverview, TurnPerformanceData } from "../shared/performance.ts";

import { RESPONSE_TIMING_ENTRY, isResponseTiming, matchResponseTiming, type ResponseIdentity, type ResponseTiming } from "../shared/response-timing.ts";

interface RawTurnRecord extends TurnPerformanceData {
  id: string;
  agentId: string;
}

const MAX_STORED_RECORDS = 2_000;
const STORE_PATH = join(homedir(), ".paseo", "tietiezhi", "model-performance.json");

function extractTurnUsageFromNativeHandle(
  nativeHandle?: string | null,
  turnStartTime?: number,
): { input: number; output: number; cached: number; reasoning: number; steps: number; content: string; durationMs: number; modelDurationMs?: number; ttftMs?: number } | null {
  if (!nativeHandle || !existsSync(nativeHandle)) return null;
  try {
    const rawContent = readFileSync(nativeHandle, "utf8");
    const lines = rawContent.trim().split("\n");
    if (!lines.length) return null;

    // Find the last user message index that initiated this turn
    let lastUserIndex = -1;
    let userTimestamp = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message?.role === "user") {
          lastUserIndex = i;
          userTimestamp = entry.timestamp ? Date.parse(entry.timestamp) : 0;
          break;
        }
      } catch {}
    }

    // Collect all assistant steps from this user message to the end of session
    const sliceFrom = lastUserIndex >= 0 ? lastUserIndex : Math.max(0, lines.length - 60);
    let input = 0;
    let output = 0;
    let cached = 0;
    let reasoning = 0;
    let steps = 0;
    let lastAssistantText = "";
    let lastAssistantTime = 0;
    let modelDurationMs = 0;
    let completeResponseTiming = true;
    let firstAssistant: ResponseIdentity | undefined;
    let firstAssistantFailed = false;
    const responseTimings: ResponseTiming[] = [];

    for (let i = sliceFrom; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "custom" && entry.customType === RESPONSE_TIMING_ENTRY && isResponseTiming(entry.data)) {
          responseTimings.push(entry.data);
        }
        if (entry.type === "message" && entry.message?.role === "assistant") {
          steps++;
          if (steps === 1) {
            const m = entry.message;
            firstAssistant = { timestamp: m.timestamp, provider: m.provider, api: m.api, model: m.model, responseId: m.responseId };
            firstAssistantFailed = m.stopReason === "error" || m.stopReason === "aborted";
          }
          // Native Pi response timing is persisted on the assistant message, not
          // usage. Never divide whole-turn tokens by a partially timed subset.
          const responseMs = entry.message.durationMs;
          if (typeof responseMs === "number" && Number.isFinite(responseMs) && responseMs > 0) {
            modelDurationMs += responseMs;
          } else {
            completeResponseTiming = false;
          }
          const u = entry.message.usage;
          if (u) {
            input += (u.input || 0);
            output += (u.output || 0);
            cached += (u.cacheRead || 0);
            reasoning += (u.reasoning || 0);
          }
          const t = entry.timestamp ? Date.parse(entry.timestamp) : 0;
          if (t > lastAssistantTime) lastAssistantTime = t;

          // Extract text for clipboard copying
          const contentItems = entry.message.content;
          if (Array.isArray(contentItems)) {
            for (const item of contentItems) {
              if (item?.type === "text" && typeof item.text === "string") {
                lastAssistantText = item.text;
              }
            }
          } else if (typeof entry.message.text === "string") {
            lastAssistantText = entry.message.text;
          }
        }
      } catch {}
    }

    if (output > 0) {
      const finishTime = lastAssistantTime || Date.now();
      const startTime = userTimestamp || (turnStartTime && turnStartTime > 0 ? turnStartTime : finishTime - 5_000);
      const durationMs = Math.max(500, finishTime - startTime);
      return { input, output, cached, reasoning, steps, content: lastAssistantText, durationMs,
        modelDurationMs: completeResponseTiming && modelDurationMs > 0 ? modelDurationMs : undefined,
        ttftMs: lastUserIndex >= 0 && firstAssistant && !firstAssistantFailed
          ? matchResponseTiming(responseTimings, firstAssistant)?.ttftMs : undefined };
    }
  } catch {}
  return null;
}

export class PerformanceService {
  private turnStartTimes = new Map<string, number>();
  private lastKnownUsage = new Map<string, { input: number; output: number; cached: number }>();
  private records: RawTurnRecord[] = [];
  private loaded = false;

  private readonly storePath: string;

  constructor(storePath = STORE_PATH) {
    this.storePath = storePath;
    this.load();
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (existsSync(this.storePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.storePath, "utf8"));
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
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.records.slice(-MAX_STORED_RECORDS), null, 2), "utf8");
    } catch {}
  }

  getForkRecord(agentId: string, recordId: string) {
    return this.records.find(record => record.agentId === agentId && record.id === recordId);
  }

  getAgentTurns(agentId: string) {
    return { records: this.records.filter((record) => record.agentId === agentId)
      .map(({ id, agentId: _, ...record }) => ({ ...record, recordId: id })) };
  }

  onTurnStarted(event: PluginLifecycleEvents["agent.turn_started"]) {
    this.turnStartTimes.set(event.agent.id, Date.now());
  }

  async onTurnEnded(
    event: PluginLifecycleEvents["agent.turn_ended"],
    context: PluginHookContext,
  ): Promise<TurnPerformanceData | null> {
    const startTime = this.turnStartTimes.get(event.agent.id) ?? (Date.now() - 5_000);
    this.turnStartTimes.delete(event.agent.id);
    let durationMs = Math.max(500, Date.now() - startTime);

    let modelName = "unknown";
    let providerName = event.agent.provider || "ai";

    let deltaInput = 0;
    let deltaOutput = 0;
    let deltaCached = 0;
    let deltaReasoning = 0;
    let turnSteps = 1;
    let assistantContent = "";
    let modelDurationMs: number | undefined;
    let ttftMs: number | undefined;

    try {
      const agentHandle = context.paseo.agents.ref(event.agent.id);
      const snapshot = await agentHandle.refresh();
      if (snapshot?.agent?.runtimeInfo?.model) {
        modelName = snapshot.agent.runtimeInfo.model;
      }
      if (snapshot?.agent?.runtimeInfo?.provider) {
        providerName = snapshot.agent.runtimeInfo.provider;
      }

      // Method 1: Try reading exact cumulative per-turn assistant messages from native session log
      const nativeUsage = extractTurnUsageFromNativeHandle(
        snapshot?.agent?.persistence?.nativeHandle,
        startTime,
      );

      if (nativeUsage && nativeUsage.output > 0) {
        deltaInput = nativeUsage.input;
        deltaOutput = nativeUsage.output;
        deltaCached = nativeUsage.cached;
        deltaReasoning = nativeUsage.reasoning;
        turnSteps = nativeUsage.steps;
        assistantContent = nativeUsage.content;
        durationMs = nativeUsage.durationMs;
        modelDurationMs = nativeUsage.modelDurationMs;
        ttftMs = nativeUsage.ttftMs;
      } else {
        // Method 2: Fallback to cumulative delta with baseline guard
        const current = snapshot?.agent?.lastUsage;
        if (current) {
          const prev = this.lastKnownUsage.get(event.agent.id);
          if (prev) {
            deltaInput = Math.max(0, (current.inputTokens ?? 0) - prev.input);
            deltaOutput = Math.max(0, (current.outputTokens ?? 0) - prev.output);
            deltaCached = Math.max(0, (current.cachedInputTokens ?? 0) - prev.cached);
          } else {
            // If first observation output is modest (e.g. <= 4096), treat as first turn output;
            // if massive, treat as legacy cumulative baseline to prevent wild 100k+ spikes.
            const totalOut = current.outputTokens ?? 0;
            if (totalOut > 0 && totalOut <= 4096) {
              deltaInput = current.inputTokens ?? 0;
              deltaOutput = totalOut;
              deltaCached = current.cachedInputTokens ?? 0;
            } else {
              deltaInput = 0;
              deltaOutput = 0;
              deltaCached = 0;
            }
          }

          this.lastKnownUsage.set(event.agent.id, {
            input: current.inputTokens ?? 0,
            output: current.outputTokens ?? 0,
            cached: current.cachedInputTokens ?? 0,
          });
        }
      }
    } catch {}

    // Only record and display if output tokens were generated
    if (deltaOutput <= 0) return null;

    const durationSec = durationMs / 1000;
    const tps = Number((deltaOutput / durationSec).toFixed(1));

    const finalReply = [...event.timeline].reverse().find((item) => item.type === "assistant_message" && item.text.trim());
    const perfData: TurnPerformanceData = {
      model: modelName,
      provider: providerName,
      inputTokens: deltaInput,
      outputTokens: deltaOutput,
      cachedTokens: deltaCached,
      reasoningTokens: deltaReasoning || undefined,
      durationMs,
      tps,
      modelDurationMs,
      ttftMs,
      modelTps: modelDurationMs ? Number((deltaOutput / (modelDurationMs / 1000)).toFixed(1)) : undefined,
      timestamp: Date.now(),
      steps: turnSteps,
      content: finalReply?.type === "assistant_message" ? finalReply.text : assistantContent || undefined,
      messageId: finalReply?.type === "assistant_message" ? finalReply.messageId : undefined,
    };

    // 1. Record persistently
    this.records.push({
      id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentId: event.agent.id,
      ...perfData,
    });
    this.save();

    // The reply renderer reads these records by agent; do not append a separate footer row.

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
