import assert from "node:assert/strict";
import { test } from "node:test";
import { hasWorkspaceFileLinks } from "../shared/markdown.ts";

for (const text of [
  "[完整 ID、名称及差异清单](.worktrees/slot-full-capture-20261009T183916Z/exports/platform/provider-overlap-comparison-20261011/README.md)",
  "[说明](README.md)", "[文件](./src/index.ts#L12)", "[上级](../README.md)",
  "[绝对路径](/Users/me/project/README.md)", "[Windows](C:\\work\\README.md)",
  "[文件](file:///tmp/readme.md)", "[空格路径](<docs/my report.md>)",
  "# [标题](docs/readme.md)", "> [引用](docs/readme.md)", "- [条目](docs/readme.md)",
  "| 文件 |\n| --- |\n| [报告](report.md) |",
]) test(`native file ownership: ${text.slice(0, 45)}`, () => assert.equal(hasWorkspaceFileLinks(text), true));

for (const text of [
  "[网站](https://example.com)", "[邮件](mailto:a@example.com)", "普通正文",
  "`[示例](README.md)`", "``[示例](README.md)``", "```md\n[示例](README.md)\n```",
  "\\[转义](README.md)", "[危险](javascript:alert(1))",
  "[数据](data:text/html,test)", "[锚点](#section)",
]) test(`keep ordinary/code text ownership: ${text.slice(0, 45)}`, () => assert.equal(hasWorkspaceFileLinks(text), false));
