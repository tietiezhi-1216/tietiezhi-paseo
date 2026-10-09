import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DaemonClient, type FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import type { PaseoApi } from "@getpaseo/client";
import type { RpcInput } from "@getpaseo/plugin";
import { forkReply } from "../shared/fork.ts";
import type { TurnPerformanceData } from "../shared/performance.ts";

const execFileAsync = promisify(execFile);

// DaemonClient owns the native fork-context protocol. Never expose its credentials to the UI.
export async function connectForkDaemon(expectedServerId: string) {
  const { stdout } = await execFileAsync("paseo", ["daemon", "status", "--json"], { timeout: 10_000, maxBuffer: 512_000 });
  const status = JSON.parse(stdout);
  if (status.serverId !== expectedServerId) throw new Error("分叉 Host 不匹配，已中止；不会回退到其他主机。");
  if (!/^(127\.0\.0\.1|\[::1\]):\d+$/.test(status.listen) || typeof status.home !== "string") throw new Error("当前 Host 没有可用的本机分叉连接。");
  const daemon = new DaemonClient({
    url: `ws://${status.listen}/ws`, clientId: `tietiezhi-fork-${crypto.randomUUID()}`,
    clientType: "cli", connectTimeoutMs: 5_000, reconnect: { enabled: false },
    localCredential: () => readFileSync(join(status.home, "local-credential"), "utf8").trim(),
  });
  try {
    await daemon.connect();
    if (daemon.getLastServerInfoMessage()?.serverId !== expectedServerId) throw new Error("连接到的 Host 身份发生变化。");
    return daemon;
  } catch (error) { await daemon.close(); throw error; }
}

type ForkDriver = Pick<DaemonClient, "fetchAgent" | "fetchAgentTimeline" | "buildAgentForkContext" | "close">;

/** Resolve the exact source reply, never silently use the newest conversation boundary. */
export async function resolveForkBoundary(driver: ForkDriver, agentId: string, record: TurnPerformanceData, replyAt: number) {
  let cursor: NonNullable<FetchAgentTimelinePayload["startCursor"]> | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const timeline = await driver.fetchAgentTimeline(agentId, { direction: "before", projection: "projected", limit: 200, ...(cursor ? { cursor } : {}) });
    if (timeline.staleCursor || timeline.gap) throw new Error("会话历史边界已改变，请刷新后重新选择回复。");
    const matches = timeline.entries.filter(entry => entry.item.type === "assistant_message" &&
      (record.messageId && entry.item.messageId ? record.messageId === entry.item.messageId : entry.item.text === record.content && Date.parse(entry.timestamp) === replyAt));
    if (matches.length > 1) throw new Error("回复边界不唯一，已中止分叉。");
    if (matches.length === 1) return { boundaryCursor: { epoch: timeline.epoch, seq: matches[0].seqEnd } };
    if (!timeline.hasOlder || !timeline.startCursor) break;
    const key = `${timeline.startCursor.epoch}:${timeline.startCursor.seq}`;
    if (seen.has(key)) break;
    seen.add(key); cursor = timeline.startCursor;
  }
  throw new Error("未找到这条回复的准确历史边界，未创建分叉。");
}

export async function createReplyFork(
  input: RpcInput<typeof forkReply>, record: TurnPerformanceData | undefined, paseo: PaseoApi,
  connect: (serverId: string) => Promise<ForkDriver> = connectForkDaemon,
) {
  if (!record?.content) throw new Error("这条回复缺少可验证的统计记录，不能分叉。");
  const daemon = await connect(input.serverId);
  try {
    const source = await daemon.fetchAgent(input.agentId);
    if (!source?.agent?.workspaceId) throw new Error("原会话或工作区已不可用。");
    const boundary = await resolveForkBoundary(daemon, input.agentId, record, input.replyAt);
    const context = await daemon.buildAgentForkContext(input.agentId, boundary);
    if (!context.attachment || context.error) throw new Error("Host 没有返回有效的原生分叉上下文。");
    const agent = source.agent;
    const workspaceId = agent.workspaceId!;
    const model = agent.model ?? agent.runtimeInfo?.model;
    const config = {
      provider: model ? `${agent.provider}/${model}` : agent.provider,
      ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
      ...(agent.thinkingOptionId ? { thinkingOptionId: agent.thinkingOptionId } : {}),
      featureValues: Object.fromEntries((agent.features ?? []).map(feature => [feature.id, feature.value])),
    };
    const options = { config, prompt: input.prompt, attachments: [context.attachment],
      agentId: input.operationId, idempotencyKey: input.operationId, title: `分叉 · ${agent.title || input.agentId.slice(0, 8)}` };
    const workspace = input.target === "tab" ? paseo.workspaces.ref(workspaceId)
      : await paseo.workspaces.create({ workspaceId: `fork-${input.operationId}`, source: { kind: "worktree", cwd: agent.cwd, action: "branch-off" } });
    const created = await workspace.agents.create(options);
    return { agentId: created.id, workspaceId: workspace.id, serverId: input.serverId };
  } finally { await daemon.close(); }
}
