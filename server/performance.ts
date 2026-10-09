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
  nativeHandle: string | null | undefined,
  turnStartTime: number,
  turnEndTime: number,
): { input: number; output: number; cached: number; reasoning: number; steps: number; content: string; durationMs: number; modelDurationMs?: number; ttftMs?: number } | null {
  if (!nativeHandle || !existsSync(nativeHandle)) return null;
  try {
    const rawContent = readFileSync(nativeHandle, "utf8");
    let entries = rawContent.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    if (!entries.length || entries.some(entry => !entry || typeof entry !== "object")) return null;

    // Pi sessions are trees. Only follow the newest entry's ancestry, never
    // sum abandoned sibling branches. Flat transcripts remain supported.
    if (entries.some(entry => Object.hasOwn(entry, "parentId"))) {
      const byId = new Map<string, typeof entries[number]>();
      for (const entry of entries) {
        if (typeof entry.id !== "string") continue;
        const previous = byId.get(entry.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) return null;
        byId.set(entry.id, entry);
      }
      const branch = [];
      const visited = new Set<string>();
      let entry = entries.at(-1);
      while (entry) {
        if (typeof entry.id !== "string" || visited.has(entry.id)) return null;
        visited.add(entry.id);
        branch.push(entry);
        if (entry.parentId === null) break;
        if (typeof entry.parentId !== "string" || !byId.has(entry.parentId)) return null;
        entry = byId.get(entry.parentId);
      }
      entries = branch.reverse();
    }
    // Bound by the observed Paseo turn, not the latest user message: a
    // continuation may have no new user entry; steering may add several.
    const seenResponses = new Map<string, string>();
    const seenEntries = new Map<string, string>();
    let input = 0;
    let output = 0;
    let cached = 0;
    let reasoning = 0;
    let steps = 0;
    let lastAssistantText = "";
    let modelDurationMs = 0;
    let completeResponseTiming = true;
    let firstAssistant: ResponseIdentity | undefined;
    let firstAssistantFailed = false;
    const responseTimings: ResponseTiming[] = [];

    for (const entry of entries) {
      try {
        if (entry.type === "custom" && entry.customType === RESPONSE_TIMING_ENTRY && isResponseTiming(entry.data)) {
          responseTimings.push(entry.data);
        }
        if (entry.type === "message" && entry.message?.role === "assistant") {
          const at = Date.parse(entry.timestamp);
          if (!Number.isFinite(at)) return null;
          if (at < turnStartTime) continue;
          // Later responses mean the file advanced beyond this ended turn.
          if (at > turnEndTime) return null;
          const m = entry.message;
          // Message timestamps mark request start in Pi; persisted entry time
          // alone can include a response that began before this live turn.
          if (typeof m.timestamp === "number" && m.timestamp < turnStartTime) continue;
          const responseKey = typeof m.responseId === "string" && m.responseId
            ? JSON.stringify([m.provider, m.api, m.model, m.responseId]) : undefined;
          const signature = JSON.stringify(m);
          const entryDuplicate = typeof entry.id === "string" ? seenEntries.get(entry.id) : undefined;
          const responseDuplicate = responseKey ? seenResponses.get(responseKey) : undefined;
          if ((entryDuplicate !== undefined && entryDuplicate !== signature)
            || (responseDuplicate !== undefined && responseDuplicate !== signature)) return null;
          if (entryDuplicate !== undefined || responseDuplicate !== undefined) continue;
          if (typeof entry.id === "string") seenEntries.set(entry.id, signature);
          if (responseKey) seenResponses.set(responseKey, signature);
          const usage = m.usage;
          const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
          if (!usage || !count(usage.output) || !count(usage.input ?? 0) || !count(usage.cacheRead ?? 0)
            || !count(usage.reasoning ?? usage.reasoningTokens ?? 0)) return null;
          if (m.stopReason === "error" || m.stopReason === "aborted") completeResponseTiming = false;
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
            reasoning += (u.reasoning ?? u.reasoningTokens ?? 0);
          }
          // Extract text for clipboard copying
          const contentItems = entry.message.content;
          if (Array.isArray(contentItems)) {
            lastAssistantText = contentItems.filter(item => item?.type === "text" && typeof item.text === "string")
              .map(item => item.text).join("\n");
          } else if (typeof entry.message.text === "string") {
            lastAssistantText = entry.message.text;
          }
        }
      } catch { return null; }
    }

    if (output > 0) {
      const durationMs = turnEndTime - turnStartTime;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || turnStartTime <= 0) return null;
      return { input, output, cached, reasoning, steps, content: lastAssistantText, durationMs,
        modelDurationMs: completeResponseTiming && Number.isFinite(modelDurationMs) && modelDurationMs > 0 ? modelDurationMs : undefined,
        ttftMs: firstAssistant && !firstAssistantFailed
          ? matchResponseTiming(responseTimings, firstAssistant)?.ttftMs : undefined };
    }
  } catch {}
  return null;
}

export class PerformanceService {
  private turnStartTimes = new Map<string, number>();
  private turnIds = new Map<string, string | null>();
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
    this.turnIds.set(event.agent.id, event.turnId);
  }

  async onTurnEnded(
    event: PluginLifecycleEvents["agent.turn_ended"],
    context: PluginHookContext,
  ): Promise<TurnPerformanceData | null> {
    if (this.turnIds.has(event.agent.id) && this.turnIds.get(event.agent.id) !== event.turnId) return null;
    const endTime = Date.now();
    const startTime = this.turnStartTimes.get(event.agent.id);
    // Reloads and missed starts have no trustworthy live-turn boundary.
    if (startTime === undefined) return null;
    this.turnStartTimes.delete(event.agent.id);
    this.turnIds.delete(event.agent.id);
    let durationMs = 0;
    const finalReply = [...event.timeline].reverse().find((item) => item.type === "assistant_message" && item.text.trim());
    const alreadyRecorded = () => finalReply?.type === "assistant_message" && finalReply.messageId
      && this.records.some(record => record.agentId === event.agent.id && record.messageId === finalReply.messageId);
    if (alreadyRecorded()) return null;

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

      // Read attributed assistant usage from the native session's active branch.
      const nativeUsage = extractTurnUsageFromNativeHandle(
        snapshot?.agent?.persistence?.nativeHandle,
        startTime,
        endTime,
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
        // lastUsage is not a portable cumulative counter. Without attributed
        // native messages, subtraction or a token-size threshold invents usage.
        return null;
      }
    } catch {}

    // Reject uncertain attribution rather than attaching the latest native
    // response to a different Paseo reply after a continuation/session switch.
    if (deltaOutput <= 0 || !Number.isSafeInteger(deltaOutput)
      || !Number.isSafeInteger(deltaInput) || !Number.isSafeInteger(deltaCached)
      || !Number.isFinite(durationMs) || durationMs <= 0
      || (finalReply?.type === "assistant_message" && finalReply.text.trim() !== assistantContent.trim())) return null;

    const durationSec = durationMs / 1000;
    const tps = Number((deltaOutput / durationSec).toFixed(1));

    // Recheck after refresh: concurrent/replayed end hooks must not duplicate rows.
    if (alreadyRecorded()) return null;
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
