import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AccountService } from "./server/accounts.ts";
import { listAccounts, switchAccount, deleteAccount } from "./shared/accounts.ts";
import { getQuota } from "./shared/quota.ts";
import { QuotaService } from "./server/quota.ts";
import { LoginService } from "./server/login.ts";
import { startLogin, loginStatus, cancelLogin } from "./shared/login.ts";
import { handleAgentActivity, reloadRemoteAgent, archiveRemoteAgent, unarchiveRemoteAgent, closeRemoteAgentClients } from "./server/agents.ts";
import { handleAgentTurnEnded } from "./server/auto-switch.ts";
import { agentActivity, agentReload, agentArchive, agentUnarchive } from "./shared/agents.ts";

export default function contribute(server: PluginServerContext) {
  const lifetime = new AbortController();
  const quotas = new QuotaService();
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
  server.handle(agentReload, (input) => reloadRemoteAgent(input));
  server.handle(agentArchive, (input, context) => archiveRemoteAgent(input, context.paseo));
  server.handle(agentUnarchive, (input, context) => unarchiveRemoteAgent(input, context.paseo));
  server.on("agent.turn_ended", (event, context) => handleAgentTurnEnded(event, context));
  return async () => {
    lifetime.abort();
    await login.dispose();
    await closeRemoteAgentClients();
  };
}
