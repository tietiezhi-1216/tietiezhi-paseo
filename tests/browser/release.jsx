import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManagerScreen } from "../../client/manager.tsx";
import { Runtime, setTestRuntime } from "./release-sdk.jsx";
const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
const preferences = {};
const calls=[];
const dark = {surface0:"#121417",surface1:"#1b1f24",surface2:"#24292f",border:"#30363d",foreground:"#f0f6fc",foregroundMuted:"#8b949e",accent:"#2ea043",statusSuccess:"#2ea043",statusWarning:"#d29922",statusDanger:"#f85149"};
const light = {...dark,surface0:"#fff",surface1:"#f6f8fa",surface2:"#eaeef2",border:"#d0d7de",foreground:"#24292f",foregroundMuted:"#57606a"};
const stamp = new Date().toISOString();
const stats={lastPublishedAt:stamp,estimatedDurationMs:120000,sampleCount:8};
const snapshots = Object.fromEntries(["local","remote"].map(host => [host,{fetchedAt:stamp,githubStats:stats,svnStats:stats,releaseSummary:"Linux制品构建",site:{available:true,httpStatus:200,label:"可用"},averageDurationMs:120000,durationSampleCount:8,error:null,warnings:[],pullRequests:[
  {number:547,title:host+"-only 修复部署中的累计发布",titleTag:"fix",author:"example-user",branchName:"fix/release",url:"https://github.com/example/pull/547",state:"running",updatedAt:stamp,mergedAt:stamp,startedAt:new Date(Date.now()-45000).toISOString(),estimatedDurationMs:120000,phase:"building",batchNote:"同批 #547 · 排队 0:10 · 执行计时不含等待",failureReason:null},
  {number:546,title:"文档回执",titleTag:"docs",author:"writer",branchName:"docs/receipt",url:"https://github.com/example/pull/546",state:"no_runtime",updatedAt:stamp,mergedAt:stamp,startedAt:null,estimatedDurationMs:null,failureReason:null},
],partnerRecords:[{id:"svn:r1300",kind:"commit",number:1300,title:"修复中文日志与对接记录",author:"SVN提交人",titleTag:"修复",subtitle:"SVN提交人",url:null,state:"success",updatedAt:stamp,startedAt:null,estimatedDurationMs:null,failureReason:null},
{id:"jenkins:build:9",kind:"deploy",jobName:"install_pg_innertest",number:9,title:"内测全量安装",titleTag:"部署",subtitle:"install_pg_innertest",state:"running",url:null,updatedAt:stamp,startedAt:new Date(Date.now()-45000).toISOString(),estimatedDurationMs:120000,queuedIds:[10,11],failureReason:null}]}]));
function App() {
  const [hostId,setHost]=useState("local"),[isLight,setLight]=useState(false),[online,setOnline]=useState(true),[mounted,setMounted]=useState(true);
  const theme={colors:isLight?light:dark},layout={compact:innerWidth<600,platform:"web"};
  const runtime={hostId,preferences,theme,layout,calls,hosts:[{serverId:hostId,label:hostId,status:online?"online":"offline"}],rpc:async name=>{
    calls.push({name,hostId});
    if(name==="tietiezhi.release.snapshot")return snapshots[hostId];
    if(name==="tietiezhi.release.pulse")return{revision:0,connected:false};
    return{revision:"fixture",accounts:[],warnings:[]};
  }};
  setTestRuntime(runtime);
  globalThis.__release={host:setHost,light:setLight,online:setOnline,mount:setMounted,calls,snapshots,preferences,
    refresh:()=>queryClient.invalidateQueries({queryKey:["tietiezhi-release",hostId]}),
    fail:()=>{snapshots[hostId]={...snapshots[hostId],error:"temporary failure"};return queryClient.invalidateQueries({queryKey:["tietiezhi-release",hostId]})}};
  return <QueryClientProvider client={queryClient}><Runtime.Provider value={runtime}><div style={{height:"100vh",display:"flex",background:theme.colors.surface0}}>{mounted?<ManagerScreen host={{id:hostId,label:hostId}} theme={theme} layout={layout}/>:null}</div></Runtime.Provider></QueryClientProvider>;
}
createRoot(document.getElementById("root")).render(<App/>);
