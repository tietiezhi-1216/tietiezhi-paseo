import type { PaseoApi } from "@getpaseo/client";
import type { TerminalProbeRequest, TerminalProbeResult } from "../shared/terminal-probe.ts";

/** Uses only one freshly borrowed, explicit Host API; existing terminals are never written or killed. */
export async function runTerminalProbe(job: TerminalProbeRequest, getApi: (serverId: string) => Pick<PaseoApi, "terminals">, signal: AbortSignal): Promise<TerminalProbeResult> {
  const result: TerminalProbeResult = { ...job, state: "failed", terminalId: null, existingTerminals: [], output: "", cleanedUp: false, error: null };
  let api: Pick<PaseoApi, "terminals"> | undefined;
  let owned: string | undefined;
  try {
    if (signal.aborted) throw Error("cancelled");
    api = getApi(job.serverId);
    const listed = await api.terminals.list({ workspaceId: job.workspaceId });
    result.existingTerminals = listed.entries.filter(t => t.workspaceId === job.workspaceId).slice(0, 200).map(t => t.id);
    if (signal.aborted) throw Error("cancelled");
    const terminal = await api.terminals.create({ workspaceId: job.workspaceId, name: "tietiezhi · 只读终端诊断", command: "/bin/sh", args: ["/dev/stdin"], requestId: job.requestId });
    const metadata = terminal.current();
    if (!metadata || metadata.id !== terminal.id || metadata.workspaceId !== job.workspaceId || listed.entries.some(t => t.id === terminal.id)) throw Error("invalid created terminal identity");
    owned = terminal.id; result.terminalId = owned;
    if (signal.aborted) throw Error("cancelled");
    const begin = `TIETIEZHI-BEGIN:${job.requestId}`;
    const end = `TIETIEZHI-END:${job.requestId}`;
    // No untrusted command text. A failed connection leaves only this bounded, benign process.
    const command = `printf '${begin}\\n'; /bin/hostname; /usr/bin/uname -s; /bin/pwd; printf '${end}\\n'; /bin/sleep 45; exit\n`;
    const written = terminal.write(command);
    if (written !== command.length) throw Error("input not accepted");
    const deadline = Date.now() + 10_000;
    while (!signal.aborted && Date.now() < deadline) {
      const capture = await terminal.capture({ stripAnsi: true, start: -100 });
      if (capture.terminalId !== owned) throw Error("capture identity mismatch");
      const start = capture.lines.findIndex(line => line.trim() === begin);
      const finish = capture.lines.findIndex((line, i) => i > start && line.trim() === end);
      if (start >= 0 && finish > start) {
        result.output = capture.lines.slice(start + 1, finish).join("\n").slice(0, 4000);
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
