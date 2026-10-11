import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const PullRequestDisplayStateSchema = z.enum([
  "checking",
  "waiting",
  "pending",
  "verifying",
  "queued",
  "batched",
  "running",
  "no_runtime",
  "success",
  "failure",
]);
export type PullRequestDisplayState = z.infer<typeof PullRequestDisplayStateSchema>;

export const PullRequestReleaseSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string().nullable().optional(),
  titleTag: z.string().nullable(),
  branchName: z.string(),
  url: z.string().url(),
  state: PullRequestDisplayStateSchema,
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  estimatedDurationMs: z.number().int().positive().nullable(),
  failureReason: z.string().nullable(),
  batchNote: z.string().nullable().optional(),
  phase: z.enum(["building", "deploying", "verifying"]).nullable().optional(),
  phaseStartedAt: z.string().nullable().optional(),
});
export type PullRequestRelease = z.infer<typeof PullRequestReleaseSchema>;

export const PartnerRecordKindSchema = z.enum(["commit", "deploy"]);
export type PartnerRecordKind = z.infer<typeof PartnerRecordKindSchema>;

export const PartnerRecordSchema = z.object({
  jobName: z.string().optional(),
  queueId: z.number().int().nonnegative().optional(),
  queuedIds: z.array(z.number().int().nonnegative()).optional(),
  id: z.string(),
  kind: PartnerRecordKindSchema,
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string().nullable().optional(),
  titleTag: z.string().nullable(),
  subtitle: z.string(),
  url: z.string().nullable(),
  state: PullRequestDisplayStateSchema,
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  estimatedDurationMs: z.number().int().positive().nullable(),
  failureReason: z.string().nullable(),
});
export type PartnerRecord = z.infer<typeof PartnerRecordSchema>;

export const SiteAvailabilitySchema = z.object({
  available: z.boolean().nullable(),
  httpStatus: z.number().int().nullable(),
  label: z.string(),
});
export type SiteAvailability = z.infer<typeof SiteAvailabilitySchema>;

export const DeploymentStatsSchema = z.object({
  lastPublishedAt: z.string().nullable(),
  estimatedDurationMs: z.number().int().positive().nullable(),
  sampleCount: z.number().int().nonnegative(),
});
export type DeploymentStats = z.infer<typeof DeploymentStatsSchema>;
export const emptyDeploymentStats = (): DeploymentStats => ({ lastPublishedAt: null, estimatedDurationMs: null, sampleCount: 0 });

export function deploymentStats(samples: readonly { startedAt: number; durationMs: number; success: boolean }[], now = Date.now()): DeploymentStats {
  const valid = samples.filter(s => s.success && Number.isFinite(s.startedAt) && Number.isFinite(s.durationMs)
    && s.durationMs > 0 && s.durationMs <= 24 * 60 * 60_000 && s.startedAt > 0 && s.startedAt + s.durationMs <= now);
  return { lastPublishedAt: valid.length ? new Date(Math.max(...valid.map(s => s.startedAt + s.durationMs))).toISOString() : null,
    estimatedDurationMs: averageDurationMs(valid.map(s => s.durationMs)), sampleCount: valid.length };
}

export function completedWorkflowAt(jobs: readonly { name?: unknown; conclusion?: unknown; status?: unknown; completed_at?: unknown }[], total: number): string | null {
  if (!jobs.some(j => j.name === "deploy" && j.conclusion === "success")
    || !jobs.some(j => j.name === "Verify public 118 health" && j.conclusion === "success")) return null;
  if (!jobs.length || jobs.length !== total || jobs.some(j => j.status !== "completed" || typeof j.completed_at !== "string" || !Number.isFinite(Date.parse(j.completed_at)))) return null;
  const completed = Math.max(...jobs.map(j => Date.parse(j.completed_at as string)));
  return completed <= Date.now() ? new Date(completed).toISOString() : null;
}

export const ReleaseSnapshotSchema = z.object({
  fetchedAt: z.string(),
  githubStats: DeploymentStatsSchema.default(emptyDeploymentStats),
  svnStats: DeploymentStatsSchema.default(emptyDeploymentStats),
  releaseSummary: z.string().nullable(),
  site: SiteAvailabilitySchema.nullable().default(null),
  averageDurationMs: z.number().int().positive().nullable().default(null),
  durationSampleCount: z.number().int().nonnegative().default(0),
  pullRequests: z.array(PullRequestReleaseSchema),
  partnerRecords: z.array(PartnerRecordSchema).default([]),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
});
export type ReleaseSnapshot = z.infer<typeof ReleaseSnapshotSchema>;

export const releaseSnapshot = defineRpc({
  name: "tietiezhi.release.snapshot",
  input: z.object({ refresh: z.boolean().optional() }),
  output: ReleaseSnapshotSchema,
});

export const RELEASE_SNAPSHOT_QUERY_KEY = ["tietiezhi-release"] as const;
export const releasePulse = defineRpc({
  name: "tietiezhi.release.pulse", input: z.object({}),
  output: z.object({ revision: z.number().int().nonnegative(), connected: z.boolean() }),
});
export const releasePreferences = defineSettings({
  id: "release-board", scope: "host", version: 1,
  schema: z.object({ tab: z.enum(["pulls", "commits"]).default("pulls"),
    seenPulls: z.number().nonnegative().default(0), seenSvn: z.number().nonnegative().default(0) }),
});
export const PULL_REQUEST_DISPLAY_WINDOW_MS = 24 * 60 * 60_000;

export type ParsedPullRequestTitle = {
  title: string;
  tag: string | null;
};

const ENGLISH_TITLE_PREFIX = /^(?<tag>(?:feat|feature|fix|bugfix|hotfix|perf|optimize|refactor|docs?|test|build|ci|chore|style|revert|release)(?:\([^()（）：:]{1,40}\)|（[^()（）：:]{1,40}）)?!?)[：:]\s*(?<title>.+)$/iu;
const CHINESE_TITLE_PREFIX = /^(?<tag>(?:功能|新增|添加|修复|优化|改进|重构|文档|规范|测试|构建|部署|发布|运维|维护|性能|样式|回滚|安全|清理|更新|调整|同步|提交)(?:\([^()（）：:]{1,40}\)|（[^()（）：:]{1,40}）)?)[：:]\s*(?<title>.+)$/u;

export function parsePullRequestTitle(value: string): ParsedPullRequestTitle {
  const original = value.trim();
  const match = ENGLISH_TITLE_PREFIX.exec(original) ?? CHINESE_TITLE_PREFIX.exec(original);
  const tag = match?.groups?.tag?.trim();
  const title = match?.groups?.title?.trim();
  return tag && title ? { tag, title } : { tag: null, title: original };
}

export function workflowConclusionIsFailure(conclusion: string | null | undefined): boolean {
  return ["failure", "timed_out", "startup_failure", "action_required"].includes(
    (conclusion ?? "").trim().toLowerCase(),
  );
}

export function productionSourceCommitFromHealth(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sourceCommit = (value as { sourceCommit?: unknown }).sourceCommit;
  if (typeof sourceCommit !== "string") return null;
  const sha = sourceCommit.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export function workflowRunIsActive(status: string | null | undefined): boolean {
  return ["queued", "waiting", "requested", "pending", "in_progress"].includes(
    (status ?? "").trim().toLowerCase(),
  );
}

export function resolveProductionBaseline(
  healthSha: string | null | undefined,
  lastSuccessfulDeployHeadSha: string | null | undefined,
): string | null {
  const health = (healthSha ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(health)) return health;
  const fallback = (lastSuccessfulDeployHeadSha ?? "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(fallback) ? fallback : null;
}

export function belongsToActiveDeploy(input: {
  open: boolean;
  inProduction: boolean | null;
  deployIsActive: boolean;
  inDeployHead: boolean;
}): boolean {
  return !input.open && input.inProduction === false
    && input.deployIsActive && input.inDeployHead;
}

// Only mark a merge complete without a new production receipt when every
// changed file is outside the Linux release component selectors. Unknown paths
// are treated as runtime-affecting rather than claiming an unverified skip.
export function runContainsMerge(
  run: { headSha: string }, mergeSha: string | null,
  comparison: { complete: boolean; commits: Set<string> },
): boolean {
  return !!mergeSha && (run.headSha === mergeSha
    || comparison.complete && comparison.commits.has(mergeSha));
}

export function isDefinitelyNonRuntimeFile(path: string): boolean {
  const value = path.replaceAll("\\", "/");
  if (value === ".gitignore" || value.startsWith("exports/") || value.startsWith(".pi/")) return true;
  if (/\.md$/i.test(value) || /(^|\/)src\/test\//.test(value)
      || /(^|\/)tests?\//.test(value)
      || value.startsWith("gateway/migrations/testdata/")) return true;
  if (value.startsWith("deploy/linux/")
      || ["formation-python-toolchain.sh", "runtime-service.sh", "runtime-management.py",
        "slotgame-gateway.service", "install-production-118-incremental.sh"]
        .some((name) => value === `deploy/native/${name}`)) return false;
  return /^(\.agents\/|\.github\/|scripts\/|tools\/|deploy\/)/.test(value);
}

export type ReleaseJob = {
  name?: string;
  status?: string;
  conclusion?: string | null;
  runner_name?: string;
  started_at?: string;
  completed_at?: string;
  steps?: Array<{ name?: string; status?: string; conclusion?: string | null; started_at?: string; completed_at?: string }>;
};

export type ReleaseExecution = {
  status: "queued" | "running" | "unknown";
  startedAt: string | null;
  profile: "gateway" | "light" | null;
};

export function releaseExecution(jobs: readonly ReleaseJob[]): ReleaseExecution {
  const deploy = jobs.find(job => job.name === "deploy");
  if (!deploy) return { status: "unknown", startedAt: null, profile: null };
  const validation = deploy.steps?.find(step => step.name === "Validate Gateway regression using compiled classes");
  const profile = validation?.conclusion === "skipped" ? "light"
    : validation?.status === "in_progress" || validation?.conclusion === "success" ? "gateway" : null;
  if (["queued", "waiting", "pending", "requested"].includes(deploy.status ?? "")
    || deploy.runner_name === "") return { status: "queued", startedAt: null, profile };
  const startedAt = deploy.started_at;
  return startedAt && Number.isFinite(Date.parse(startedAt)) && !!deploy.runner_name
    ? { status: "running", startedAt, profile }
    : { status: "unknown", startedAt: null, profile };
}

export function selectBatchAnchor(items: readonly { number: number; nonRuntime: boolean | null }[]): number | null {
  const priority = (item: { nonRuntime: boolean | null }) => item.nonRuntime === false ? 2 : item.nonRuntime === null ? 1 : 0;
  return [...items].sort((a, b) => priority(b) - priority(a) || b.number - a.number)[0]?.number ?? null;
}

// A completed deploy run is the authority for "nothing to install". The file
// allowlist is only a fallback when these job steps cannot be read. An explicit
// record step wins; older runs are recognized by a skipped public-health job
// after a successful deploy, which is how an empty component plan used to end.
export function successfulRunSkippedRuntime(jobs: ReleaseJob[]): boolean | null {
  const deploy = jobs.find((job) => job.name === "deploy");
  if (!deploy) return null;
  if (deploy.status !== "completed" || deploy.conclusion !== "success") return false;
  const steps = deploy.steps ?? [];
  const recorded = steps.some((step) => step.name === "Record no runtime release"
    && step.status === "completed" && step.conclusion === "success");
  if (recorded) return true;
  const installed = steps.some((step) => step.name === "Install verified artifacts on 118"
    && step.status === "completed" && step.conclusion === "success");
  const installSkipped = steps.some((step) => step.name === "Install verified artifacts on 118"
    && step.conclusion === "skipped");
  const health = jobs.find((job) => job.name === "Verify public 118 health");
  if (health?.status === "completed" && health.conclusion === "success") return false;
  if (health?.status === "completed" && health.conclusion === "skipped") {
    if (installSkipped && !recorded) return null;
    return true;
  }
  if (installed) return false;
  return health ? false : null;
}

export function pullRequestState(input: {
  open: boolean;
  draft: boolean;
  checkStatus?: string | null;
  checkConclusion?: string | null;
  inProduction?: boolean | null;
  deployStatus?: string | null;
  deployConclusion?: string | null;
  includedInActiveDeploy?: boolean;
  ownsDeployTimer?: boolean;
  noRuntimeConfirmed?: boolean;
  runtimeScopeUnverified?: boolean;
}): PullRequestDisplayState {
  if (input.open) {
    if (input.draft) return "waiting";
    if (workflowConclusionIsFailure(input.checkConclusion)) return "failure";
    return ["queued", "waiting", "requested", "pending"].includes((input.checkStatus ?? "").toLowerCase())
      ? "waiting"
      : "checking";
  }
  if (input.noRuntimeConfirmed) return "no_runtime";
  if (input.inProduction === true) return "success";
  if (input.includedInActiveDeploy) {
    const status = (input.deployStatus ?? "").toLowerCase();
    if (status === "in_progress") return input.ownsDeployTimer === false ? "batched" : "running";
    if (["queued", "waiting", "requested", "pending"].includes(status)) return "queued";
  }
  if (workflowConclusionIsFailure(input.deployConclusion)) return "failure";
  if (input.runtimeScopeUnverified) return "verifying";
  return "pending";
}

export function stateLabel(state: PullRequestDisplayState): string {
  switch (state) {
    case "checking": return "检查中";
    case "waiting": return "等待合并";
    case "pending": return "待发布";
    case "verifying": return "发布范围待核验";
    case "queued": return "等待前序批次";
    case "batched": return "随批次发布中";
    case "running": return "部署中";
    case "no_runtime": return "无需运行时发布";
    case "success": return "发布成功";
    case "failure": return "失败";
  }
}

export function resolveSiteAvailability(input: {
  healthStatus: number | null;
  healthReady: boolean;
  pageStatus: number | null;
  pageReady: boolean;
}): SiteAvailability {
  // Site health is independent from per-PR deployment results.
  // A timed-out or incomplete probe is unknown, not healthy or offline.
  if (input.pageStatus !== null && input.pageStatus !== 200) {
    return { available: false, httpStatus: input.pageStatus, label: `HTTP ${input.pageStatus}` };
  }
  if (input.healthStatus !== null && input.healthStatus !== 200) {
    return { available: false, httpStatus: input.healthStatus, label: `HTTP ${input.healthStatus}` };
  }
  if (input.healthReady && input.pageReady) {
    return { available: true, httpStatus: 200, label: "可用" };
  }
  return { available: null, httpStatus: input.pageStatus ?? input.healthStatus, label: "未确认" };
}

export function averageDurationMs(durations: readonly number[]): number | null {
  const values = durations.filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function countdownText(
  startedAt: string | null,
  estimateMs: number | null,
  now = Date.now(),
): string | null {
  if (!startedAt || !estimateMs || estimateMs <= 0) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const remaining = estimateMs - (now - start);
  return remaining >= 0 ? `剩余 ${formatClock(remaining)}` : `超出 ${formatClock(remaining)}`;
}

export function stateIsVisible(_state: PullRequestDisplayState, timestamp: string, now = Date.now()): boolean {
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && at <= now && now - at < PULL_REQUEST_DISPLAY_WINDOW_MS;
}

export function sortPullRequestsByNumberDescending<T extends { number: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.number - left.number);
}

export function sortPartnerRecords<T extends { updatedAt: string; number: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const time = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return time !== 0 ? time : right.number - left.number;
  });
}

export function isActivePartnerDeploy(state: PullRequestDisplayState): boolean {
  return state === "running" || state === "queued";
}

export function partnerStateLabel(kind: PartnerRecordKind, state: PullRequestDisplayState): string {
  if (kind === "commit") return "已提交";
  return stateLabel(state);
}

const PARTNER_DEPLOY_TITLES: Record<string, string> = {
  "install_pg_innertest": "内测全量安装",
  "innertest_hd-pg-app-web": "内测 Web",
  "innertest_hd-pg-app-external-web": "内测 External Web",
  "innertest_hd-pg-app-ws": "内测 WS",
  "innertest_hd-pg-job": "内测 Job",
  "innertest_hd-pg-mq-service": "内测 MQ",
  "innertest_hd-pg-mqag-service": "内测 MQ Agent",
  "innertest_hd-pg-sys": "内测 Sys",
  "innertest_hd-pg-sys-agent": "内测 Sys Agent",
  "innertest_hd-pg-third-ag": "内测 Third AG",
};

export function partnerDeployTitle(jobName: string): string {
  const name = jobName.trim();
  return PARTNER_DEPLOY_TITLES[name]
    ?? (name.startsWith("innertest_") ? `内测 ${name.slice("innertest_".length)}` : name);
}

export function jenkinsBuildState(result: string | null | undefined): PullRequestDisplayState {
  const value = (result ?? "").trim().toLowerCase();
  if (!value) return "running";
  if (["success", "stable"].includes(value)) return "success";
  if (["queued", "waiting", "requested", "pending"].includes(value)) return "queued";
  return "failure";
}

// Cached health must never be presented as a current observation.
export function sitePresentation(site: SiteAvailability | null, stale: boolean) {
  if (!site) return { tone: "unknown" as const, label: "站点待确认", detail: "尚未取得站点健康信息" };
  if (stale || site.available === null) {
    return { tone: "unknown" as const, label: "站点待确认", detail: stale
      ? "状态更新中断，保留上次发布记录"
      : "探测超时或信息不完整，稍后重试" };
  }
  return site.available
    ? { tone: "healthy" as const, label: "站点可访问", detail: "网页与健康接口均已确认" }
    : { tone: "unhealthy" as const, label: "站点暂不可访问", detail: "当前访问异常；历史发布结果保持不变" };
}


export const activePanelStates = new Set(["checking", "waiting", "pending", "verifying", "queued", "batched", "running"]);
export function stageTiming(item: {state: string; startedAt?: string | null; phase?: string | null; phaseStartedAt?: string | null; estimatedDurationMs?: number | null}, now: number): {active: boolean; determinate: boolean; progress: number; time: string | null} {
  if (!activePanelStates.has(item.state)) return {active:false,determinate:false,progress:0,time:null};
  const start=Date.parse(item.startedAt ?? "");
  const estimate=item.estimatedDurationMs;
  const known=Number.isFinite(start) && start<=now;
  if (known && estimate && estimate>0) return {active:true,determinate:true,progress:Math.min(.95,Math.max(.02,(now-start)/estimate)),time:`${item.state === "running" ? "总" : ""}${countdownText(new Date(start).toISOString(),estimate,now)}`};
  const waiting=["queued","waiting","pending","batched"].includes(item.state);
  return {active:true,determinate:false,progress:0,time:known?`待估算 · ${waiting?"已等":"已用"} ${formatClock(now-start)}`:"待估算"};
}

export function displayTitle(value: string): string {
 let title=value.trim();
 for(let i=0;i<4;i++){const next=parsePullRequestTitle(title).title;if(!next || next===title) break;title=next;}
 return title;
}
export function recordEmphasis(state: string, updatedAt: string, now=Date.now()): number {
 if(!["success","no_runtime"].includes(state)) return 1;
 const age=now-Date.parse(updatedAt);return Number.isFinite(age)?Math.max(.68,1-Math.max(0,age)/86400000*.32):1;
}
