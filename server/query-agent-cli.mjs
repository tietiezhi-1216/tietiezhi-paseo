#!/usr/bin/env node
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { connectForkDaemon } from "./fork.ts";
import { requestAgentProbe } from "../shared/agent-probe.ts";

const execute = promisify(execFile);
const { values } = parseArgs({ options: {
  "agent-id": { type: "string" }, "server-id": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("node server/query-agent-cli.mjs --agent-id <UUID> [--server-id <Host ID>]\nRead-only query through the local plugin and the App's existing connections. No prompts are sent.");
} else {
  let daemon;
  try {
    const input = requestAgentProbe.input.parse({ agentId: values["agent-id"], serverId: values["server-id"] });
    // Source daemon stays local. --server-id selects only the remote lookup target.
    // Do not inherit a CLI override that could silently route the source to another Host.
    delete process.env.PASEO_HOST;
    const { stdout } = await execute("paseo", ["daemon", "status", "--json"], { timeout: 10_000, maxBuffer: 512_000 });
    const source = JSON.parse(stdout);
    if (typeof source.serverId !== "string") throw Error("无法确认本机 Host 身份");
    daemon = await connectForkDaemon(source.serverId);
    const { requestId } = await daemon.invokePluginRpc("tietiezhi", "agents.probe.request", input);
    const deadline = Date.now() + 25_000;
    let result;
    do {
      result = await daemon.invokePluginRpc("tietiezhi", "agents.probe.collect", { requestId });
      if (result.state !== "pending") break;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    } while (Date.now() < deadline);
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "found") process.exitCode = 2;
  } catch {
    console.error("只读查询失败。请检查 Agent/Host ID、本机插件、App 连接及 Agents 胶囊；不会回退或发送任务。");
    process.exitCode = 1;
  } finally {
    if (daemon) await Promise.race([daemon.close(), new Promise(resolve => setTimeout(resolve, 1_000))]);
  }
}
