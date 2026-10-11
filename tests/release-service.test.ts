import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type WebSocket from "ws";
import { createReleaseRelay, releaseWakeEvent } from "../server/release-relay.ts";
import { systemProxyEnvironment } from "../server/release-http.ts";
import { preservePartnerHistory } from "../server/release-partner.ts";
import type { PartnerRecord } from "../shared/release.ts";

test("relay wakes only supported events and ignores noisy jobs/checks", () => {
  assert.equal(releaseWakeEvent({type:"state"}), true);
  assert.equal(releaseWakeEvent({type:"github_event",event:{kind:"pull_request"}}), true);
  for (const kind of ["workflow_job","check_run"]) assert.equal(releaseWakeEvent({type:"github_event",event:{kind}}), false);
  assert.equal(releaseWakeEvent({type:"unrelated"}), false);
  assert.equal(releaseWakeEvent(null), false);
});
test("relay is single-instance, heartbeat bounded, and late configuration cannot reconnect after disposal", async context => {
  context.mock.timers.enable({apis:["setTimeout","setInterval"]});
  class Socket extends EventEmitter {
    readyState = 1; pings = 0; terminated = 0;
    ping() { this.pings++; } terminate() { this.terminated++; }
  }
  const sockets: Socket[] = []; let wakes = 0;
  const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
  const relay = createReleaseRelay(() => wakes++, {
    loadUrl: async () => "wss://example.invalid", environment: async () => ({}),
    open: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  relay.start(); relay.start(); await flush();
  assert.equal(sockets.length,1); sockets[0]!.emit("open");
  assert.equal(relay.connected(),true); assert.equal(wakes,1);
  sockets[0]!.emit("message",Buffer.from('{"type":"github_event","event":{"kind":"workflow_job"}}'));
  assert.equal(wakes,1);
  context.mock.timers.tick(25_000); assert.equal(sockets[0]!.pings,1);
  context.mock.timers.tick(25_000); assert.equal(sockets[0]!.terminated,1);
  context.mock.timers.tick(30_000); await flush(); assert.equal(sockets.length,2);
  relay.stop(); context.mock.timers.tick(120_000); await flush(); assert.equal(sockets.length,2);
  let resolve!: (value:string)=>void;
  const late = createReleaseRelay(() => {}, {loadUrl: () => new Promise(done => { resolve=done; }), environment:async()=>({}),
    open:()=>{throw Error("must not connect");}});
  late.start(); late.stop(); resolve("wss://example.invalid"); await flush();
});
test("partial SVN/Jenkins failures retain only the affected source and never duplicate identities", () => {
  const now=Date.now();
  const commit: PartnerRecord={id:"svn:r1",kind:"commit",number:1,title:"saved",titleTag:null,subtitle:"author",url:null,state:"success",
    updatedAt:new Date(now-1000).toISOString(),startedAt:null,estimatedDurationMs:null,failureReason:null};
  const deploy: PartnerRecord={...commit,id:"jenkins:1",kind:"deploy",state:"running"};
  const stats={sampleCount:0,lastPublishedAt:null,estimatedDurationMs:null};
  assert.deepEqual(preservePartnerHistory({records:[],stats,warnings:["暂时无法读取对接方 SVN 提交"]},[commit,deploy],now),[commit]);
  assert.deepEqual(preservePartnerHistory({records:[],stats,warnings:["暂时无法读取对接方 Jenkins 部署"]},[commit,deploy],now),[deploy]);
  assert.deepEqual(preservePartnerHistory({records:[],stats,warnings:["Jenkins 队列暂时不可读"]},[deploy],now),[], "queue failure must not resurrect a build whose current job query confirms it finished");
  assert.equal(preservePartnerHistory({records:[commit],stats,warnings:["SVN 暂时不可用"]},[commit],now).length,1);
  assert.equal(preservePartnerHistory({records:[],stats,warnings:["SVN 暂时不可用"]},[{...commit,updatedAt:new Date(now-86400001).toISOString()}],now).length,0);
});
test("system proxy is inherited without overriding configured proxies or serializing credentials", () => {
  const text = " HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7890\n HTTPEnable : 1\n HTTPProxy : 127.0.0.1\n HTTPPort : 7890\n";
  assert.equal(systemProxyEnvironment(text,{}).HTTPS_PROXY,"http://127.0.0.1:7890");
  assert.equal(systemProxyEnvironment(text,{HTTPS_PROXY:"http://configured:80"}).HTTPS_PROXY,"http://configured:80");
  assert.equal(systemProxyEnvironment(text.replace("7890","99999"),{}).HTTPS_PROXY,undefined);
});
test("release failure preserves cached history, redacts process errors, coalesces and throttles requests", async () => {
  const root = await mkdtemp(join(tmpdir(),"tietiezhi-release-test-"));
  try {
    const cacheDir=join(root,".paseo","tietiezhi"); await mkdir(cacheDir,{recursive:true});
    const snapshot={fetchedAt:"2020-01-01T00:00:00Z",githubStats:{lastPublishedAt:null,estimatedDurationMs:null,sampleCount:0},
      svnStats:{lastPublishedAt:null,estimatedDurationMs:null,sampleCount:0},releaseSummary:null,site:null,averageDurationMs:null,durationSampleCount:0,
      pullRequests:[{number:42,title:"cached original",titleTag:null,branchName:"saved",url:"https://github.com/example/pr/42",state:"success",
        updatedAt:"2020-01-01T00:00:00Z",mergedAt:null,startedAt:null,estimatedDurationMs:null,failureReason:null}],partnerRecords:[],warnings:[],error:null};
    await writeFile(join(cacheDir,"release-snapshot.json"),JSON.stringify(snapshot));
    const bin=join(root,"bin");await mkdir(bin);
    await writeFile(join(bin,"gh"),"#!/bin/sh\necho SECRET_DO_NOT_LEAK >&2\nexit 1\n",{mode:0o755});
    const script=`const m=await import(${JSON.stringify(new URL("../server/release.ts",import.meta.url).href)});try{
      const [a,b]=await Promise.all([m.handleReleaseSnapshot({refresh:true}),m.handleReleaseSnapshot({refresh:true})]);
      const c=await m.handleReleaseSnapshot({refresh:true});
      if(a!==b||a!==c)throw Error("not coalesced/throttled");
      console.log(JSON.stringify(a));
    }finally{await m.disposeReleaseSnapshot()}`;
    const {stdout,stderr}=await promisify(execFile)(process.execPath,["--experimental-strip-types","--input-type=module","-e",script],{
      timeout:10_000,env:{...process.env,HOME:root,SLOTGAME_ROOT:root,PATH:bin+":"+process.env.PATH,
        HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",http_proxy:"http://127.0.0.1:9",https_proxy:"http://127.0.0.1:9",NO_PROXY:"",no_proxy:""}});
    const result=JSON.parse(stdout);
    assert.equal(result.pullRequests[0].number,42);assert.equal(result.fetchedAt,snapshot.fetchedAt);
    assert.equal(result.error,"发布记录读取失败，等待自动同步");
    assert.doesNotMatch(stdout+stderr,/SECRET_DO_NOT_LEAK/);
    assert.equal(await readFile(join(cacheDir,"release-snapshot.json"),"utf8"),JSON.stringify(snapshot));
  } finally {await rm(root,{recursive:true,force:true});}
});
