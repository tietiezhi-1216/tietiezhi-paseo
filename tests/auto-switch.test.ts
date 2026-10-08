import assert from "node:assert/strict";
import { test } from "node:test";
import { isQuotaExhausted, detectExhaustedFamily } from "../server/auto-switch.ts";

test("isQuotaExhausted detects 429 and rate limit errors", () => {
  assert.equal(isQuotaExhausted({ kind: "failed", error: { message: "HTTP 429 Too Many Requests" } }, []), true);
  assert.equal(isQuotaExhausted({ kind: "failed", error: { message: "rate_limit_exceeded: quota is depleted" } }, []), true);
  assert.equal(isQuotaExhausted({ kind: "failed", error: { message: "RESOURCE_EXHAUSTED: You have exceeded your current quota" } }, []), true);
  assert.equal(isQuotaExhausted({ kind: "completed" }, [{ type: "error", error: "Rate limit reached, please try again later" }]), true);
  assert.equal(isQuotaExhausted({ kind: "completed" }, [{ isError: true, message: "429: quota is depleted" }]), true);
  assert.equal(isQuotaExhausted({ kind: "completed" }, [{ type: "assistant_message", text: "谈到额度已耗尽的话题" }]), false);
  assert.equal(isQuotaExhausted({ kind: "completed" }, []), false);
  assert.equal(isQuotaExhausted({ kind: "failed", error: { message: "File not found" } }, []), false);
});

test("detectExhaustedFamily maps error strings to correct provider family", () => {
  assert.equal(detectExhaustedFamily("Gemini 2.5 Flash quota exceeded"), "antigravity");
  assert.equal(detectExhaustedFamily("Antigravity code assist 429"), "antigravity");
  assert.equal(detectExhaustedFamily("ChatGPT wham rate_limit_exceeded"), "codex");
  assert.equal(detectExhaustedFamily("OpenAI Codex quota limit"), "codex");
  assert.equal(detectExhaustedFamily("Grok xAI credits exhausted"), "xai");
  assert.equal(detectExhaustedFamily("Unknown error", "codex"), "codex");
});
