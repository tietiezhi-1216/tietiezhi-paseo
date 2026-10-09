import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, tableCells } from "../shared/markdown.ts";
import { activitySummary, reasoningSummary } from "../shared/activity.ts";

test("Markdown separates paragraphs, headings and nested lists", () => {
  const blocks = parseMarkdown("# 标题\n\n正文第一行\n正文第二行\n\n- 第一项\n  - 子项\n- 第二项\n\n结束");
  assert.deepEqual(blocks.map(block => block.kind), ["heading", "paragraph", "list", "paragraph"]);
  const list = blocks[2];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].blocks[1].kind, "list");
});
test("Markdown keeps streaming code visible and preserves tabs", () => {
  const block = parseMarkdown("```ts\n\tconst a = 1;\n")[0];
  assert.deepEqual(block, { kind: "code", language: "ts", text: "\tconst a = 1;\n" });
  assert.equal(parseMarkdown("~~~python\nprint(1)\n~~~\n\n正文")[1].kind, "paragraph");
});
test("Markdown handles quotes, tasks, numbered lists and tables", () => {
  const blocks = parseMarkdown("> 引用\n>\n> 第二段\n\n3. 第三步\n4. 第四步\n\n- [x] 已完成\n- [ ] 待完成\n\n| 名称 | 数字 |\n| :--- | ---: |\n| `a|b` | 42 |\n\n---");
  assert.deepEqual(blocks.map(block => block.kind), ["quote", "list", "list", "table", "rule"]);
  assert.deepEqual(tableCells("| a\\|b | `c|d` |"), ["a|b", "`c|d`"]);
});
test("inline Markdown preserves unsupported HTML and unsafe link text", () => {
  assert.deepEqual(parseInline("**粗体** *斜体* ~~删除~~ `code` [链接](https://example.com)" ).filter(node => node.kind !== "text").map(node => node.kind), ["strong", "em", "strike", "code", "link"]);
  assert.deepEqual(parseInline("<script>alert(1)</script>"), [{ kind: "text", text: "<script>alert(1)</script>" }]);
  assert.ok(!parseInline("[bad](javascript:alert)").some(node => node.kind === "link"));
  assert.deepEqual(parseInline("\\*literal\\*"), [{ kind: "text", text: "*literal*" }]);
});
test("activity previews retain actual supplied text, not invented reasoning", () => {
  assert.equal(activitySummary({ command: "echo\nhello" }), "echo hello");
  assert.equal(reasoningSummary("\n**检查文件**\n第二段"), "检查文件");
  assert.equal(reasoningSummary(""), "");
});
