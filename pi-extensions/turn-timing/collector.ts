import { isResponseTiming, type ResponseTiming } from "../../shared/response-timing.ts";

export interface TimingMessage {
  role: string;
  timestamp?: number;
  provider?: string;
  api?: string;
  model?: string;
  responseId?: string;
  stopReason?: string;
}
export interface TimingDelta { type: string; delta?: string }

/** One collector per Pi runtime. Only primary assistant message events are accepted. */
export class ResponseTimingCollector {
  private active = false;
  private startedAt: number | undefined;
  private first: { ttftMs: number; kind: ResponseTiming["firstDelta"]; timestamp: number } | undefined;
  private attempts = 0;
  private completed: ResponseTiming | undefined;
  private readonly now: () => number;
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  reset() {
    this.active = false;
    this.startedAt = undefined;
    this.first = undefined;
    this.attempts = 0;
    this.completed = undefined;
  }
  beginTurn() { this.reset(); this.active = true; }
  requestStarted() {
    if (!this.active || this.first) return;
    // Repeated payload hooks before output are retries of this assistant call.
    // Keep the original start so TTFT includes retry delay, not just the last attempt.
    this.startedAt ??= this.now();
    this.attempts++;
  }
  delta(message: TimingMessage, event: TimingDelta) {
    if (!this.active || this.startedAt === undefined || this.first || message.role !== "assistant") return;
    if (!["text_delta", "thinking_delta", "toolcall_delta"].includes(event.type)
      || typeof event.delta !== "string" || event.delta.length === 0 || typeof message.timestamp !== "number") return;
    const elapsed = this.now() - this.startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.first = { ttftMs: Math.round(elapsed * 100) / 100, kind: event.type as ResponseTiming["firstDelta"], timestamp: message.timestamp };
  }
  endMessage(message: TimingMessage) {
    if (message.role !== "assistant") return;
    if (this.active && this.first && message.timestamp === this.first.timestamp
      && message.stopReason !== "error" && message.stopReason !== "aborted") {
      const candidate = { version: 1, source: "provider-request-to-first-delta", timestamp: message.timestamp,
        provider: message.provider, api: message.api, model: message.model,
        responseId: message.responseId, ttftMs: this.first.ttftMs,
        firstDelta: this.first.kind, requestAttempts: this.attempts };
      if (isResponseTiming(candidate)) this.completed = candidate;
    }
    this.active = false;
    this.startedAt = undefined;
    this.first = undefined;
  }
  finishTurn(): ResponseTiming | undefined {
    const result = this.completed;
    this.reset();
    return result;
  }
}
