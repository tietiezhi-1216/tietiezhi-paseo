import type { RemoteAgent } from "./agents.ts";

export type AgentDirectorySnapshot = { agents: RemoteAgent[]; ready: boolean; failed: boolean };
type HostDirectory = {
  rows: Map<string, RemoteAgent>;
  versions: Map<string, number>;
  revision: number;
  snapshot: AgentDirectorySnapshot;
  listeners: Set<() => void>;
};

/**
 * One identity space per Host; list responses cannot undo newer directory events.
 * Keep this class-free: Paseo evaluates client bundles directly, without Metro's
 * class transform, and Hermes can fail when constructing an evaluated class.
 */
export function createAgentDirectory() {
  const hosts = new Map<string, HostDirectory>();
  const listeners = new Set<() => void>();
  let version = 0;

  function getHost(hostId: string): HostDirectory {
    let host = hosts.get(hostId);
    if (!host) {
      host = { rows: new Map(), versions: new Map(), revision: 0, snapshot: { agents: [], ready: false, failed: false }, listeners: new Set() };
      hosts.set(hostId, host);
    }
    return host;
  }

  function get(hostId: string): AgentDirectorySnapshot { return getHost(hostId).snapshot; }
  function revision(hostId: string): number { return getHost(hostId).revision; }
  function subscribe(hostId: string, listener: () => void): () => void {
    const host = getHost(hostId);
    host.listeners.add(listener);
    return () => { host.listeners.delete(listener); };
  }

  function publish(host: HostDirectory, ready = host.snapshot.ready, failed = host.snapshot.failed): void {
    host.snapshot = { agents: [...host.rows.values()], ready, failed };
    version++;
    for (const listener of host.listeners) listener();
    for (const listener of listeners) listener();
  }

  function upsert(hostId: string, agent: RemoteAgent): void {
    const host = getHost(hostId);
    host.versions.set(agent.id, ++host.revision);
    if (agent.parentAgentId) host.rows.delete(agent.id);
    else host.rows.set(agent.id, { ...agent, hostId, serverId: hostId });
    publish(host);
  }

  function patch(hostId: string, id: string, patch: Partial<RemoteAgent>): void {
    const existing = getHost(hostId).rows.get(id);
    if (existing) upsert(hostId, { ...existing, ...patch, id });
  }

  function archive(hostId: string, id: string, now = new Date().toISOString()): void {
    const host = getHost(hostId);
    const existing = host.rows.get(id);
    // Remember removals even before the first list finishes.
    host.versions.set(id, ++host.revision);
    if (existing) host.rows.set(id, { ...existing, archivedAt: existing.archivedAt ?? now });
    publish(host);
  }

  function replace(hostId: string, agents: RemoteAgent[], startedAtRevision = revision(hostId)): void {
    const host = getHost(hostId);
    const seen = new Set(agents.map((agent) => agent.id));
    for (const [id, existing] of host.rows) {
      if (!seen.has(id) && !existing.archivedAt && (host.versions.get(id) ?? 0) <= startedAtRevision) host.rows.delete(id);
    }
    for (const agent of agents) {
      if ((host.versions.get(agent.id) ?? 0) > startedAtRevision) continue;
      if (agent.parentAgentId) host.rows.delete(agent.id);
      else host.rows.set(agent.id, { ...agent, hostId, serverId: hostId });
    }
    publish(host, true, false);
  }

  function fail(hostId: string): void { publish(getHost(hostId), true, true); }

  return {
    get, revision, subscribe, upsert, patch, archive, replace, fail,
    getVersion: (): number => version,
    subscribeAll: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type AgentDirectory = ReturnType<typeof createAgentDirectory>;
