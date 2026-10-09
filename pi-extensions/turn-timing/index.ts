import { RESPONSE_TIMING_ENTRY, type ResponseTiming } from "../../shared/response-timing.ts";
import { ResponseTimingCollector, type TimingDelta, type TimingMessage } from "./collector.ts";

/** Structural subset of Pi's ExtensionAPI: no bundled copy of Pi's runtime. */
export interface TimingExtensionAPI {
  on(event: "turn_start" | "turn_end" | "agent_end" | "session_start" | "session_switch" | "session_fork" | "session_shutdown", handler: () => void): unknown;
  on(event: "before_provider_request", handler: () => void): unknown;
  on(event: "message_update", handler: (event: { message: TimingMessage; assistantMessageEvent: TimingDelta }) => void): unknown;
  on(event: "message_end", handler: (event: { message: TimingMessage }) => void): unknown;
  appendEntry<T>(customType: string, data?: T): void;
}

export default function turnTiming(pi: TimingExtensionAPI) {
  const collector = new ResponseTimingCollector();
  pi.on("turn_start", () => collector.beginTurn());
  pi.on("before_provider_request", () => { collector.requestStarted(); });
  pi.on("message_update", e => collector.delta(e.message, e.assistantMessageEvent));
  pi.on("message_end", e => collector.endMessage(e.message));
  pi.on("turn_end", () => {
    const timing = collector.finishTurn();
    if (timing) pi.appendEntry<ResponseTiming>(RESPONSE_TIMING_ENTRY, timing);
  });
  for (const event of ["agent_end", "session_start", "session_switch", "session_fork", "session_shutdown"] as const) {
    pi.on(event, () => collector.reset());
  }
}
