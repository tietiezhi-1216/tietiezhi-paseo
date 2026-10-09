import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, readFile, lstat } from "node:fs/promises";
const execute = promisify(execFile);
const idValue = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? value : undefined;
const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const dataOf = (value: unknown) => object(value).data ?? value;
// Older Paseo CLIs omit workspaceId from `agent inspect --json`. Read only
// the exact Agent's persisted metadata, never guess a workspace from its cwd.
export async function readAgentWorkspace(home: string, agentId: string): Promise<string> {
  if (!idValue(agentId)) throw new Error("无效的 Agent ID");
  const root = join(home, "agents");
  const directories = await readdir(root, { withFileTypes: true });
  const candidates = [join(root, `${agentId}.json`), ...directories.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => join(root, entry.name, `${agentId}.json`))];
  const workspaces = new Set<string>();
  for (const path of candidates) {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) continue;
      const record = JSON.parse(await readFile(path, "utf8"));
      if (record.id === agentId && idValue(record.workspaceId)) workspaces.add(record.workspaceId);
    } catch (error: any) { if (error?.code !== "ENOENT") throw new Error("无法安全读取 Agent 工作区元数据"); }
  }
  if (workspaces.size !== 1) throw new Error("无法确定父会话的唯一工作区，已中止；不会创建新工作区");
  return [...workspaces][0];
}
export function createPaseoBridge(env: NodeJS.ProcessEnv = process.env, run = execute, workspaceOf = readAgentWorkspace) {
  const parentId = idValue(env.PASEO_AGENT_ID);
  const home = env.PASEO_HOME || join(homedir(), ".paseo");
  const localEnv = { ...env }; delete localEnv.PASEO_HOST; delete localEnv.PASEO_MCP_URL; delete localEnv.PASEO_PASSWORD;
  let creation = Promise.resolve();
  const cli = async (args: string[], signal?: AbortSignal, json = true) => {
    if (!parentId) throw new Error("此工具只能在 Paseo 管理的 Pi 会话中使用");
    try {
      const separator = args.indexOf("--");
      const command = separator < 0 ? [...args, "--home", home, ...(json ? ["--json"] : [])]
        : [...args.slice(0, separator), "--home", home, ...(json ? ["--json"] : []), ...args.slice(separator)];
      const result = await run("paseo", command, { env: localEnv, signal, timeout: 60_000, maxBuffer: 1024_000 });
      return json ? dataOf(JSON.parse(String(result.stdout))) : String(result.stdout);
    } catch (error: any) {
      if (signal?.aborted) throw new Error("Paseo 请求已取消；已创建的子代理可能仍在运行，请用 list 检查");
      if (error?.code === "ENOENT") throw new Error("当前设备找不到 paseo CLI");
      // Do not reflect the execFile command line: it can contain the full prompt.
      throw new Error("Paseo 原生子代理操作失败，请检查当前设备的 Daemon 状态和本机凭据");
    }
  };
  const inspect = async (id: string, signal?: AbortSignal) => object(await cli(["agent", "inspect", id], signal));
  const list = async (signal?: AbortSignal) => {
    const value = await cli(["agent", "ls", "--global", "--label", `paseo.parent-agent-id=${parentId}`], signal);
    if (!Array.isArray(value)) throw new Error("Paseo 返回了无效的子代理列表");
    return value;
  };
  const owned = async (id: unknown, signal?: AbortSignal) => {
    const childId = idValue(id); if (!childId) throw new Error("无效的子代理 ID");
    const child = await inspect(childId, signal);
    if ((child.Id ?? child.id) !== childId || (child.ParentAgentId ?? child.parentAgentId ?? child.labels?.["paseo.parent-agent-id"]) !== parentId) {
      throw new Error("该 Agent 不属于当前父会话，已拒绝操作");
    }
    return childId;
  };
  return {
    async run(input: { prompt: string; name?: string; provider?: string }, cwd: string, signal?: AbortSignal) {
      if (!input.prompt?.trim() || input.prompt.length > 32_000) throw new Error("任务不能为空或超过 32000 字符");
      if (input.provider && !/^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$/.test(input.provider)) throw new Error("无效的 provider/model");
      let unlock!: () => void;
      const previous = creation; creation = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      try {
      const parent = await inspect(parentId!, signal);
      if ((parent.Id ?? parent.id) !== parentId) throw new Error("当前设备没有此父会话，不允许回退到其他设备");
      const workspaceId = idValue(parent.WorkspaceId ?? parent.workspaceId) || await workspaceOf(home, parentId!);
      const parentCwd = typeof (parent.Cwd ?? parent.cwd) === "string" ? parent.Cwd ?? parent.cwd : cwd;
      if ((await list(signal)).filter((child: any) => ["running", "initializing"].includes(String(child.Status ?? child.status))).length >= 8) throw new Error("当前父会话最多同时运行 8 个子代理");
      const provider = input.provider || [parent.Provider ?? parent.provider, parent.Model ?? parent.model].filter(Boolean).join("/");
      if (!provider) throw new Error("无法确定父会话的模型");
      const args = ["run", "--background", "--workspace", workspaceId, "--provider", provider, "--cwd", parentCwd, "--title", (input.name || "子代理").slice(0, 80), "--label", "kind=tietiezhi-subagent", "--label", `paseo.parent-agent-id=${parentId}`];
      if (!input.provider && (parent.Thinking ?? parent.thinking)) args.push("--thinking", String(parent.Thinking ?? parent.thinking));
      // Append the prompt after --, keeping CLI options out of user task text.
      const value = object(await cli([...args, "--", input.prompt], signal));
      const result = object(dataOf(value));
      const id = idValue(result.agentId ?? result.AgentId ?? result.id ?? result.Id);
      if (!id) throw new Error("Paseo 没有返回子代理 Agent ID");
      await owned(id, signal);
      const createdWorkspace = await workspaceOf(home, id);
      if (createdWorkspace !== workspaceId) {
        await cli(["agent", "stop", id], signal);
        throw new Error(`子代理 ${id} 的工作区与父会话不一致，已停止；未删除工作区或代码`);
      }
      return { agentId: id, parentAgentId: parentId, workspaceId, name: input.name || "子代理", status: "submitted" };
      } finally { unlock(); }
    },
    list,
    async read(id: unknown, signal?: AbortSignal) { const childId = await owned(id, signal); return cli(["agent", "logs", childId, "--tail", "50"], signal, false); },
    async stop(id: unknown, signal?: AbortSignal) { const childId = await owned(id, signal); await cli(["agent", "stop", childId], signal); return { agentId: childId, stopped: true }; },
  };
}
