import type { RemoteAgent } from "./agents.ts";

export type AgentDirectorySnapshot = { agents: RemoteAgent[]; ready: boolean; failed: boolean };
type HostDirectory = {
  rows: Map<string, RemoteAgent>;
  versions: Map<string, number>;
  revision: number;
  snapshot: AgentDirectorySnapshot;
  listeners: Set<() => void>;
};

/** One identity space per Host; list responses cannot undo newer directory events. */
export class AgentDirectory {
  private hosts = new Map<string, HostDirectory>();
  private listeners = new Set<() => void>();
  private version = 0;

  getVersion = (): number => this.version;
  subscribeAll = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private host(hostId: string): HostDirectory {
    let host = this.hosts.get(hostId);
    if (!host) {
      host = { rows: new Map(), versions: new Map(), revision: 0, snapshot: { agents: [], ready: false, failed: false }, listeners: new Set() };
      this.hosts.set(hostId, host);
    }
    return host;
  }

  get(hostId: string): AgentDirectorySnapshot { return this.host(hostId).snapshot; }
  revision(hostId: string): number { return this.host(hostId).revision; }
  subscribe(hostId: string, listener: () => void): () => void {
    const host = this.host(hostId);
    host.listeners.add(listener);
    return () => { host.listeners.delete(listener); };
  }

  private publish(host: HostDirectory, ready = host.snapshot.ready, failed = host.snapshot.failed): void {
    host.snapshot = { agents: [...host.rows.values()], ready, failed };
    this.version++;
    for (const listener of host.listeners) listener();
    for (const listener of this.listeners) listener();
  }

  upsert(hostId: string, agent: RemoteAgent): void {
    const host = this.host(hostId);
    host.versions.set(agent.id, ++host.revision);
    if (agent.parentAgentId) host.rows.delete(agent.id);
    else host.rows.set(agent.id, { ...agent, hostId, serverId: hostId });
    this.publish(host);
  }

  patch(hostId: string, id: string, patch: Partial<RemoteAgent>): void {
    const existing = this.host(hostId).rows.get(id);
    if (existing) this.upsert(hostId, { ...existing, ...patch, id });
  }

  archive(hostId: string, id: string, now = new Date().toISOString()): void {
    const host = this.host(hostId);
    const existing = host.rows.get(id);
    // Remember removals even before the first list finishes.
    host.versions.set(id, ++host.revision);
    if (existing) host.rows.set(id, { ...existing, archivedAt: existing.archivedAt ?? now });
    this.publish(host);
  }

  replace(hostId: string, agents: RemoteAgent[], startedAtRevision = this.revision(hostId)): void {
    const host = this.host(hostId);
    const seen = new Set(agents.map((agent) => agent.id));
    for (const [id, existing] of host.rows) {
      if (!seen.has(id) && !existing.archivedAt && (host.versions.get(id) ?? 0) <= startedAtRevision) host.rows.delete(id);
    }
    for (const agent of agents) {
      if ((host.versions.get(agent.id) ?? 0) > startedAtRevision) continue;
      if (agent.parentAgentId) host.rows.delete(agent.id);
      else host.rows.set(agent.id, { ...agent, hostId, serverId: hostId });
    }
    this.publish(host, true, false);
  }

  fail(hostId: string): void { this.publish(this.host(hostId), true, true); }
}
