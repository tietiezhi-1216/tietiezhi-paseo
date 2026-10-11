import assert from "node:assert/strict";
import test from "node:test";
import { releaseExecution, selectBatchAnchor, stageTiming } from "../shared/release.ts";

const validation = "Validate Gateway regression using compiled classes";
const startedAt = "2026-10-10T09:34:16Z";

test("workflow in_progress with no runner is still queued, not executing", () => {
  assert.deepEqual(releaseExecution([{name:"deploy",status:"in_progress",runner_name:"",
    started_at:"2026-10-10T09:15:47Z"}]), {status:"queued",startedAt:null,profile:null});
  assert.equal(releaseExecution([{name:"deploy",status:"pending"}]).status,"queued");
  assert.equal(releaseExecution([]).status,"unknown");
  assert.equal(releaseExecution([{name:"deploy",status:"in_progress",started_at:startedAt}]).startedAt,null);
});

test("execution clock starts at actual runner assignment and profiles never mix Gateway with light releases", () => {
  const deploy={name:"deploy",status:"in_progress",runner_name:"linux-ci",started_at:startedAt};
  const gateway=releaseExecution([{...deploy,steps:[{name:validation,status:"in_progress"}]}]);
  assert.deepEqual(gateway,{status:"running",startedAt,profile:"gateway"});
  assert.equal(releaseExecution([{...deploy,steps:[{name:validation,status:"completed",conclusion:"skipped"}]}]).profile,"light");
  assert.equal(releaseExecution([{...deploy,steps:[{name:validation,status:"pending"}]}]).profile,null);
  // A sample from the old mixed timing contract is not silently classified as a current sample.
  assert.equal(releaseExecution([{...deploy,steps:[{name:"Validate Gateway with isolated PostgreSQL and Redis",conclusion:"success"}]}]).profile,null);
  const now=Date.parse("2026-10-10T09:35:16Z");
  assert.equal(stageTiming({state:"running",startedAt:gateway.startedAt,estimatedDurationMs:120000},now).time,"总剩余 1:00");
});

test("runtime PR owns the batch title instead of a later documentation receipt", () => {
  assert.equal(selectBatchAnchor([{number:1601,nonRuntime:false},{number:1603,nonRuntime:true}]),1601);
  assert.equal(selectBatchAnchor([{number:1601,nonRuntime:false},{number:1603,nonRuntime:null}]),1601);
  assert.equal(selectBatchAnchor([{number:1601,nonRuntime:null},{number:1603,nonRuntime:true}]),1601);
  assert.equal(selectBatchAnchor([{number:1601,nonRuntime:true},{number:1603,nonRuntime:true}]),1603);
  assert.equal(selectBatchAnchor([]),null);
});
