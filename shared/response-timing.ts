/** Non-context Pi session metadata. No prompts, deltas, headers or credentials. */
export const RESPONSE_TIMING_ENTRY = "tietiezhi.response-timing";
export interface ResponseIdentity {
  timestamp: number;
  provider: string;
  api: string;
  model: string;
  responseId?: string;
}
export interface ResponseTiming extends ResponseIdentity {
  version: 1;
  source: "provider-request-to-first-delta";
  ttftMs: number;
  firstDelta: "text_delta" | "thinking_delta" | "toolcall_delta";
  requestAttempts: number;
}

export function isResponseTiming(value: unknown): value is ResponseTiming {
  if (!value || typeof value !== "object") return false;
  const r = value as ResponseTiming;
  return r.version === 1 && r.source === "provider-request-to-first-delta"
    && typeof r.timestamp === "number" && Number.isFinite(r.timestamp) && r.timestamp > 0
    && [r.provider, r.api, r.model].every(v => typeof v === "string" && v.length > 0)
    && (r.responseId === undefined || typeof r.responseId === "string")
    && Number.isFinite(r.ttftMs) && r.ttftMs >= 0
    && ["text_delta", "thinking_delta", "toolcall_delta"].includes(r.firstDelta)
    && Number.isSafeInteger(r.requestAttempts) && r.requestAttempts >= 1;
}

/** Exact first-response match; never substitute a later call or duplicate metadata. */
export function matchResponseTiming(records: ResponseTiming[], response: ResponseIdentity): ResponseTiming | undefined {
  const matches = records.filter(r => r.timestamp === response.timestamp && r.provider === response.provider
    && r.api === response.api && r.model === response.model && r.responseId === response.responseId);
  return matches.length === 1 ? matches[0] : undefined;
}
