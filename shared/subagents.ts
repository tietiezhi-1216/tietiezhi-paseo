import { z } from "zod";

export const SubagentPillSchema = z.object({
  title: z.string(), state: z.enum(["running", "submitted", "done", "failed", "canceled", "unknown"]),
  runId: z.string().nullable(),
  children: z.array(z.object({ name: z.string(), model: z.string(), state: z.string(), tool: z.string() })),
  output: z.string(), error: z.string().nullable(),
});
export type SubagentPillData = z.infer<typeof SubagentPillSchema>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, max = 160) => typeof value === "string" ? value.slice(0, max) : "";

/** Only consume Pi's actual subagent tool, leaving other native tools untouched. */
export function subagentPillData(item: { name: string; status: string; detail: unknown; error?: unknown }): SubagentPillData | undefined {
  if (!/^(?:functions\.)?subagent$/.test(item.name)) return undefined;
  const detail = record(item.detail);
  if (detail.type !== "unknown") return undefined;
  const input = record(detail.input);
  const output = record(detail.output);
  const details = record(output.details);
  const runId = str(details.asyncId || details.runId) || null;
  const state = item.status === "failed" || output.isError === true ? "failed"
    : item.status === "canceled" ? "canceled"
    : item.status === "running" ? "running"
    : item.status === "completed" ? runId && !["completed", "done", "failed", "canceled"].includes(str(details.status)) ? "submitted"
      : details.status === "failed" ? "failed" : details.status === "canceled" ? "canceled" : "done"
    : "unknown";
  const results = Array.isArray(details.results) ? details.results : [];
  const progress = Array.isArray(details.progress) ? details.progress : [];
  const children = results.slice(0, 64).map((value, index) => {
    const child = record(value), p = record(child.progress || progress[index]);
    return {
      name: str(child.label || child.agent) || "子代理",
      model: str(child.model || p.model),
      state: str(p.activityState || child.status) || (typeof child.exitCode === "number" ? child.exitCode === 0 ? "完成" : "失败" : "状态未知"),
      tool: str(p.currentTool),
    };
  });
  const content = Array.isArray(output.content) ? output.content : [];
  const text = typeof detail.output === "string" ? detail.output : content.map(value => {
    const block = record(value); return block.type === "text" ? str(block.text, 20_000) : "";
  }).filter(Boolean).join("\n").slice(0, 20_000);
  const title = input.action ? `子代理 · ${str(input.action)}` : str(input.agent) || (input.workflow ? "子代理工作流" : "子代理");
  return { title, state, runId, children, output: text, error: item.error ? str(typeof item.error === "string" ? item.error : record(item.error).message, 2000) || "子代理调用失败" : null };
}

export const SUBAGENT_STATE_LABELS = { running: "执行中", submitted: "已提交 · 后台", done: "完成", failed: "失败", canceled: "已取消", unknown: "状态未知" } as const;
