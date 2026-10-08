import { Platform } from "react-native";
import { AGENT_NAVIGATION_EVENT, type AgentNavigationTarget } from "../shared/agents.ts";

type WebListener = (event: unknown) => void;
type WebEvents = {
  addEventListener?: (type: string, listener: WebListener, capture?: boolean) => void;
  removeEventListener?: (type: string, listener: WebListener, capture?: boolean) => void;
};

export function watchWebPopoverDismiss(close: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const web = globalThis as WebEvents;
  if (typeof web.addEventListener !== "function" || typeof web.removeEventListener !== "function") return () => {};
  const onPointer: WebListener = (event) => {
    const target = (event as { target?: { closest?: (selector: string) => unknown } })?.target;
    if (!target || target.closest?.("[data-menu-surface='true']")) return;
    close();
  };
  const onBlur: WebListener = () => close();
  const onKey: WebListener = (event) => {
    if ((event as { key?: string })?.key === "Escape") close();
  };
  web.addEventListener("pointerdown", onPointer, true);
  web.addEventListener("blur", onBlur);
  web.addEventListener("keydown", onKey);
  return () => {
    web.removeEventListener?.("pointerdown", onPointer, true);
    web.removeEventListener?.("blur", onBlur);
    web.removeEventListener?.("keydown", onKey);
  };
}

export function dispatchWebAgentTarget(target: AgentNavigationTarget): boolean {
  if (Platform.OS !== "web") return false;
  const g = globalThis as {
    dispatchEvent?: (event: unknown) => boolean;
    CustomEvent?: new (name: string, init: { cancelable: boolean; detail: unknown }) => { defaultPrevented: boolean };
  };
  if (typeof g.dispatchEvent !== "function" || typeof g.CustomEvent !== "function") return false;
  const event = new g.CustomEvent(AGENT_NAVIGATION_EVENT, { cancelable: true, detail: { data: target } });
  g.dispatchEvent(event);
  return event.defaultPrevented;
}
