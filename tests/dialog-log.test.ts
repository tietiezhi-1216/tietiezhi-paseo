import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_LOGS, filterDemoLogs, formatDemoLogs } from "../shared/dialog-log.ts";

test("Dialog 示例筛选消息/工具，检索不修改原始日志", () => {
  const bytes = JSON.stringify(DEMO_LOGS);
  assert.equal(filterDemoLogs(DEMO_LOGS, "all", "").length, 8);
  assert.equal(filterDemoLogs(DEMO_LOGS, "tools", "").length, 3);
  assert.equal(filterDemoLogs(DEMO_LOGS, "messages", "").length, 5);
  assert.equal(filterDemoLogs(DEMO_LOGS, "tools", "  TYPECHECK  ").length, 1);
  assert.equal(filterDemoLogs(DEMO_LOGS, "messages", "typecheck").length, 0);
  assert.equal(filterDemoLogs(DEMO_LOGS, "all", "no-match").length, 0);
  assert.equal(JSON.stringify(DEMO_LOGS), bytes);
});
test("复制日志保留模拟声明，只包含当前选择的记录", () => {
  const output = formatDemoLogs(filterDemoLogs(DEMO_LOGS, "tools", "typecheck"));
  assert.match(output, /模拟记录/);
  assert.match(output, /npm run typecheck/);
  assert.doesNotMatch(output, /npm test/);
});
