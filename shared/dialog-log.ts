export type DemoLogRole = "user" | "assistant" | "tool";
export type DemoLog = { id: string; role: DemoLogRole; time: string; title: string; text: string };
export type DemoLogFilter = "all" | "messages" | "tools";

// Deliberately fictional. No SDK reads, agent messages, credentials, or shell execution.
export const DEMO_LOGS: readonly DemoLog[] = [
  { id: "user-1", role: "user", time: "10:42:01", title: "用户", text: "帮我检查当前项目，整理一下已经实现的功能。" },
  { id: "assistant-1", role: "assistant", time: "10:42:02", title: "Agent", text: "好的。我会先查看项目说明，再检查账号管理和多 Host Agent 展示。\n这里是模拟对话，仅用于查看 Dialog 的呈现效果。" },
  { id: "tool-1", role: "tool", time: "10:42:03", title: "读取 README.md", text: "模拟读取结果：\n• Pi 账号切换\n• Agent 状态、搜索与会话跳转\n• 多 Host 通信" },
  { id: "assistant-2", role: "assistant", time: "10:42:04", title: "Agent", text: "已整理三个模块。接下来演示日志中的工具记录，并测试长内容滚动。" },
  { id: "tool-2", role: "tool", time: "10:42:05", title: "npm run typecheck", text: "模拟输出：TypeScript 检查通过。\n这只是文字示例，没有执行任何命令。" },
  { id: "tool-3", role: "tool", time: "10:42:06", title: "npm test", text: "模拟输出：20 passed / 0 failed。\n耗时：0.2s（示例）。" },
  { id: "user-2", role: "user", time: "10:42:08", title: "用户", text: "我希望保留聊天页面，点击按钮后直接查看内容，不再跳到独立面板。" },
  { id: "assistant-3", role: "assistant", time: "10:42:09", title: "Agent", text: "可以。宽屏会显示居中的 Dialog，窄屏会切换成底部抽屉。\n弹窗关闭后回到原页面；搜索和工具筛选只影响当前预览，不修改对话。" },
];

export function filterDemoLogs(logs: readonly DemoLog[], filter: DemoLogFilter, query: string): DemoLog[] {
  const needle = query.trim().toLocaleLowerCase();
  return logs.filter((log) =>
    (filter === "all" || (filter === "tools" ? log.role === "tool" : log.role !== "tool")) &&
    (!needle || `${log.title}\n${log.text}`.toLocaleLowerCase().includes(needle)),
  );
}
export function formatDemoLogs(logs: readonly DemoLog[]): string {
  return ["tietiezhi Dialog 示例 · 以下均为模拟记录", ...logs.map((log) => `[${log.time}] ${log.title}\n${log.text}`)].join("\n\n");
}
