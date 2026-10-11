import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  averageDurationMs,
  stageTiming,
  deploymentStats,
  completedWorkflowAt,
  belongsToActiveDeploy,
  countdownText,
  formatClock,
  isDefinitelyNonRuntimeFile,
  successfulRunSkippedRuntime,
  isActivePartnerDeploy,
  jenkinsBuildState,
  parsePullRequestTitle,
  partnerDeployTitle,
  partnerStateLabel,
  productionSourceCommitFromHealth,
  pullRequestState,
  resolveProductionBaseline,
  resolveSiteAvailability,
  runContainsMerge,
  sortPartnerRecords,
  sortPullRequestsByNumberDescending,
  sitePresentation,
  PullRequestDisplayStateSchema,
  stateIsVisible,
  stateLabel,
  workflowConclusionIsFailure,
  workflowRunIsActive,
} from "../shared/release.ts";
import {
  jenkinsDeploymentStats,
  partnerConfiguration,
  groupJenkinsDeployments,
  partnerRecordsFromJenkinsQueue,
  parseSecretSections,
  parseSvnLogXml,
  partnerRecordsFromJenkinsJobs,
} from "../server/release-partner.ts";

test("English and Chinese PR prefixes become labels instead of title text", () => {
  assert.deepEqual(parsePullRequestTitle("feat(gateway): switch all JILI rooms"), {
    tag: "feat(gateway)",
    title: "switch all JILI rooms",
  });
  assert.deepEqual(parsePullRequestTitle("修复（TaDa）：在历史记录中显示入口图标"), {
    tag: "修复（TaDa）",
    title: "在历史记录中显示入口图标",
  });
  assert.deepEqual(parsePullRequestTitle("优化: PR 面板展示"), {
    tag: "优化",
    title: "PR 面板展示",
  });
  assert.deepEqual(parsePullRequestTitle("没有约定前缀的标题"), {
    tag: null,
    title: "没有约定前缀的标题",
  });
  assert.deepEqual(parsePullRequestTitle("说明：不应误识别未知前缀"), {
    tag: null,
    title: "说明：不应误识别未知前缀",
  });
});

test("production receipt accepts only an exact 40 character SHA", () => {
  assert.equal(productionSourceCommitFromHealth({ sourceCommit: "a".repeat(40) }), "a".repeat(40));
  assert.equal(productionSourceCommitFromHealth({ sourceCommit: "short" }), null);
  assert.equal(productionSourceCommitFromHealth(null), null);
});

test("cancelled and skipped workflow runs are not failures", () => {
  assert.equal(workflowConclusionIsFailure("failure"), true);
  assert.equal(workflowConclusionIsFailure("timed_out"), true);
  assert.equal(workflowConclusionIsFailure("cancelled"), false);
  assert.equal(workflowConclusionIsFailure("skipped"), false);
  assert.equal(workflowConclusionIsFailure("neutral"), false);
});

test("open PR state comes from its check workflow", () => {
  assert.equal(pullRequestState({ open: true, draft: false, checkStatus: "in_progress" }), "checking");
  assert.equal(pullRequestState({ open: true, draft: false, checkStatus: "queued" }), "waiting");
  assert.equal(pullRequestState({ open: true, draft: true }), "waiting");
  assert.equal(pullRequestState({ open: true, draft: false, checkConclusion: "failure" }), "failure");
});

test("active deploy only covers PRs not yet in the production baseline", () => {
  const shipped = "a".repeat(40);
  const next = "b".repeat(40);
  assert.equal(resolveProductionBaseline(null, shipped), shipped);
  assert.equal(resolveProductionBaseline(next, shipped), next);
  assert.equal(resolveProductionBaseline("short", shipped), shipped);
  assert.equal(workflowRunIsActive("in_progress"), true);
  assert.equal(workflowRunIsActive("success"), false);
  assert.equal(belongsToActiveDeploy({ open: false, inProduction: true, deployIsActive: true, inDeployHead: true }), false);
  assert.equal(belongsToActiveDeploy({ open: false, inProduction: false, deployIsActive: true, inDeployHead: true }), true);
  assert.equal(belongsToActiveDeploy({ open: false, inProduction: false, deployIsActive: true, inDeployHead: false }), false);
  assert.equal(belongsToActiveDeploy({ open: false, inProduction: null, deployIsActive: true, inDeployHead: true }), false);
  assert.equal(pullRequestState({
    open: false,
    draft: false,
    inProduction: true,
    deployStatus: "in_progress",
    includedInActiveDeploy: true,
  }), "success");
});

test("merged PR state follows authoritative production and cumulative deploy", () => {
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: true }), "success");
  assert.equal(pullRequestState({
    open: false,
    draft: false,
    inProduction: false,
    deployStatus: "in_progress",
    includedInActiveDeploy: true,
  }), "running");
  assert.equal(pullRequestState({
    open: false,
    draft: false,
    inProduction: false,
    deployStatus: "queued",
    includedInActiveDeploy: true,
  }), "queued");
  assert.equal(pullRequestState({
    open: false,
    draft: false,
    inProduction: false,
    deployStatus: "in_progress",
    includedInActiveDeploy: true,
    ownsDeployTimer: false,
  }), "batched");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: false }), "pending");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: false, deployConclusion: "failure" }), "failure");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: false, noRuntimeConfirmed: true }), "no_runtime");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: false, runtimeScopeUnverified: true }), "verifying");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: false,
    runtimeScopeUnverified: true, deployConclusion: "failure" }), "failure");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: true,
    runtimeScopeUnverified: true }), "success");
  assert.equal(pullRequestState({ open: false, draft: false, inProduction: true, noRuntimeConfirmed: true }), "no_runtime");
});

test("a newer PR is not falsely attached to the older active release", () => {
  const old = "a".repeat(40);
  const newer = "b".repeat(40);
  const active = { headSha: old };
  const comparison = { exact: false, complete: true, commits: new Set([old]) };
  assert.equal(runContainsMerge(active, old, comparison), true);
  assert.equal(runContainsMerge(active, newer, comparison), false);
  assert.equal(runContainsMerge({ headSha: newer }, newer,
    { exact: false, complete: false, commits: new Set() }), true);
  assert.equal(runContainsMerge(active, newer,
    { exact: false, complete: false, commits: new Set([newer]) }), false);
});

test("no-runtime classification is conservative for unknown and provider paths", () => {
  for (const file of [".agents/skills/x.md", "scripts/lib/source.mjs",
    "deploy/native/check-pr.sh", "games/tada/rooms/109_tada/src/test/java/Example.java",
    "gateway/migrations/testdata/v154_legacy.sql", ".pi/mcp.json"]) {
    assert.equal(isDefinitelyNonRuntimeFile(file), true, file);
  }
  for (const file of ["games/tada/rooms/109_tada/src/main/java/Room.java",
    "games/tada/pom.xml", "gateway/internal/server/server.go",
    "formation/scripts/tada/109/main.py", "web/src/main.ts",
    "deploy/native/formation-python-toolchain.sh", "unknown.bin"]) {
    assert.equal(isDefinitelyNonRuntimeFile(file), false, file);
  }
});

test("an empty component plan covers the release gate without a file allowlist", () => {
  const health = { name: "Verify public 118 health", status: "completed", conclusion: "skipped" };
  const deploy = { name: "deploy", status: "completed", conclusion: "success", steps: [] };
  assert.equal(successfulRunSkippedRuntime([
    { ...deploy, steps: [{ name: "Record no runtime release", status: "completed", conclusion: "success" }] },
    health,
  ]), true);
  assert.equal(successfulRunSkippedRuntime([
    { ...deploy, steps: [{ name: "Install verified artifacts on 118", status: "completed", conclusion: "success" }] },
    health,
  ]), true);
  assert.equal(successfulRunSkippedRuntime([
    deploy,
    { name: "Verify public 118 health", status: "completed", conclusion: "success" },
  ]), false);
  assert.equal(successfulRunSkippedRuntime([
    { ...deploy, steps: [{ name: "Install verified artifacts on 118", conclusion: "skipped" }] },
    health,
  ]), null);
  assert.equal(successfulRunSkippedRuntime([]), null);
  assert.equal(successfulRunSkippedRuntime([
    { name: "deploy", status: "completed", conclusion: "failure" },
  ]), false);
});

test("every PR state uses the same recent 24 hour display window", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.equal(stateIsVisible("success", "2026-09-10T12:00:01Z", now), true);
  assert.equal(stateIsVisible("failure", "2026-09-10T11:59:59Z", now), false);
  assert.equal(stateIsVisible("checking", "2026-09-11T00:00:00Z", now), true);
});

test("PR rows sort strictly by PR number descending", () => {
  const rows = [{ number: 17 }, { number: 240 }, { number: 99 }];
  assert.deepEqual(sortPullRequestsByNumberDescending(rows).map((row) => row.number), [240, 99, 17]);
  assert.deepEqual(rows.map((row) => row.number), [17, 240, 99]);
});

test("plugin source uses PR number, title tag, and title as its display identity", async () => {
  const files = await Promise.all([
    readFile(new URL("../shared/release.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/release.ts", import.meta.url), "utf8"),
    readFile(new URL("../client/release.tsx", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.match(source, /PullRequestRelease/);
  assert.match(source, /branchName/);
  assert.match(source, /titleTag/);
  assert.match(source, /item\.title/);
  assert.match(files[2], /#\$\{item\.number\}/);
  assert.match(source, /partnerRecords/);
  assert.match(source, /SVN 部署/);
  assert.match(source, /最近 24 小时没有 SVN 提交/);
  assert.match(source, /resolveProductionBaseline/);
  assert.match(source, /belongsToActiveDeploy/);
  assert.doesNotMatch(source, /stateForLiveSite/);
  assert.match(source, /averageDurationMs/);
  assert.match(source, /api\/public\/games/);
  assert.match(files[1], /commitsAfterProduction\(lastSuccessfulDeploy\.headSha, currentSha\)/);
  assert.doesNotMatch(files[1], /lastSuccessfulDeploy\.headSha === currentSha \? comparison/);
  assert.doesNotMatch(files[1], /已按最近一次成功发布估算上线范围/);
  assert.doesNotMatch(source, /Date\.parse\(pr\.mergedAt\) <= Date\.parse\(latestDeploy\.createdAt\)/);
});

test("site probes distinguish confirmed health, HTTP failure, and incomplete observations", () => {
  assert.deepEqual(resolveSiteAvailability({
    healthStatus: 200, healthReady: true, pageStatus: 200, pageReady: true,
  }), { available: true, httpStatus: 200, label: "可用" });
  for (const [healthStatus, pageStatus] of [[503, 503], [200, 503], [503, 200]]) {
    assert.equal(resolveSiteAvailability({ healthStatus, healthReady: true, pageStatus, pageReady: true }).available, false);
  }
  for (const [healthStatus, healthReady, pageStatus, pageReady] of [
    [null, false, null, false], [200, true, null, false], [200, false, 200, true],
  ]) {
    const site = resolveSiteAvailability({ healthStatus, healthReady, pageStatus, pageReady });
    assert.equal(site.available, null);
    assert.equal(sitePresentation(site, false).tone, "unknown");
  }
});

test("503 with an active deployment leaves successful historical PRs successful", () => {
  const site = resolveSiteAvailability({ healthStatus: 503, healthReady: false, pageStatus: 503, pageReady: false });
  assert.equal(sitePresentation(site, false).label, "站点暂不可访问");
  assert.deepEqual([
    pullRequestState({ open: false, draft: false, inProduction: false, includedInActiveDeploy: true, deployStatus: "in_progress" }),
    ...Array.from({ length: 43 }, () => pullRequestState({ open: false, draft: false, inProduction: true })),
  ], ["running", ...Array(43).fill("success")]);
  assert.equal(PullRequestDisplayStateSchema.safeParse("unavailable").success, false);
});

test("stale and missing observations never show healthy or definitely offline", () => {
  for (const available of [true, false, null]) {
    assert.equal(sitePresentation({ available, httpStatus: 200, label: "可用" }, true).tone, "unknown");
  }
  assert.equal(sitePresentation(null, false).tone, "unknown");
  assert.equal(sitePresentation({ available: true, httpStatus: 200, label: "可用" }, false).tone, "healthy");
});

test("deployment countdown uses the average of every successful duration", () => {
  assert.equal(averageDurationMs([60_000, 120_000, 180_000]), 120_000);
  assert.equal(averageDurationMs([0, -1, Number.NaN]), null);
  assert.equal(formatClock(125_000), "2:05");
  assert.equal(countdownText("2026-09-30T03:00:00Z", 180_000, Date.parse("2026-09-30T03:01:00Z")), "剩余 2:00");
  assert.equal(countdownText("2026-09-30T03:00:00Z", 30_000, Date.parse("2026-09-30T03:01:00Z")), "超出 0:30");
});

test("SECRET.md sections keep colliding keys isolated", () => {
  const sections = parseSecretSections([
    "## 对接方 SVN",
    "URL=https://svn.example/repo",
    "USERNAME=svn-user",
    "PASSWORD=svn-pass",
    "CHECKOUT=/tmp/partner",
    "",
    "## 对接方 Jenkins",
    "URL=http://jenkins.example:8081/",
    "USERNAME=ci",
    "PASSWORD=ci-pass",
  ].join("\n"));
  assert.equal(sections.get("对接方 SVN")?.URL, "https://svn.example/repo");
  assert.equal(sections.get("对接方 Jenkins")?.URL, "http://jenkins.example:8081/");
  assert.equal(sections.get("对接方 Jenkins")?.USERNAME, "ci");
});

test("SVN log XML becomes 24-hour commit records", () => {
  const now = Date.parse("2026-09-17T08:00:00Z");
  const records = parseSvnLogXml(`<?xml version="1.0"?>
<log>
<logentry revision="2255">
<author>xjw</author>
<date>2026-09-17T05:57:00.000000Z</date>
<msg>修复：TaDa History 详情期号查找</msg>
</logentry>
<logentry revision="2200">
<author>old</author>
<date>2026-09-10T05:57:00.000000Z</date>
<msg>过期提交</msg>
</logentry>
</log>`, now);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, "svn:r2255");
  assert.equal(records[0].kind, "commit");
  assert.equal(records[0].titleTag, "修复");
  assert.equal(records[0].title, "TaDa History 详情期号查找");
  assert.equal(records[0].subtitle, "xjw");
  assert.equal(records[0].author, "xjw");
  assert.equal(partnerStateLabel("commit", "success"), "已提交");
});

test("Jenkins jobs become 24-hour deploy records", () => {
  const now = Date.parse("2026-09-17T08:00:00Z");
  const records = partnerRecordsFromJenkinsJobs([
    {
      name: "install_pg_innertest",
      builds: [
        { number: 1143, result: "SUCCESS", timestamp: Date.parse("2026-09-17T06:44:43Z"), duration: 449949, url: "http://jenkins.example/job/install_pg_innertest/1143/" },
        { number: 1100, result: "SUCCESS", timestamp: Date.parse("2026-09-10T06:44:43Z"), duration: 400000, url: "http://jenkins.example/job/install_pg_innertest/1100/" },
        { number: 1144, result: null, timestamp: Date.parse("2026-09-17T07:50:00Z"), duration: 0, url: "http://jenkins.example/job/install_pg_innertest/1144/" },
      ],
    },
  ], now);
  assert.deepEqual(records.map((row) => row.number), [1144]);
  assert.equal(records[0].state, "running");
  assert.equal(records[0].title, "内测全量安装");
  assert.equal(records[0].estimatedDurationMs, Math.round((449949 + 400000) / 2));
  assert.equal(isActivePartnerDeploy("running"), true);
  assert.equal(isActivePartnerDeploy("queued"), true);
  assert.equal(isActivePartnerDeploy("success"), false);
  assert.equal(isActivePartnerDeploy("failure"), false);
  assert.equal(partnerDeployTitle("innertest_hd-pg-app-web"), "内测 Web");
  assert.equal(jenkinsBuildState("FAILURE"), "failure");
  assert.deepEqual(sortPartnerRecords([
    { updatedAt: "2026-09-17T01:00:00Z", number: 1 },
    { updatedAt: "2026-09-17T02:00:00Z", number: 2 },
  ]).map((row) => row.number), [2, 1]);
});


test("发布时间来自完整完成时间，Jenkins估计排除运行、失败与异常样本", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const stats = jenkinsDeploymentStats([{name:"deploy", builds:[
    {timestamp:now-600000,duration:120000,result:"SUCCESS",building:false},
    {timestamp:now-300000,duration:60000,result:"SUCCESS"},
    {timestamp:now-10000,duration:9000,result:null,building:true},
    {timestamp:now-10000,duration:9000,result:"SUCCESS",building:true},
    {timestamp:now-100000,duration:1000,result:"FAILURE"},
    {timestamp:now,duration:60000,result:"SUCCESS"},
    {timestamp:now-100000000,duration:90000000,result:"SUCCESS"},
    {timestamp:now-60000,duration:-1,result:"SUCCESS"},
  ]}],now);
  assert.deepEqual(stats,{lastPublishedAt:new Date(now-240000).toISOString(),estimatedDurationMs:90000,sampleCount:2});
  assert.deepEqual(deploymentStats([],now),{lastPublishedAt:null,estimatedDurationMs:null,sampleCount:0});
  const jobs=[{name:"deploy",conclusion:"success",status:"completed",completed_at:"2026-09-29T01:02:03Z"},{name:"Verify public 118 health",conclusion:"success",status:"completed",completed_at:"2026-09-29T01:03:04Z"}];
  assert.equal(completedWorkflowAt(jobs,2),"2026-09-29T01:03:04.000Z");
  assert.equal(completedWorkflowAt(jobs,3),null);
  assert.equal(completedWorkflowAt([jobs[0]],1),null);
  assert.equal(completedWorkflowAt([{status:"in_progress",completed_at:null}],1),null);
});


test("检查估计和部署总剩余一致，无样本静态待估算且终态不倒计时", () => {
 const now=Date.parse("2026-09-30T12:00:00Z"); const startedAt=new Date(now-45000).toISOString();
 assert.equal(stageTiming({state:"checking",startedAt},now).time,"待估算 · 已用 0:45");
 assert.equal(stageTiming({state:"queued",startedAt},now).time,"待估算 · 已等 0:45");
 assert.equal(stageTiming({state:"checking"},now).time,"待估算");
 assert.equal(stageTiming({state:"checking",startedAt,estimatedDurationMs:60000},now).time,"剩余 0:15");
 assert.equal(stageTiming({state:"queued",startedAt},now).progress,0);
 const run={state:"running",startedAt,estimatedDurationMs:60000};
 assert.equal(stageTiming(run,now).determinate,true);
 assert.equal(stageTiming({...run,phase:"verifying",phaseStartedAt:new Date(now-5000).toISOString()},now).time,"总剩余 0:15");
 assert.equal(stageTiming({...run,phase:"verifying"},now).determinate,true);
 for(const state of ["success","failure"]) assert.equal(stageTiming({...run,state},now).active,false);
});


test("Jenkins uses current configured sections and real queue without invented estimates", () => {
 const sections = parseSecretSections("## 对接方 SVN\nCHECKOUT=/project/partner\n## 对接方 Jenkins\nURL=https://jenkins.example\nUSERNAME=ci\nPASSWORD=test");
 assert.equal(partnerConfiguration(sections).jenkins?.USERNAME,"ci");
 assert.equal(partnerConfiguration(sections).svn?.CHECKOUT,"/project/partner");
 const now=1800000000000;
 const item={id:55,inQueueSince:now-5000,task:{name:"install_pg_innertest"}};
 const queue=partnerRecordsFromJenkinsQueue([item,{...item,id:56,cancelled:true},{...item,id:57,executable:{number:1306}},{...item,id:58,inQueueSince:now+5000}],now);
 assert.equal(queue.length,1);assert.equal(queue[0].state,"queued");assert.equal(queue[0].estimatedDurationMs,null);
 assert.equal(queue[0].startedAt,new Date(now-5000).toISOString());
 assert.equal(partnerRecordsFromJenkinsJobs([{name:"install_pg_innertest",builds:[{number:1,timestamp:now-1000,building:false,result:null}]}],now).length,0);
});


test("same job build and distinct queue retain both identities in one card", () => {
 const now=1800000000000;
 const build=partnerRecordsFromJenkinsJobs([{name:"install_pg_innertest",builds:[{number:1307,timestamp:now-1000,building:true,result:null}]}],now)[0];
 const queue=partnerRecordsFromJenkinsQueue([{id:6900,inQueueSince:now-500,task:{name:"install_pg_innertest"}},{id:6901,inQueueSince:now-200,task:{name:"innertest_hd-pg-app-web"}}],now);
 const grouped=groupJenkinsDeployments([build,...queue]);
 assert.equal(groupJenkinsDeployments([{...build,queueId:6900},queue[0]]).length,1);
 assert.equal(grouped.length,2);assert.equal(grouped[0].number,1307);assert.deepEqual(grouped[0].queuedIds,[6900]);
 assert.equal(grouped[1].number,6901);assert.equal(grouped[1].state,"queued");assert.equal(build.queuedIds,undefined);
 assert.equal(groupJenkinsDeployments([build,{...build,id:"second",number:1308},...queue]).filter(x=>x.state==="running").length,2);
});

test('docs-only receipts and gitignore are not pending runtime deploys',()=>{
 for(const p of ['.gitignore','exports/platform/jili180-partner-sync/receipt.json','.agents/knowledge/guide.md']) assert.equal(isDefinitelyNonRuntimeFile(p),true);
 for(const p of ['gateway/src/main/java/Service.java','web/src/main.ts','games/jili/rules.json']) assert.equal(isDefinitelyNonRuntimeFile(p),false);
});


test('PR author uses API user login; missing author stays unknown', async()=>{
 const {normalizePullRequest}=await import('../server/release.ts');
 const raw={number:1232,title:'文档：提交回执',head:{ref:'topic'},html_url:'https://example.com/pr',updated_at:'2026-10-01T00:00:00Z',user:{login:'real-author'}};
 assert.equal(normalizePullRequest(raw).author,'real-author');
 assert.equal(normalizePullRequest({...raw,user:null}).author,null);
});

 test('successful gate proves docs-only even when baseline contains merge',()=>{
 assert.equal(pullRequestState({open:false,draft:false,inProduction:true,noRuntimeConfirmed:true}), 'no_runtime');
 });


test("SVN author preserves Unicode and XML escaping; missing identity stays unknown", () => {
  const now = Date.parse("2026-10-01T08:00:00Z");
  const records = parseSvnLogXml(`<log>
    <logentry revision="3"><author>张三&amp;团队</author><date>2026-10-01T07:00:00Z</date><msg>更新</msg></logentry>
    <logentry revision="2"><date>2026-10-01T06:00:00Z</date><msg>更新</msg></logentry>
    <logentry revision="1"><author>ignored</author><date>invalid</date><msg>损坏记录</msg></logentry>
  </log>`, now);
  assert.equal(records.length, 2);
  assert.equal(records[0].author, "张三&团队");
  assert.equal(records[1].author, null);
});
