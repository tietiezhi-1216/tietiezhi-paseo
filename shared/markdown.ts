export type InlineNode =
  | { kind: "text" | "code"; text: string }
  | { kind: "strong" | "em" | "strike"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export type MarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "rule" }
  | { kind: "quote"; blocks: MarkdownBlock[] }
  | { kind: "list"; items: { marker: string; checked?: boolean; blocks: MarkdownBlock[] }[] }
  | { kind: "table"; rows: string[][]; align: ("left" | "center" | "right")[] };

/** Small bounded parser: unrecognized syntax remains visible, including raw HTML. */
export function parseInline(text: string, depth = 0): InlineNode[] {
  if (depth > 8) return [{ kind: "text", text }];
  const nodes: InlineNode[] = [];
  let plain = "";
  const flush = () => { if (plain) nodes.push({ kind: "text", text: plain }); plain = ""; };
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\" && /[\\`*_{}\[\]()#+.!>~|-]/.test(text[i + 1] ?? "")) {
      plain += text[i + 1]; i += 2; continue;
    }
    const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(text.slice(i));
    if (code) { flush(); nodes.push({ kind: "code", text: code[2].replace(/\n/g, " ") }); i += code[0].length; continue; }
    const link = /^\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
    if (link && /^(https?:|mailto:)/i.test(link[2])) {
      flush(); nodes.push({ kind: "link", href: link[2], children: parseInline(link[1], depth + 1) }); i += link[0].length; continue;
    }
    let matched = false;
    for (const [delimiter, kind] of [["**", "strong"], ["__", "strong"], ["~~", "strike"], ["*", "em"], ["_", "em"]] as const) {
      if (!text.startsWith(delimiter, i)) continue;
      if (delimiter.includes("_") && /\w/.test(text[i - 1] ?? "")) continue;
      const end = text.indexOf(delimiter, i + delimiter.length);
      if (end <= i + delimiter.length || /\s/.test(text[i + delimiter.length])) continue;
      flush(); nodes.push({ kind, children: parseInline(text.slice(i + delimiter.length, end), depth + 1) });
      i = end + delimiter.length; matched = true; break;
    }
    if (matched) continue;
    plain += text[i++];
  }
  flush();
  return nodes;
}

/** Split pipes outside code spans; escaped pipes remain part of their cell. */
export function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "", ticks = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") { cell += "|"; i++; continue; }
    if (value[i] === "`") {
      let count = 1;
      while (value[i + count] === "`") count++;
      ticks = ticks === count ? 0 : ticks === 0 ? count : ticks;
      cell += "`".repeat(count); i += count - 1; continue;
    }
    if (value[i] === "|" && !ticks) { cells.push(cell.trim()); cell = ""; }
    else cell += value[i];
  }
  cells.push(cell.trim());
  return cells;
}

const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const rulePattern = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const indent = (line: string) => /^( *)/.exec(line)![1].length;
const startsBlock = (line: string) => fencePattern.test(line) || rulePattern.test(line)
  || /^\s{0,3}(#{1,6}\s|>)/.test(line) || listPattern.test(line);
const tableDivider = (line: string) => {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
};

export function parseMarkdown(source: string, depth = 0): MarkdownBlock[] {
  if (depth > 12) return [{ kind: "paragraph", text: source }];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const fence = fencePattern.exec(lines[i]);
    if (fence) {
      const code: string[] = [];
      const close = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", language: fence[2].trim().split(/\s/)[0] || "text", text: code.join("\n") });
      continue;
    }
    if (rulePattern.test(lines[i])) { blocks.push({ kind: "rule" }); i++; continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(lines[i]);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^\s{0,3}>/.test(lines[i])) {
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}> ?/, ""));
      blocks.push({ kind: "quote", blocks: parseMarkdown(quote.join("\n"), depth + 1) }); continue;
    }
    if (i + 1 < lines.length && lines[i].includes("|") && tableDivider(lines[i + 1])) {
      const align = tableCells(lines[i + 1]).map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" as const : "right" as const : "left" as const);
      const rows = [tableCells(lines[i])]; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(tableCells(lines[i++]));
      blocks.push({ kind: "table", rows, align }); continue;
    }
    const firstList = listPattern.exec(lines[i]);
    if (firstList) {
      const baseIndent = firstList[1].length;
      const ordered = /^\d/.test(firstList[2]);
      const items: Extract<MarkdownBlock, { kind: "list" }>["items"] = [];
      while (i < lines.length) {
        const match = listPattern.exec(lines[i]);
        if (!match || match[1].length !== baseIndent || /^\d/.test(match[2]) !== ordered) break;
        const contentIndent = match[1].length + match[2].length + 1;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(match[3]);
        const body = [task ? task[2] : match[3]]; i++;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            let next = i + 1;
            while (next < lines.length && !lines[next].trim()) next++;
            if (next < lines.length && indent(lines[next]) > baseIndent) { body.push(""); i++; continue; }
            break;
          }
          if (indent(lines[i]) <= baseIndent) break;
          const continuation = lines[i++];
          body.push(continuation.slice(Math.min(contentIndent, indent(continuation))));
        }
        items.push({ marker: ordered ? match[2].replace(/[.)]$/, ".") : "•", ...(task ? { checked: task[1] !== " " } : {}), blocks: parseMarkdown(body.join("\n"), depth + 1) });
        let next = i;
        while (next < lines.length && !lines[next].trim()) next++;
        const nextList = listPattern.exec(lines[next] ?? "");
        if (nextList && nextList[1].length === baseIndent && /^\d/.test(nextList[2]) === ordered) i = next;
        else break;
      }
      blocks.push({ kind: "list", items }); continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      if (i + 1 < lines.length && lines[i].includes("|") && tableDivider(lines[i + 1])) break;
      paragraph.push(lines[i++]);
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}
