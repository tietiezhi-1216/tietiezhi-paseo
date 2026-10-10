import type { PaseoApi } from "@getpaseo/client";
import type { TerminalProbeRequest, TerminalProbeResult } from "../shared/terminal-probe.ts";
import { PI_ANTIGRAVITY_INVENTORY_SCRIPT } from "../shared/pi-antigravity-inventory.ts";

/** Uses only one freshly borrowed, explicit Host API; existing terminals are never written or killed. */
export async function runTerminalProbe(job: TerminalProbeRequest, getApi: (serverId: string) => Pick<PaseoApi, "terminals" | "workspaces">, signal: AbortSignal): Promise<TerminalProbeResult> {
  const result: TerminalProbeResult = { ...job, state: "failed", terminalId: null, existingTerminals: [], output: "", cleanedUp: false, error: null };
  let api: Pick<PaseoApi, "terminals" | "workspaces"> | undefined;
  let owned: string | undefined;
  try {
    if (signal.aborted) throw Error("cancelled");
    api = getApi(job.serverId);
    const workspaceId = job.workspaceId === "auto" && job.kind === "pi-antigravity"
      ? (await api.workspaces.list()).entries[0]?.id
      : job.workspaceId;
    if (!workspaceId) throw Error("no existing workspace; nothing created");
    const listed = await api.terminals.list({ workspaceId });
    result.existingTerminals = listed.entries.filter(t => t.workspaceId === workspaceId).slice(0, 200).map(t => t.id);
    if (signal.aborted) throw Error("cancelled");
    const terminal = await api.terminals.create({ workspaceId, name: "tietiezhi · 只读终端诊断", command: "/bin/sh", args: ["/dev/stdin"], requestId: job.requestId });
    const metadata = terminal.current();
    if (!metadata || metadata.id !== terminal.id || metadata.workspaceId !== workspaceId || listed.entries.some(t => t.id === terminal.id)) throw Error("invalid created terminal identity");
    owned = terminal.id; result.terminalId = owned;
    if (signal.aborted) throw Error("cancelled");
    const begin = `TIETIEZHI-BEGIN:${job.requestId}`;
    const end = `TIETIEZHI-END:${job.requestId}`;
    // No untrusted command text. A failed connection leaves only this bounded, benign process.
    const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
    const diagnostic = job.kind === "pi-antigravity" ? `node -e ${quote(PI_ANTIGRAVITY_INVENTORY_SCRIPT)}` : "/bin/hostname; /usr/bin/uname -s; /bin/pwd";
    const command = `printf '${begin}\\n'; ${diagnostic}; printf '${end}\\n'; /bin/sleep 45; exit\n`;
    const written = terminal.write(command);
    if (written !== command.length) throw Error("input not accepted");
    const deadline = Date.now() + 10_000;
    while (!signal.aborted && Date.now() < deadline) {
      const capture = await terminal.capture({ stripAnsi: true, start: -100 });
      if (capture.terminalId !== owned) throw Error("capture identity mismatch");
      const start = capture.lines.findIndex(line => line.trim() === begin);
      const finish = capture.lines.findIndex((line, i) => i > start && line.trim() === end);
      if (start >= 0 && finish > start) {
        const lines = capture.lines.slice(start + 1, finish);
        if (job.kind === "pi-antigravity") {
          // xterm soft-wraps long JSON strings; the program emits one compact JSON line.
          result.output = JSON.stringify(JSON.parse(lines.join("")));
          if (result.output.length > 4000) { result.output = ""; throw Error("inventory output too large"); }
        } else result.output = lines.join("\n").slice(0, 4000);
        result.state = "completed"; break;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (result.state !== "completed") throw Error("diagnostic timed out");
  } catch { result.error = "终端诊断未完成；没有操作已有终端。"; }
  finally {
    if (owned && api) {
      try { await api.terminals.ref(owned).kill(); result.cleanedUp = true; }
      catch { result.error = "测试终端清理未确认；请按返回的 terminalId 检查。"; }
    }
  }
  return result;
}
