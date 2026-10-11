import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadPartnerSnapshot, preservePartnerHistory } from "./release-partner.ts";
import { releaseEnvironment, releaseFetch, closeReleaseHttp } from "./release-http.ts";
import { createReleaseRelay } from "./release-relay.ts";
import {
  ReleaseSnapshotSchema,
  averageDurationMs,
  releaseExecution,
  selectBatchAnchor,
  type ReleaseExecution,
  type ReleaseJob,
  completedWorkflowAt,
  belongsToActiveDeploy,
  formatClock,
  isDefinitelyNonRuntimeFile,
  parsePullRequestTitle,
  successfulRunSkippedRuntime,
  productionSourceCommitFromHealth,
  pullRequestState,
  releaseSnapshot,
  resolveProductionBaseline,
  resolveSiteAvailability,
  runContainsMerge,
  sortPullRequestsByNumberDescending,
  stateIsVisible,
  workflowRunIsActive,
  type PullRequestRelease,
  type ReleaseSnapshot,
} from "../shared/release.ts";

const execFileAsync = promisify(execFile);
const REPOSITORY = "tietiezhi-1216/SlotGame";
const REPO_API = `repos/${REPOSITORY}`;
const PRODUCTION_HEALTH_URL = "https://jamgogogo.com/api/health";
const PRODUCTION_PAGE_URL = "https://jamgogogo.com/api/public/games?platform=jili";
const CACHE_MS = 12_000;

type JsonRecord = Record<string, unknown>;
type WorkflowRun = {
  id: number;
  number: number | null;
  status: string;
  conclusion: string | null;
  headSha: string;
  createdAt: string;
  runStartedAt: string | null;
  updatedAt: string;
  url: string;
  displayTitle: string;
};

type PullRequest = {
  number: number;
  title: string;
  author: string | null;
  titleTag: string | null;
  branchName: string;
  url: string;
  open: boolean;
  draft: boolean;
  updatedAt: string;
  mergedAt: string | null;
  mergeSha: string | null;
};

let cache: { at: number; value: ReleaseSnapshot } | null = null;
let inFlight: Promise<ReleaseSnapshot> | null = null;
let operation: AbortController | null = null;
let stopped = false, revision = 0, lastStarted = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const relay = createReleaseRelay(() => { revision++; if (cache) cache.at = 0; });
const cacheFile = join(homedir(), ".paseo", "tietiezhi", "release-snapshot.json");
const warmCache = readFile(cacheFile, "utf8").then(text => {
  const parsed = ReleaseSnapshotSchema.safeParse(JSON.parse(text));
  if (parsed.success && !cache) cache = { at: 0, value: parsed.data };
}).catch(() => {});
export function releaseHeartbeat() {
  if (!stopped) {
    relay.start(); clearTimeout(idle);
    idle = setTimeout(() => relay.stop(), 120_000);
  }
  return { revision, connected: relay.connected() };
}
export async function disposeReleaseSnapshot() {
  stopped = true; operation?.abort(); clearTimeout(idle); relay.stop();
  await inFlight?.catch(() => {});
  await closeReleaseHttp();
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function ghJson<T>(endpoint: string, timeout = 25_000): Promise<T> {
  const signal = operation?.signal;
  signal?.throwIfAborted();
  const environment = await releaseEnvironment();
  signal?.throwIfAborted();
  const { stdout } = await execFileAsync("gh", ["api", endpoint], {
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    signal,
    env: { ...environment, GH_PAGER: "cat", PAGER: "cat", NO_COLOR: "1" },
  });
  return JSON.parse(stdout) as T;
}

export function normalizePullRequest(value: unknown): PullRequest | null {
  const row = record(value);
  const prNumber = number(row.number);
  const parsedTitle = parsePullRequestTitle(text(row.title));
  const branchName = text(record(row.head).ref).trim();
  const url = text(row.html_url);
  const updatedAt = text(row.updated_at);
  if (!prNumber || !parsedTitle.title || !branchName || !url || !updatedAt) return null;
  return {
    number: prNumber,
    title: parsedTitle.title,
    author: text(record(row.user).login).trim() || null,
    titleTag: parsedTitle.tag,
    branchName,
    url,
    open: text(row.state) === "open",
    draft: row.draft === true,
    updatedAt,
    mergedAt: text(row.merged_at) || null,
    mergeSha: text(row.merge_commit_sha).toLowerCase() || null,
  };
}

function normalizeRun(value: unknown): WorkflowRun | null {
  const row = record(value);
  const status = text(row.status);
  const createdAt = text(row.created_at);
  if (!status || !createdAt) return null;
  const linked = Array.isArray(row.pull_requests) ? record(row.pull_requests[0]) : {};
  const titleMatch = /PR #?(\d+)/u.exec(text(row.display_title));
  return {
    id: number(row.id) ?? 0,
    number: number(linked.number) ?? (titleMatch ? Number(titleMatch[1]) : null),
    status,
    conclusion: text(row.conclusion) || null,
    headSha: text(row.head_sha).toLowerCase(),
    createdAt,
    runStartedAt: text(row.run_started_at) || null,
    updatedAt: text(row.updated_at) || createdAt,
    url: text(row.html_url),
    displayTitle: text(row.display_title),
  };
}

async function fetchWorkflowRuns(workflow: string): Promise<WorkflowRun[]> {
  const value = await ghJson<JsonRecord>(`${REPO_API}/actions/workflows/${workflow}/runs?per_page=100`);
  const rows = Array.isArray(value.workflow_runs) ? value.workflow_runs : [];
  return rows.map(normalizeRun).filter((run): run is WorkflowRun => run !== null);
}

type HttpProbe = {
  httpStatus: number | null;
  body: unknown;
};

async function probeJsonOnce(url: string, timeoutMs: number, signal?: AbortSignal): Promise<HttpProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await releaseFetch(`${url}${url.includes("?") ? "&" : "?"}probe=${Date.now()}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const textBody = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(textBody);
    } catch {
      body = null;
    }
    return { httpStatus: response.status, body };
  } catch {
    return { httpStatus: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function probeJson(url: string): Promise<HttpProbe> {
  const signal = operation?.signal;
  const first = await probeJsonOnce(url, 8_000, signal);
  if (signal?.aborted || first.httpStatus !== null) return first;
  return probeJsonOnce(url, 8_000, signal);
}

function healthReady(probe: HttpProbe): boolean {
  if (probe.httpStatus !== 200 || !probe.body || typeof probe.body !== "object") return false;
  return (probe.body as { status?: unknown }).status === "ok"
    && productionSourceCommitFromHealth(probe.body) !== null;
}

function pageReady(probe: HttpProbe): boolean {
  if (probe.httpStatus !== 200 || !probe.body || typeof probe.body !== "object") return false;
  return Array.isArray((probe.body as { games?: unknown }).games);
}

async function fetchDeploySamples(runs: WorkflowRun[]): Promise<{
  lastPublishedAt: string | null; durations: number[]; byProfile: Record<"gateway" | "light", number[]>;
}> {
  // Current timing uses actual runner execution, never workflow scheduling timestamps.
  type Sample = { completed: string | null; started: string | null; profile: ReleaseExecution["profile"] };
  const cachePath = join(tmpdir(), `tietiezhi-deploy-execution-v1-${process.getuid?.() ?? "local"}.json`);
  let saved: Record<string, Sample> = {};
  try { saved = JSON.parse(await readFile(cachePath, "utf8")); } catch { /* cold cache */ }
  const recent = runs.filter(run => run.status === "completed" && run.conclusion === "success").slice(0, 10);
  const samples = await Promise.all(recent.map(async run => {
    const key = `${run.id}:${run.updatedAt}`;
    let sample = saved[key];
    if (sample === undefined) {
      try {
        const result = await ghJson<JsonRecord>(`${REPO_API}/actions/runs/${run.id}/jobs?per_page=100`, 6_000);
        const jobs = Array.isArray(result.jobs) ? result.jobs.map(record) : [];
        if (jobs.length !== Number(result.total_count)) return null;
        const execution = releaseExecution(jobs as ReleaseJob[]);
        sample = { completed: completedWorkflowAt(jobs, Number(result.total_count)),
          started: execution.startedAt, profile: execution.profile };
        saved[key] = sample;
      } catch { return null; }
    }
    return sample;
  }));
  try {
    const temporary = `${cachePath}.${process.pid}`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(Object.entries(saved).slice(-200))), {mode: 0o600});
    await rename(temporary, cachePath);
  } catch { /* Cache failure never prevents status reads. */ }
  const byProfile: Record<"gateway" | "light", number[]> = { gateway: [], light: [] };
  const published: string[] = [];
  for (const sample of samples) {
    if (!sample?.completed) continue;
    published.push(sample.completed);
    const duration = Date.parse(sample.completed) - Date.parse(sample.started ?? "");
    if (sample.profile && Number.isFinite(duration) && duration > 0 && duration <= 24 * 60 * 60_000) {
      byProfile[sample.profile].push(duration);
    }
  }
  return { lastPublishedAt: published.sort().at(-1) ?? null,
    durations: [...byProfile.gateway, ...byProfile.light], byProfile };
}

async function commitsAfterProduction(productionSha: string | null, currentSha: string): Promise<{
  exact: boolean;
  complete: boolean;
  commits: Set<string>;
}> {
  if (!productionSha) return { exact: false, complete: false, commits: new Set() };
  if (productionSha === currentSha) return { exact: true, complete: true, commits: new Set() };
  const comparison = await ghJson<JsonRecord>(`${REPO_API}/compare/${productionSha}...${currentSha}`);
  const rows = Array.isArray(comparison.commits) ? comparison.commits : [];
  const commits = new Set(rows.map((item) => text(record(item).sha).toLowerCase()).filter(Boolean));
  const total = number(comparison.total_commits);
  const status = text(comparison.status).toLowerCase();
  return {
    exact: status === "identical",
    complete: status === "ahead" && total !== null && total <= rows.length,
    commits,
  };
}

function includedInProduction(
  mergeSha: string | null,
  productionSha: string | null,
  comparison: { exact: boolean; complete: boolean; commits: Set<string> },
): boolean | null {
  if (!mergeSha || !productionSha) return null;
  if (mergeSha === productionSha || comparison.exact) return true;
  if (comparison.commits.has(mergeSha)) return false;
  return comparison.complete ? true : null;
}

type CommitComparison = Awaited<ReturnType<typeof commitsAfterProduction>>;

async function jobsForRun(runId: number): Promise<JsonRecord[] | null> {
  try {
    const result = await ghJson<JsonRecord>(`${REPO_API}/actions/runs/${runId}/jobs?per_page=100`, 6_000);
    const jobs = Array.isArray(result.jobs) ? result.jobs.map(record) : [];
    if (jobs.length !== Number(result.total_count)) return null;
    return jobs;
  } catch {
    return null;
  }
}

async function releasePhase(run: WorkflowRun): Promise<{
  label: string; phase: "building" | "deploying" | "verifying" | null; startedAt: string | null; execution: ReleaseExecution;
}> {
  if (run.status !== "in_progress") return { label: "等待前序批次", phase: null, startedAt: null,
    execution: { status: "queued", startedAt: null, profile: null } };
  const jobs = await jobsForRun(run.id);
  const execution = releaseExecution((jobs ?? []) as ReleaseJob[]);
  const base = { phase: null, startedAt: null, execution };
  if (execution.status === "queued") return { ...base, label: "等待前序批次" };
  if (!jobs || execution.status === "unknown") return { ...base, label: "执行状态待确认" };
  const publicHealth = jobs.find(job => text(job.name) === "Verify public 118 health" && text(job.status) === "in_progress");
  if (publicHealth) return { label: "公网健康验证", phase: "verifying", startedAt: text(publicHealth.started_at) || null, execution };
  const deploy = jobs.find(job => text(job.name) === "deploy");
  const steps = Array.isArray(deploy?.steps) ? deploy.steps.map(record) : [];
  const step = steps.find(item => text(item.status) === "in_progress");
  const name = text(step?.name);
  const startedAt = text(step?.started_at) || null;
  if (name.includes("Install verified")) return { label: "118 安装与健康验证", phase: "deploying", startedAt, execution };
  if (name.includes("Validate Gateway")) return { label: "隔离环境校验", phase: "verifying", startedAt, execution };
  if (name.includes("Build cumulative")) return { label: "Linux制品构建", phase: "building", startedAt, execution };
  return { ...base, label: "执行收尾" };
}

const scopeCachePath = join(tmpdir(), `tietiezhi-release-scope-v2-${process.getuid?.() ?? "local"}.json`);
const scopeCache = readFile(scopeCachePath,"utf8").then(s=>JSON.parse(s) as Record<string,boolean>).catch(()=>({} as Record<string,boolean>));
async function nonRuntimeScope(pr: PullRequest): Promise<boolean | null> {
  const cache = await scopeCache;
  const key = `${pr.number}:${pr.mergeSha}`;
  if (typeof cache[key] === "boolean") return cache[key];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ghJson<unknown[]>(`${REPO_API}/pulls/${pr.number}/files?per_page=100`, 6_000);
      // GitHub paginates at 100; an incomplete list cannot prove a no-op.
      if (!Array.isArray(response) || response.length === 0 || response.length >= 100) return null;
      return cache[key] = response.every((item) => isDefinitelyNonRuntimeFile(text(record(item).filename)));
    } catch {
      // One bounded retry covers transient GitHub/proxy failures without
      // exceeding the native snapshot runner's 35-second deadline.
    }
  }
  return null;
}

function buildFailureReason(
  state: PullRequestRelease["state"],
  open: boolean,
  run: WorkflowRun | null,
): string | null {
  if (state !== "failure") return null;
  if (open) return "PR 检查或自动合并失败";
  return run ? `累计发布 #${run.id} 未通过 Linux构建与118发布门禁` : "累计发布未通过 Linux构建与118发布门禁";
}

async function buildSnapshot(): Promise<ReleaseSnapshot> {
  const [pullsValue, prRuns, deployRuns, mainValue, healthProbe, pageProbe, partner] = await Promise.all([
    ghJson<unknown[]>(`${REPO_API}/pulls?state=all&sort=updated&direction=desc&per_page=100`),
    fetchWorkflowRuns("auto-merge-pr.yml"),
    fetchWorkflowRuns("deploy-linux.yml"),
    ghJson<JsonRecord>(`${REPO_API}/commits/main`),
    probeJson(PRODUCTION_HEALTH_URL),
    probeJson(PRODUCTION_PAGE_URL),
    loadPartnerSnapshot(operation?.signal),
  ]);
  const currentSha = text(mainValue.sha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(currentSha)) throw new Error("无法读取 main 提交");
  const productionSha = healthReady(healthProbe) ? productionSourceCommitFromHealth(healthProbe.body) : null;
  const site = resolveSiteAvailability({
    healthStatus: healthProbe.httpStatus,
    healthReady: healthReady(healthProbe),
    pageStatus: pageProbe.httpStatus,
    pageReady: pageReady(pageProbe),
  });
  const lastSuccessfulDeploy = deployRuns.find((run) => run.conclusion === "success" && run.status === "completed") ?? null;
  const baselineSha = resolveProductionBaseline(productionSha, lastSuccessfulDeploy?.headSha ?? null);
  const { lastPublishedAt, durations, byProfile } = await fetchDeploySamples(deployRuns);
  const comparison = await commitsAfterProduction(baselineSha, currentSha);
  const checksByPr = new Map<number, WorkflowRun>();
  for (const run of prRuns) {
    if (run.number && !checksByPr.has(run.number)) checksByPr.set(run.number, run);
  }
  const activeRuns = deployRuns
    .filter((run) => workflowRunIsActive(run.status))
    .sort((left, right) => (left.status === "in_progress" ? 0 : 1)
      - (right.status === "in_progress" ? 0 : 1)
      || Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const visiblePulls = pullsValue
    .map(normalizePullRequest)
    .filter((pr): pr is PullRequest => pr !== null && (pr.open || pr.mergedAt !== null)
      && stateIsVisible("pending", pr.mergedAt ?? pr.updatedAt));
  const comparisons = new Map<number, CommitComparison>();
  await Promise.all(activeRuns.map(async (run) => {
    comparisons.set(run.id, run.headSha === currentSha ? comparison
      : await commitsAfterProduction(baselineSha, run.headSha));
  }));
  const lastFailed = deployRuns.find((run) => run.conclusion === "failure") ?? null;
  const failedComparison = lastFailed
    ? lastFailed.headSha === currentSha ? comparison
      : await commitsAfterProduction(baselineSha, lastFailed.headSha)
    : null;
  // The successful gate has its own baseline. Reusing the production comparison
  // when its head equals currentSha would incorrectly treat older no-op PRs as
  // newer than the gate after a second successful no-op deployment.
  const successComparison = lastSuccessfulDeploy
    ? await commitsAfterProduction(lastSuccessfulDeploy.headSha, currentSha)
    : null;
  const productionByPr = new Map<number, boolean | null>();
  const activeByPr = new Map<number, WorkflowRun>();
  for (const pr of visiblePulls) {
    const inProduction = pr.open ? null : includedInProduction(pr.mergeSha, baselineSha, comparison);
    productionByPr.set(pr.number, inProduction);
    const run = activeRuns.find((candidate) => belongsToActiveDeploy({
      open: pr.open,
      inProduction,
      deployIsActive: true,
      inDeployHead: runContainsMerge(candidate, pr.mergeSha,
        comparisons.get(candidate.id) ?? { exact: false, complete: false, commits: new Set() }),
    }));
    if (run) activeByPr.set(pr.number, run);
  }
  const noRuntimePrs = new Set<number>();
  const unverifiedPrs = new Set<number>();
  const candidates = visiblePulls.filter((pr) => !pr.open
    && lastSuccessfulDeploy && successComparison
    && includedInProduction(pr.mergeSha, lastSuccessfulDeploy.headSha, successComparison) === true);
  const gateJobs = lastSuccessfulDeploy ? await jobsForRun(lastSuccessfulDeploy.id) : null;
  const skippedRuntime = gateJobs ? successfulRunSkippedRuntime(gateJobs.map((job) => ({
    name: text(job.name),
    status: text(job.status),
    conclusion: text(job.conclusion) || null,
    steps: Array.isArray(job.steps) ? job.steps.map(record).map((step) => ({
      name: text(step.name),
      status: text(step.status),
      conclusion: text(step.conclusion) || null,
    })) : [],
  }))) : null;
  // The deploy job's empty component plan is authoritative. Do not leave those
  // PRs pending just because a changed path is absent from the file allowlist.
  if (skippedRuntime === true) {
    for (const pr of candidates) noRuntimePrs.add(pr.number);
  } else {
    // Bound concurrent GitHub requests: only PRs already covered by a successful
    // release gate may be called "no runtime release needed".
    for (let offset = 0; offset < candidates.length; offset += 6) {
      const batch = candidates.slice(offset, offset + 6);
      const results = await Promise.all(batch.map(nonRuntimeScope));
      batch.forEach((pr, index) => {
        if (results[index] === true) noRuntimePrs.add(pr.number);
        else if (results[index] === null) unverifiedPrs.add(pr.number);
      });
    }
  }
  // File scope selects a meaningful batch title; it cannot mark a PR delivered before its gate succeeds.
  const activePulls = visiblePulls.filter(pr => activeByPr.has(pr.number));
  const scopeByPr = new Map<number, boolean | null>();
  for (let offset = 0; offset < activePulls.length; offset += 6) {
    const batch = activePulls.slice(offset, offset + 6);
    const scopes = await Promise.all(batch.map(nonRuntimeScope));
    batch.forEach((pr, index) => scopeByPr.set(pr.number, scopes[index]));
  }
  try { await writeFile(scopeCachePath, JSON.stringify(await scopeCache), {mode:0o600}); } catch { /* Optional immutable PR-scope cache. */ }
  const anchors = new Map<number, number>();
  for (const run of activeRuns) {
    const members = activePulls.filter(pr => activeByPr.get(pr.number)?.id === run.id && !noRuntimePrs.has(pr.number));
    const anchor = selectBatchAnchor(members.map(pr => ({ number: pr.number, nonRuntime: scopeByPr.get(pr.number) ?? null })));
    if (anchor !== null) anchors.set(run.id, anchor);
  }
  const phases = new Map<number, Awaited<ReturnType<typeof releasePhase>>>();
  await Promise.all(activeRuns.map(async (run) => { phases.set(run.id, await releasePhase(run)); }));
  const running = activeRuns.find(run => run.status === "in_progress" && phases.get(run.id)?.execution.status !== "queued") ?? null;
  const runningAnchor = running ? anchors.get(running.id) : null;
  const currentProfile = running ? phases.get(running.id)?.execution.profile : null;
  const channelDurations = currentProfile ? byProfile[currentProfile] : durations;
  const averageDuration = averageDurationMs(channelDurations);
  const pullRequests = visiblePulls
    .map((pr): PullRequestRelease => {
      const check = checksByPr.get(pr.number) ?? null;
      const inProduction = productionByPr.get(pr.number) ?? null;
      const noRuntimeConfirmed = noRuntimePrs.has(pr.number);
      const run = activeByPr.get(pr.number) ?? null;
      const ownsDeployTimer = !!run && pr.number === anchors.get(run.id);
      const failedRun = !run && lastFailed && failedComparison
        && inProduction === false && runContainsMerge(lastFailed, pr.mergeSha, failedComparison)
          ? lastFailed : null;
      const state = pullRequestState({
        open: pr.open,
        draft: pr.draft,
        checkStatus: check?.status,
        checkConclusion: check?.conclusion,
        inProduction,
        deployStatus: run && phases.get(run.id)?.execution.status === "queued" ? "queued" : run?.status,
        deployConclusion: failedRun?.conclusion,
        includedInActiveDeploy: !!run,
        ownsDeployTimer,
        noRuntimeConfirmed,
        runtimeScopeUnverified: unverifiedPrs.has(pr.number),
      });
      const anchor = run ? anchors.get(run.id) : null;
      const execution = run ? phases.get(run.id)?.execution : null;
      const samples = execution?.profile ? byProfile[execution.profile] : [];
      const estimate = averageDurationMs(samples);
      const queueMs = run && execution?.startedAt ? Date.parse(execution.startedAt) - Date.parse(run.createdAt) : null;
      const queueNote = queueMs !== null && queueMs >= 0 ? `排队 ${formatClock(queueMs)} · 执行计时不含等待` : "";
      const averageNote = estimate ? `同类执行平均 ${formatClock(estimate)} · ${samples.length} 次成功发布` : "暂无同类执行样本";
      const batchNote = state === "no_runtime"
          ? "已合并；发布检查通过，无需更新生产运行单元"
        : state === "verifying"
          ? "GitHub 变更文件暂不可用；不能确认是否需要生产发布，稍后重试"
        : run && anchor
          ? state !== "queued"
            ? `同批 #${anchor} · ${phases.get(run.id)?.label ?? "执行状态待确认"} · run ${run.id} · ${queueNote} · ${averageNote}`
            : `${runningAnchor ? `等待 #${runningAnchor} 发布完成` : "等待发布槽位"} · 批次 #${anchor}`
          : null;
      return {
        number: pr.number,
        title: pr.title,
        author: pr.author,
        titleTag: pr.titleTag,
        branchName: pr.branchName,
        url: pr.url,
        state,
        updatedAt: pr.mergedAt ?? pr.updatedAt,
        mergedAt: pr.mergedAt,
        startedAt: state === "checking" ? check?.runStartedAt || check?.createdAt || null
          : state === "queued" ? run?.createdAt || null
          : state === "pending" ? pr.mergedAt
          : state === "waiting" ? check?.updatedAt || null
          : state === "running" ? execution?.startedAt ?? null : null,
        phase: state === "running" && run ? phases.get(run.id)?.phase ?? null : null,
        phaseStartedAt: state === "running" && run ? phases.get(run.id)?.startedAt ?? null : null,
        estimatedDurationMs: state === "running" ? estimate : null,
        failureReason: buildFailureReason(state, pr.open, failedRun),
        batchNote,
      };
    });
  const sortedPullRequests = sortPullRequestsByNumberDescending(pullRequests);
  const releaseSummary = running
    ? `${phases.get(running.id)?.label ?? "部署中"} · #${runningAnchor ?? "?"}`
      + (activeRuns.some((run) => run.status !== "in_progress") ? " · 后续排队" : "")
    : activeRuns.length ? "发布批次等待执行" : null;
  return {
    fetchedAt: new Date().toISOString(),
    githubStats: { lastPublishedAt, estimatedDurationMs: averageDuration, sampleCount: channelDurations.length },
    svnStats: partner.stats,
    releaseSummary,
    site,
    averageDurationMs: averageDuration,
    durationSampleCount: channelDurations.length,
    pullRequests: sortedPullRequests,
    partnerRecords: preservePartnerHistory(partner, cache?.value.partnerRecords ?? []),
    warnings: [
      ...(!productionSha && !baselineSha ? ["暂时无法读取 118 生产 receipt"] : []),
      ...partner.warnings,
    ],
    error: null,
  };
}

export async function handleReleaseSnapshot(input: { refresh?: boolean } = {}): Promise<ReleaseSnapshot> {
  if (stopped) throw new Error("发布面板已停止");
  releaseHeartbeat();
  await warmCache;
  if (inFlight) return inFlight;
  if (cache && ((!input.refresh && Date.now() - cache.at < CACHE_MS)
    || Date.now() - lastStarted < CACHE_MS)) return cache.value;
  operation = new AbortController();
  const source = operation;
  const deadline = setTimeout(() => source.abort(), 35_000);
  lastStarted = Date.now();
  inFlight = buildSnapshot()
    .then(async (value) => {
      source.signal.throwIfAborted();
      if (stopped) throw new Error("发布面板已停止");
      cache = { at: Date.now(), value };
      try {
        await mkdir(join(homedir(), ".paseo", "tietiezhi"), { recursive: true });
        const temporary = cacheFile + "." + process.pid;
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, signal: source.signal });
        await rename(temporary, cacheFile);
      } catch { /* Optional isolated cache; never modify the macOS App cache. */ }
      return value;
    })
    .catch(() => {
      source.abort();
      const error = "发布记录读取失败，等待自动同步";
      if (cache) { cache.value = { ...cache.value, error }; return cache.value; }
      const value: ReleaseSnapshot = { fetchedAt: "", githubStats: { lastPublishedAt: null, estimatedDurationMs: null, sampleCount: 0 },
        svnStats: { lastPublishedAt: null, estimatedDurationMs: null, sampleCount: 0 },
        releaseSummary: null, site: null, averageDurationMs: null, durationSampleCount: 0,
        pullRequests: [], partnerRecords: [], warnings: [], error };
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => { clearTimeout(deadline); inFlight = null; operation = null; });
  return inFlight;
}

export { releaseSnapshot };
