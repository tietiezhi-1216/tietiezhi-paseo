import { agentDisplaySection, type RemoteAgent } from "./agents.ts";

export type PillColorKind = "success" | "failure" | "running" | "unknown";

export function agentsPillState(
  agents: readonly RemoteAgent[] | undefined,
  pending: boolean,
  failed: boolean,
): { label: string; colorKind: PillColorKind } {
  if (!agents && pending) return { label: "loading", colorKind: "unknown" };
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
  return { label: `idle · ${(agents ?? []).length}`, colorKind: "unknown" };
}
