import { agentDisplaySection, combineOwnedAgents, type RemoteAgent } from "./agents.ts";

export type PillColorKind = "success" | "failure" | "running" | "unknown";

export function formatAgentsPillLabel(name: string, state: Pick<ReturnType<typeof agentsPillState>, "label">): string {
  const clean = name.trim();
  let short = "", width = 0;
  for (const character of clean) {
    const nextWidth = character.codePointAt(0)! > 127 ? 2 : 1;
    if (width + nextWidth > 12) { short += "…"; break; }
    width += nextWidth;
    short += character;
  }
  return short ? `${short} · ${state.label}` : state.label;
}

export function agentsPillState(
  agents: readonly RemoteAgent[] | undefined,
  pending: boolean,
  failed: boolean,
): { label: string; colorKind: PillColorKind } {
  if (pending && (!agents || agents.length === 0)) return { label: "loading", colorKind: "unknown" };
  if (failed) return { label: "offline", colorKind: "failure" };
  // Completed agents need attention even while other agents keep working.
  const done = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "done").length;
  if (done > 0) return { label: `done · ${done}`, colorKind: "success" };
  const error = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "error").length;
  if (error > 0) return { label: `error · ${error}`, colorKind: "failure" };
  const working = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "working").length;
  if (working > 0) return { label: `working · ${working}`, colorKind: "running" };
  const idle = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "idle").length;
  if (idle > 0) return { label: `idle · ${idle}`, colorKind: "unknown" };
  const closed = (agents ?? []).filter((agent) => agentDisplaySection(agent) === "closed").length;
  if (closed > 0) return { label: `closed · ${closed}`, colorKind: "unknown" };
  return { label: `idle · ${(agents ?? []).filter((agent) => agentDisplaySection(agent) === "idle").length}`, colorKind: "unknown" };
}

/** Live connected Hosts override configured snapshots; Host + Agent ID defines identity. */
export function combineAgentSources(local: RemoteAgent[], connected: RemoteAgent[], configured: RemoteAgent[], hostId: string): RemoteAgent[] {
  const key = (agent: RemoteAgent) => JSON.stringify([agent.serverId ?? agent.hostId, agent.id]);
  const connectedKeys = new Set(connected.map(key));
  return combineOwnedAgents(local, [
    ...connected,
    ...configured.filter((agent) => !connectedKeys.has(key(agent))),
  ], hostId);
}
