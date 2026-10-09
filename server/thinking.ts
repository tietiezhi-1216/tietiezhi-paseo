import type { PaseoApi, PaseoAgentTimelineEvent } from "@getpaseo/client";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { boundedThinking, type TurnThinkingData } from "../shared/thinking.ts";

type Timeline = ReturnType<PaseoApi["agents"]["ref"]>["timeline"];
type Page = Awaited<ReturnType<Timeline["refetch"]>>;

/** Group projected reasoning fragments, ignoring this plugin's own status updates. */
export function turnThoughts(page: Page, turnId: string | null, startedAt: number) {
  const records: TurnThinkingData["records"] = [];
  let previousWasThought = false;
  for (const entry of page.entries) {
    // Appended plugin rows need not carry a native turnId. Their updates must
    // not split the provider's incremental reasoning fragments.
    if (entry.item.type === "plugin" && entry.item.kind === "turn-thinking") continue;
    const matches = turnId !== null ? entry.turnId === turnId : Date.parse(entry.timestamp) >= startedAt;
    if (!matches) { previousWasThought = false; continue; }
    if (entry.item.type === "reasoning") {
      if (previousWasThought) records[records.length - 1].text += entry.item.text;
      else records.push({ id: `${page.epoch}:${entry.seqStart}`, text: entry.item.text });
      previousWasThought = true;
    } else previousWasThought = false;
  }
  return records.filter(record => record.text.trim());
}

interface Observation {
  turnId: string | null;
  startedAt: number;
  rowId: string;
  timeline: Timeline;
  records: Map<string, { id: string; text: string }>;
  phase: TurnThinkingData["phase"];
  activity: TurnThinkingData["activity"];
  ended: boolean;
  closed: boolean;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: ReturnType<Timeline["subscribe"]>;
  pending?: Promise<void>;
  lastData?: string;
  truncated: boolean;
  epoch?: string;
  hasLiveActivity: boolean;
  generation: number;
}

/** One stable plugin row per turn, not one replacement row per reasoning event. */
export class ThinkingTimelineService {
  private readonly observations = new Map<string, Observation>();
  private stopped = false;
  private readonly debounceMs: number;
  constructor(debounceMs = 600) { this.debounceMs = debounceMs; }

  start(event: PluginLifecycleEvents["agent.turn_started"], context: Pick<PluginHookContext, "paseo">, startedAt = Date.now()) {
    if (this.stopped) return;
    const previous = this.observations.get(event.agent.id);
    if (previous && previous.turnId === event.turnId) return;
    if (previous) this.close(previous);
    const observation: Observation = {
      turnId: event.turnId, startedAt, rowId: `thinking-${event.turnId ?? crypto.randomUUID()}`,
      timeline: context.paseo.agents.ref(event.agent.id).timeline, records: new Map(),
      phase: "active", activity: "working", ended: false, closed: false, dirty: false, truncated: false, hasLiveActivity: false, generation: 0,
    };
    this.observations.set(event.agent.id, observation);
    try {
      observation.unsubscribe = observation.timeline.subscribe(message => this.onEvent(event.agent.id, observation, message));
      void observation.unsubscribe.ready.then(() => this.refresh(observation)).catch(() => {
        console.error("tietiezhi: inline thinking subscription unavailable");
      });
    } catch {
      console.error("tietiezhi: inline thinking could not observe this turn");
    }
  }

  async initialize(agentId: string, paseo: PaseoApi) {
    try {
      const snapshot = await paseo.agents.ref(agentId).refresh();
      const agent = snapshot?.agent;
      if (!agent?.activeTurn || this.stopped) return { attached: false };
      const startedAt = Date.parse(agent.activeTurn.startedAt ?? "");
      this.start({ agent: { id: agent.id, workspaceId: agent.workspaceId ?? null, parentAgentId: null,
        provider: agent.provider, cwd: agent.cwd, title: agent.title ?? null }, turnId: agent.activeTurn.turnId },
        { paseo }, Number.isFinite(startedAt) ? startedAt : Date.now());
      return { attached: this.observations.has(agentId) };
    } catch { return { attached: false }; }
  }

  private onEvent(agentId: string, state: Observation, message: PaseoAgentTimelineEvent) {
    if (state.closed || state.ended || message.agentId !== agentId) return;
    const event = message.event;
    if (event.type === "replacement" || event.type === "subscription_restored") {
      state.generation++;
      state.records.clear(); state.lastData = undefined; state.hasLiveActivity = false;
      state.epoch = event.type === "replacement" ? event.epoch : undefined;
      if (state.pending) state.dirty = true;
      this.schedule(state); return;
    }
    if (event.type === "error") { void this.stopAgent(agentId); return; }
    if ("epoch" in message && message.epoch && state.epoch && message.epoch !== state.epoch) return;
    if (event.type !== "timeline") return;
    if (event.turnId && state.turnId && event.turnId !== state.turnId) return;
    if (event.item.type === "reasoning") {
      state.hasLiveActivity = true;
      state.activity = "thinking";
      this.schedule(state);
    } else if (event.item.type === "tool_call" || event.item.type === "assistant_message") {
      const wasThinking = state.activity === "thinking";
      state.hasLiveActivity = true;
      state.activity = "working";
      if (wasThinking) this.schedule(state);
    }
  }

  private schedule(state: Observation) {
    if (state.closed || state.ended || state.timer) return;
    state.timer = setTimeout(() => { state.timer = undefined; void this.refresh(state); }, this.debounceMs);
  }

  private refresh(state: Observation): Promise<void> {
    if (state.closed || this.stopped) return Promise.resolve();
    if (state.pending) { state.dirty = true; return state.pending; }
    const generation = state.generation;
    state.pending = (async () => {
      try {
        const page = await state.timeline.refetch({ direction: "tail", projection: "projected", limit: 200 });
        if (state.closed || this.stopped || generation !== state.generation) return;
        if (page.error) throw new Error("timeline unavailable");
        if (state.epoch && state.epoch !== page.epoch) state.records.clear();
        state.epoch = page.epoch;
        if (state.phase === "active" && !state.hasLiveActivity) {
          const last = [...page.entries].reverse().find(entry => entry.turnId === state.turnId && entry.item.type !== "plugin");
          state.activity = last?.item.type === "reasoning" ? "thinking" : "working";
        }
        for (const record of turnThoughts(page, state.turnId, state.startedAt)) {
          if (record.text.length > 12000) state.truncated = true;
          state.records.set(record.id, { ...record, text: record.text.slice(0, 12000) });
        }
        // Bound server memory independently of the serialized UI preview.
        while (state.records.size > 24) { state.records.delete(state.records.keys().next().value!); state.truncated = true; }
        await this.write(state);
      } catch {
        if (!state.closed && !this.stopped) console.error("tietiezhi: inline thinking update unavailable");
      }
    })().finally(() => {
      state.pending = undefined;
      if (state.dirty && !state.closed && !state.ended) { state.dirty = false; this.schedule(state); }
    });
    return state.pending;
  }

  private async write(state: Observation) {
    if (state.closed || this.stopped || !state.records.size) return;
    const data = boundedThinking({ turnId: state.turnId ?? state.rowId, phase: state.phase,
      activity: state.activity, records: [...state.records.values()], truncated: state.truncated });
    const serialized = JSON.stringify(data);
    if (serialized === state.lastData) return;
    await state.timeline.append({ type: "plugin", id: state.rowId, kind: "turn-thinking", version: 1, data });
    state.lastData = serialized;
  }

  async finish(event: PluginLifecycleEvents["agent.turn_ended"]) {
    const state = this.observations.get(event.agent.id);
    if (!state || state.turnId !== event.turnId) return;
    await this.complete(event.agent.id, state);
  }

  private async complete(agentId: string, state: Observation) {
    state.ended = true; state.phase = "complete"; state.activity = "idle";
    if (state.timer) { clearTimeout(state.timer); state.timer = undefined; }
    await this.releaseSubscription(state);
    await state.pending;
    await this.refresh(state);
    // Even if the final read fails, stop the saved row's animation using the
    // last known real thought. Never invent a successful final result.
    try { await this.write(state); } catch { /* Retain the original transcript. */ }
    this.close(state);
    if (this.observations.get(agentId) === state) this.observations.delete(agentId);
  }

  private releaseSubscription(state: Observation): Promise<void> {
    const subscription = state.unsubscribe;
    state.unsubscribe = undefined;
    // Use the SDK-owned release method so its observation registry is pruned,
    // not only the legacy callable unsubscribe shim.
    return subscription ? subscription.release().catch(() => {}) : Promise.resolve();
  }
  private close(state: Observation) {
    state.closed = true;
    if (state.timer) clearTimeout(state.timer);
    void this.releaseSubscription(state);
    state.records.clear();
  }
  async stopAgent(agentId: string) {
    const state = this.observations.get(agentId);
    if (state) await this.complete(agentId, state);
  }
  dispose() {
    this.stopped = true;
    for (const state of this.observations.values()) this.close(state);
    this.observations.clear();
  }
}
