import { Type } from "typebox";
import { createPaseoBridge } from "./bridge.ts";

type Params = { action: "run" | "list" | "read" | "stop"; prompt?: string; name?: string; provider?: string; agentId?: string };
// Structural subset of the host API; Pi itself must not be bundled in this plugin.
export interface NativeSubagentAPI {
  registerTool(tool: { name: string; label: string; description: string; parameters: unknown; execute(id: string, params: Params, signal: AbortSignal | undefined, onUpdate: unknown, ctx: { cwd: string; isProjectTrusted(): boolean }): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> }): void;
}
export default function (pi: NativeSubagentAPI) {
  const bridge = createPaseoBridge();
  pi.registerTool({
    name: "paseo_subagent",
    label: "Paseo Subagent",
    description: "Create and manage real Paseo child Agents with native clickable conversation streams. Use only inside Paseo and only when the user authorizes delegation. This is separate from pi-subagents workflows; never migrate active Pi subprocesses or silently fall back to another device. actions: run (fresh-context child), list, read (last 50 timeline entries), stop (interrupt, not delete).",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("run"), Type.Literal("list"), Type.Literal("read"), Type.Literal("stop")]),
      prompt: Type.Optional(Type.String({ maxLength: 32000 })),
      name: Type.Optional(Type.String({ maxLength: 80 })),
      provider: Type.Optional(Type.String({ description: "provider/model; omit to inherit the parent's model", maxLength: 256 })),
      agentId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (!ctx.isProjectTrusted()) throw new Error("此项目尚未获得信任");
      if (params.action === "run") {
        const child = await bridge.run({ prompt: params.prompt || "", name: params.name, provider: params.provider }, ctx.cwd, signal);
        return { content: [{ type: "text", text: `已创建原生 Paseo 子代理 ${child.agentId}。点击子代理胶囊可打开对话；使用 read/list 查询结果，不要重复创建。` }], details: child };
      }
      const result = params.action === "list" ? await bridge.list(signal) : params.action === "read" ? await bridge.read(params.agentId, signal) : await bridge.stop(params.agentId, signal);
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }], details: { action: params.action, result } };
    },
  });
}
