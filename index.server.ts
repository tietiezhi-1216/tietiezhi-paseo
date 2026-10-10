import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PiManager } from "./server/pi-manager.ts";
import { piInventory, piPackageChange } from "./shared/pi-manager.ts";
import { AccountService } from "./server/accounts.ts";
import { listAccounts, switchAccount, deleteAccount } from "./shared/accounts.ts";
import { getQuota } from "./shared/quota.ts";
import { QuotaService } from "./server/quota.ts";
import { LoginService } from "./server/login.ts";
import { startLogin, loginStatus, cancelLogin } from "./shared/login.ts";
import { handleAgentActivity, reloadRemoteAgent, archiveRemoteAgent, unarchiveRemoteAgent, closeRemoteAgentClients } from "./server/agents.ts";
import { handleAgentTurnEnded } from "./server/auto-switch.ts";
import { agentActivity, agentReload, agentArchive, agentUnarchive } from "./shared/agents.ts";
import { PerformanceService } from "./server/performance.ts";
import { getModelPerformance, getAgentTurnPerformance } from "./shared/performance.ts";
import { forkReply } from "./shared/fork.ts";
import { createReplyFork } from "./server/fork.ts";
import { createAgentProbeBroker } from "./server/agent-probe.ts";
import { requestAgentProbe, pendingAgentProbes, reportAgentProbe, collectAgentProbe } from "./shared/agent-probe.ts";
import { createTerminalProbeBroker } from "./server/terminal-probe.ts";
import { requestTerminalProbe, pendingTerminalProbes, claimTerminalProbe, reportTerminalProbe, collectTerminalProbe } from "./shared/terminal-probe.ts";

export default function contribute(server: PluginServerContext) {
  const lifetime = new AbortController();
  const terminalProbes = createTerminalProbeBroker();
  server.handle(requestTerminalProbe, ({ serverId, workspaceId, kind }) => terminalProbes.request(serverId, workspaceId, kind));
  server.handle(pendingTerminalProbes, () => terminalProbes.pending());
  server.handle(claimTerminalProbe, ({ requestId, claimant }) => terminalProbes.claim(requestId, claimant));
  server.handle(reportTerminalProbe, ({ claimant, result }) => terminalProbes.report(claimant, result));
  server.handle(collectTerminalProbe, ({ requestId }) => terminalProbes.collect(requestId));
  const probes = createAgentProbeBroker();
  server.handle(requestAgentProbe, ({ agentId, serverId }) => probes.request(agentId, serverId));
  server.handle(pendingAgentProbes, () => probes.pending());
  server.handle(reportAgentProbe, ({ requestId, hosts }) => probes.report(requestId, hosts));
  server.handle(collectAgentProbe, ({ requestId }) => probes.collect(requestId));
  const quotas = new QuotaService();
  quotas.startBackgroundPolling(lifetime.signal);
  const performance = new PerformanceService();
  const pi = new PiManager();
  server.handle(piInventory, () => pi.inventory(lifetime.signal));
  server.handle(piPackageChange, (input) => pi.change(input, lifetime.signal));
  const login = new LoginService();
  server.handle(startLogin, (input) => login.begin(input.family, input.confirmed));
  server.handle(loginStatus, (input) => login.status(input.id));
  server.handle(cancelLogin, (input) => login.cancel(input.id));
  server.handle(getQuota, async (input) => {
    console.log("[TIETIEZHI RPC getQuota START]", JSON.stringify(input));
    try {
      const res = await quotas.get(input, lifetime.signal);
      console.log("[TIETIEZHI RPC getQuota SUCCESS]", input.family, "quotas:", res.quotas.length);
      return res;
    } catch (err: any) {
      console.error("[TIETIEZHI RPC getQuota ERROR]", input.family, err?.stack || err?.message || err);
      throw err;
    }
  });
  // Resolve the daemon's configured Pi auth directory per request; configuration changes invalidate the revision.
  server.handle(listAccounts, () => new AccountService().list());
  server.handle(switchAccount, (input) => new AccountService().switch(input, lifetime.signal));
  server.handle(deleteAccount, (input) => new AccountService().delete(input, lifetime.signal));
  server.handle(agentActivity, (input) => handleAgentActivity(input));
  server.handle(agentReload, (input, { paseo }) => reloadRemoteAgent(input, paseo));
  server.handle(agentArchive, (input, context) => archiveRemoteAgent(input, context.paseo));
  server.handle(agentUnarchive, (input, context) => unarchiveRemoteAgent(input, context.paseo));
  server.handle(getModelPerformance, (input) => performance.getOverview(input?.query));
  server.handle(getAgentTurnPerformance, ({ agentId }) => performance.getAgentTurns(agentId));
  server.handle(forkReply, (input, { paseo }) => createReplyFork(input, performance.getForkRecord(input.agentId, input.recordId), paseo));
  server.on("agent.turn_started", (event) => performance.onTurnStarted(event));
  server.on("agent.turn_ended", async (event, context) => {
    void handleAgentTurnEnded(event, context);
    await performance.onTurnEnded(event, context);
  });
  return async () => {
    lifetime.abort();
    probes.dispose();
    terminalProbes.dispose();
    quotas.stop();
    await login.dispose();
    await closeRemoteAgentClients();
  };
}
