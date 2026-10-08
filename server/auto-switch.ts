import type { PluginLifecycleEvents, PluginHookContext } from "@getpaseo/plugin/server";
import { AccountService } from "./accounts.ts";
import type { Family } from "../shared/accounts.ts";

export function isQuotaExhausted(outcome: PluginLifecycleEvents["agent.turn_ended"]["outcome"], timeline: readonly any[]): boolean {
  const errorText = outcome.kind === "failed" ? `${outcome.error?.code || ""} ${outcome.error?.message || ""}` : "";
  const lastItems = timeline.slice(-5);
  const timelineText = lastItems.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      return `${item.error || ""} ${item.message || ""} ${item.content || ""} ${item.text || ""} ${JSON.stringify(item.data || {})}`;
    }
    return "";
  }).join(" ");
  const combined = (errorText + " " + timelineText).toLowerCase();

  return /429|quota|rate.?limit|exhausted|resource_exhausted|insufficient_quota|out of credits|overloaded|capacity|额度已耗尽|额度超限|频率限制|配额不足/i.test(combined);
}

export function detectExhaustedFamily(errorText: string, currentFamily?: Family): Family {
  if (/antigravity|gemini|claude/i.test(errorText)) return "antigravity";
  if (/codex|openai|chatgpt|gpt/i.test(errorText)) return "codex";
  if (/xai|grok/i.test(errorText)) return "xai";
  if (currentFamily && currentFamily !== "go") return currentFamily;
  return "antigravity";
}

const recentSwitches = new Map<string, number>();

export async function handleAgentTurnEnded(
  event: PluginLifecycleEvents["agent.turn_ended"],
  context: PluginHookContext,
  accountService: AccountService = new AccountService()
) {
  const lastSwitch = recentSwitches.get(event.agent.id) ?? 0;
  if (Date.now() - lastSwitch < 10_000) return;

  if (!isQuotaExhausted(event.outcome, event.timeline)) return;

  const errorDetail = `${event.outcome.kind === "failed" ? event.outcome.error?.message || "" : ""} ${JSON.stringify(event.timeline.slice(-3))}`;
  const registry = await accountService.list();
  const currentActive = registry.accounts.find((a) => a.active);
  const targetFamily = detectExhaustedFamily(errorDetail, currentActive?.family);

  const switchResult = await accountService.autoSwitchNextAccount(targetFamily);
  if (!switchResult) return;

  recentSwitches.set(event.agent.id, Date.now());

  const notification = `[模型额度] 额度已耗尽，已自动切至 ${switchResult.next.label}，正在继续会话...`;
  console.log(`[AUTO-SWITCH] ${event.agent.id} exhausted, switched from ${switchResult.previous.label} to ${switchResult.next.label}`);

  // 1. Append timeline row
  try {
    await context.paseo.agents.ref(event.agent.id).timeline.append({
      type: "plugin",
      id: `quota-switch-${Date.now()}`,
      kind: "quota-notice",
      version: 1,
      data: { message: notification },
    });
  } catch {}

  // 2. Send continuation prompt to resume conversation
  try {
    await context.paseo.agents.ref(event.agent.id).send(notification);
  } catch (err) {
    console.error(`[AUTO-SWITCH] Failed to send continuation message to ${event.agent.id}:`, err);
  }
}
