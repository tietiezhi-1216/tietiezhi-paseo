import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { AssistantReplySchema, matchReplyPerformance, type TurnPerformanceData } from "../shared/performance.ts";

const record: TurnPerformanceData = { model: "model", provider: "pi", inputTokens: 10, outputTokens: 20, cachedTokens: 0, durationMs: 1000, tps: 20, timestamp: 1000, content: "Reply", messageId: "reply-1" };

test("reply performance matches identity, not another turn's identical text", () => {
  assert.equal(matchReplyPerformance([record], { text: "Reply", messageId: "reply-2", phase: "complete" }), undefined);
  assert.equal(matchReplyPerformance([record], { text: "Changed text", messageId: "reply-1", phase: "complete" }), record);
});
test("legacy text matching refuses ambiguous repeated replies", () => {
  assert.equal(matchReplyPerformance([record], { text: "Reply", phase: "complete" }), record);
  assert.equal(matchReplyPerformance([record, { ...record, messageId: "reply-2" }], { text: "Reply", phase: "complete" }), undefined);
  assert.equal(matchReplyPerformance([record], { text: "Other reply", phase: "complete" }), undefined);
});
test("streaming reply schema preserves accumulated paragraphs", () => {
  const text = "First paragraph\n\nSecond paragraph\n```ts\nconst n = 1;\n```";
  assert.equal(AssistantReplySchema.parse({ text, phase: "streaming" }).text, text);
});
test("unified renderer never hides or reparents host nodes", () => {
  const source = readFileSync(new URL("../client/assistant-reply.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /document\.|appendChild|removeChild|MutationObserver|display:\s*["']none/);
  assert.match(source, /copyText\(text\)/);
  assert.match(source, /ScrollView horizontal testID="tietiezhi-reply-footer"/);
});
