import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { releaseFetch } from "./release-http.ts";
import { promisify } from "node:util";
import {
  deploymentStats,
  emptyDeploymentStats,
  type DeploymentStats,
  isActivePartnerDeploy,
  jenkinsBuildState,
  parsePullRequestTitle,
  partnerDeployTitle,
  sortPartnerRecords,
  stateIsVisible,
  type PartnerRecord,
} from "../shared/release.ts";

const execFileAsync = promisify(execFile);

export type PartnerSnapshot = {
  stats: DeploymentStats;
  records: PartnerRecord[];
  warnings: string[];
};

type SecretSection = Record<string, string>;

function repoRoot(): string {
  const fromEnv = process.env.SLOTGAME_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const fromHome = path.join(homedir(), "projects", "SlotGame");
  if (existsSync(path.join(fromHome, "SECRET.md"))) return fromHome;
  return fromHome;
}

export function parseSecretSections(text: string): Map<string, SecretSection> {
  const sections = new Map<string, SecretSection>();
  let current = "";
  let values: SecretSection = {};
  const flush = () => {
    if (current) sections.set(current, values);
  };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("## ")) {
      flush();
      current = raw.slice(3).trim();
      values = {};
      continue;
    }
    if (!current || raw.trim().startsWith("#")) continue;
    const index = raw.indexOf("=");
    if (index <= 0) continue;
    values[raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
  }
  flush();
  return sections;
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function repairSvnMessage(value: string): string {
  if (!value || /[\u4e00-\u9fff]/.test(value)) return value;
  const codes = [...value].map((char) => char.charCodeAt(0));
  if (codes.some((code) => code > 255) || codes.every((code) => code < 128)) return value;
  const bytes = Uint8Array.from(codes);
  for (const encoding of ["utf-8", "gb18030"]) {
    try {
      const repaired = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (/[\u4e00-\u9fff]/.test(repaired)) return repaired;
    } catch {
      // Colleague clients sometimes commit GBK into a UTF-8 log.
    }
  }
  return value;
}

export function parseSvnLogXml(xml: string, now = Date.now()): PartnerRecord[] {
  const records: PartnerRecord[] = [];
  const pattern = /<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g;
  for (const match of xml.matchAll(pattern)) {
    const revision = Number(match[1]);
    const body = match[2] ?? "";
    const author = unescapeXml((/<author>([\s\S]*?)<\/author>/.exec(body)?.[1] ?? "").trim()) || "unknown";
    const date = unescapeXml((/<date>([\s\S]*?)<\/date>/.exec(body)?.[1] ?? "").trim());
    const message = repairSvnMessage(unescapeXml((/<msg>([\s\S]*?)<\/msg>/.exec(body)?.[1] ?? "").trim()));
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp) || timestamp > now) continue;
    const updatedAt = new Date(timestamp).toISOString();
    if (!Number.isInteger(revision) || revision <= 0 || !stateIsVisible("success", updatedAt, now)) continue;
    const parsed = parsePullRequestTitle(message.split(/\r?\n/, 1)[0] ?? "");
    records.push({
      id: `svn:r${revision}`,
      kind: "commit",
      number: revision,
      title: parsed.title || `r${revision}`,
      titleTag: parsed.tag ?? "提交",
      subtitle: author,
      author: author === "unknown" ? null : author,
      url: null,
      state: "success",
      updatedAt,
      startedAt: null,
      estimatedDurationMs: null,
      failureReason: null,
    });
  }
  return sortPartnerRecords(records);
}

type JenkinsBuild = {
  number?: unknown;
  queueId?: unknown;
  result?: unknown;
  timestamp?: unknown;
  duration?: unknown;
  building?: unknown;
  url?: unknown;
};

type JenkinsJob = {
  name?: unknown;
  url?: unknown;
  builds?: unknown;
};

export function jenkinsDeploymentStats(jobs: readonly JenkinsJob[], now = Date.now()): DeploymentStats {
  return deploymentStats(jobs.flatMap(job => (Array.isArray(job.builds) ? job.builds : []).map((build: JenkinsBuild) => ({
    startedAt: typeof build?.timestamp === "number" ? build.timestamp : NaN,
    durationMs: typeof build?.duration === "number" ? build.duration : NaN,
    success: build?.result === "SUCCESS" && build?.building !== true,
  }))), now);
}

export function partnerRecordsFromJenkinsJobs(jobs: readonly JenkinsJob[], now = Date.now()): PartnerRecord[] {
  const records: PartnerRecord[] = [];
  for (const job of jobs) {
    const jobName = typeof job.name === "string" ? job.name.trim() : "";
    if (!jobName) continue;
    const builds = Array.isArray(job.builds) ? job.builds : [];
    const estimate = jenkinsDeploymentStats([job], now).estimatedDurationMs;
    for (const item of builds) {
      const build = item && typeof item === "object" ? item as JenkinsBuild : {};
      const number = typeof build.number === "number" && Number.isInteger(build.number) ? build.number : 0;
      const timestamp = typeof build.timestamp === "number" ? build.timestamp : NaN;
      if (number <= 0 || !Number.isFinite(timestamp)) continue;
      const updatedAt = new Date(timestamp).toISOString();
      const result = typeof build.result === "string" ? build.result : "";
      const state = build.building === false && !result ? null : jenkinsBuildState(result);
      if (!state) continue;
      if (!isActivePartnerDeploy(state)) continue;
      const url = typeof build.url === "string" && /^https?:\/\//.test(build.url) ? build.url : null;
      records.push({
        id: `jenkins:${jobName}:${number}`,
        jobName,
        queueId: typeof build.queueId === "number" ? build.queueId : undefined,
        kind: "deploy",
        number,
        title: partnerDeployTitle(jobName),
        titleTag: "部署",
        subtitle: `#${number} · ${jobName}`,
        url,
        state,
        updatedAt,
        startedAt: state === "running" || state === "queued" ? updatedAt : null,
        estimatedDurationMs: state === "running" && estimate && estimate > 0 ? Math.round(estimate) : null,
        failureReason: state === "failure" ? "对接方 Jenkins 部署失败" : null,
      });
    }
  }
  return sortPartnerRecords(records);
}

export function partnerConfiguration(sections: Map<string, SecretSection>) {
  return {svn: sections.get("对接方 SVN"), jenkins: sections.get("对接方 Jenkins")};
}

export function partnerRecordsFromJenkinsQueue(items: readonly unknown[], now = Date.now()): PartnerRecord[] {
  return items.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const task = item.task && typeof item.task === "object" ? item.task as Record<string, unknown> : {};
    const id = item.id, at = item.inQueueSince, name = task.name;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0
        || typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > now
        || typeof name !== "string" || !name.trim() || item.cancelled || item.executable) return [];
    return [{id: `jenkins:queue:${id}`, jobName: name, queueId: id, kind: "deploy" as const, number: id, title: partnerDeployTitle(name), titleTag: "排队", subtitle: `队列 #${id} · ${name}`, url: null, state: "queued" as const, updatedAt:new Date(at).toISOString(), startedAt:new Date(at).toISOString(), estimatedDurationMs:null, failureReason:null}];
  });
}

async function loadSecretSections(): Promise<Map<string, SecretSection>> {
  const file = path.join(repoRoot(), "SECRET.md");
  if (!existsSync(file)) return new Map();
  return parseSecretSections(await readFile(file, "utf8"));
}

async function loadSvnRecords(section: SecretSection | undefined, signal?: AbortSignal): Promise<{ records: PartnerRecord[]; warning: string | null }> {
  const checkout = path.resolve(section?.CHECKOUT?.trim() || path.join(repoRoot(), "partner"));
  if (!existsSync(path.join(checkout, ".svn"))) {
    return { records: [], warning: "未找到对接方 SVN 工作区" };
  }
  try {
    signal?.throwIfAborted();
    const { stdout } = await execFileAsync(
      "svn",
      [
        "log",
        "--xml",
        "--limit",
        "80",
        "-r",
        "HEAD:1",
        "--non-interactive",
        // Preserve GitHub118 compatibility with the existing private SVN service.
        // This applies only to this read-only invocation; never changes global SVN trust.
        "--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other",
        checkout,
      ],
      {
        encoding: "utf8", signal,
        timeout: 12_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, SVN_POSIX_EOL: "1", LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
      },
    );
    return { records: parseSvnLogXml(stdout), warning: null };
  } catch {
    return { records: [], warning: "暂时无法读取对接方 SVN 提交" };
  }
}

async function loadJenkinsRecords(section: SecretSection | undefined, signal?: AbortSignal): Promise<{ records: PartnerRecord[]; stats: DeploymentStats; warning: string | null }> {
  const base = (section?.URL ?? "").trim().replace(/\/+$/, "");
  const username = (section?.USERNAME ?? "").trim();
  const password = section?.PASSWORD ?? "";
  if (!/^https?:\/\//.test(base) || !username || !password) {
    return { records: [], stats: emptyDeploymentStats(), warning: "未配置对接方 Jenkins" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const request = async (endpoint: string) => {
      const response = await releaseFetch(`${base}${endpoint}`, {
        headers: {accept: "application/json", authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`},
        cache: "no-store", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      if (!response.ok) throw new Error("Jenkins read failed");
      return await response.json() as { jobs?: unknown; items?: unknown };
    };
    const [jobResult, queueResult] = await Promise.allSettled([
      request("/api/json?tree=jobs[name,url,builds[queueId,number,result,timestamp,duration,building,url]{0,100}]"),
      request("/queue/api/json?tree=items[id,inQueueSince,cancelled,executable[number],task[name]]"),
    ]);
    const jobs: JenkinsJob[] = jobResult.status === "fulfilled" && Array.isArray(jobResult.value.jobs) ? jobResult.value.jobs : [];
    const queue = queueResult.status === "fulfilled" && Array.isArray(queueResult.value.items) ? queueResult.value.items : [];
    return {records: groupJenkinsDeployments([...partnerRecordsFromJenkinsJobs(jobs), ...partnerRecordsFromJenkinsQueue(queue)]), stats: jenkinsDeploymentStats(jobs), warning: jobResult.status === "rejected" ? "暂时无法读取对接方 Jenkins 部署" : queueResult.status === "rejected" ? "Jenkins 队列暂时不可读" : null};
  } catch {
    return { records: [], stats: emptyDeploymentStats(), warning: "暂时无法读取对接方 Jenkins 部署" };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadPartnerSnapshot(signal?: AbortSignal): Promise<PartnerSnapshot> {
  try {
    const sections = await loadSecretSections();
    const config = partnerConfiguration(sections);
    const [svn, jenkins] = await Promise.all([
      loadSvnRecords(config.svn, signal),
      loadJenkinsRecords(config.jenkins, signal),
    ]);
    return {
      stats: jenkins.stats,
      records: sortPartnerRecords([...svn.records, ...jenkins.records]),
      warnings: [svn.warning, jenkins.warning].filter((value): value is string => Boolean(value)),
    };
  } catch {
    return { stats: emptyDeploymentStats(), records: [], warnings: ["暂时无法读取对接方 SVN 状态"] };
  }
}

export function preservePartnerHistory(next: PartnerSnapshot, previous: PartnerRecord[], now = Date.now()): PartnerRecord[] {
  const svnUnavailable = next.warnings.some(warning => warning.includes("SVN"));
  const jenkinsUnavailable = next.warnings.some(warning => warning.includes("Jenkins") && !warning.includes("队列"));
  const queueUnavailable = next.warnings.some(warning => warning.includes("Jenkins") && warning.includes("队列"));
  const retained = previous.filter(record =>
    (record.kind === "commit" && svnUnavailable && stateIsVisible(record.state, record.updatedAt, now))
    || (record.kind === "deploy" && (jenkinsUnavailable || queueUnavailable && record.state === "queued")));
  const ids = new Set(next.records.map(record => record.id));
  return sortPartnerRecords([...next.records, ...retained.filter(record => !ids.has(record.id))]);
}

export function groupJenkinsDeployments(records: PartnerRecord[]): PartnerRecord[] {
 const result=records.filter(r=>r.state!=="queued").map(r=>({...r}));
 for(const row of records.filter(r=>r.state==="queued")){
  if(result.some(r=>r.jobName===row.jobName && r.queueId===row.number))continue;
  const active=result.find(r=>r.jobName && r.jobName===row.jobName);
  if(active)active.queuedIds=[...(active.queuedIds??[]),row.number];else result.push({...row});
 }
 return result;
}
