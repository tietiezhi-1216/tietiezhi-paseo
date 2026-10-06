import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_TASK_TOTAL_STEPS, INITIAL_DEMO_TASK, demoTaskReducer, getDemoTaskView } from "../shared/demo-progress.ts";

test("模拟进度每步递增，侧边栏和 Dialog 标题同步，完成后停止", () => {
  assert.equal(getDemoTaskView(INITIAL_DEMO_TASK).percent, 0);
  assert.match(getDemoTaskView(INITIAL_DEMO_TASK).sidebarTitle, /进度示例/);
  let task = demoTaskReducer(INITIAL_DEMO_TASK, { type: "start" });
  assert.equal(demoTaskReducer(task, { type: "start" }), task);
  for (let step = 1; step <= DEMO_TASK_TOTAL_STEPS; step++) {
    task = demoTaskReducer(task, { type: "tick", runId: task.runId });
    const view = getDemoTaskView(task);
    assert.equal(view.percent, step * 5);
    assert.match(view.sidebarTitle, new RegExp(`${view.percent}%`));
    assert.match(view.modalTitle, new RegExp(`${view.percent}%`));
    assert.match(view.sidebarTitle, /模拟/);
    assert.match(view.modalTitle, /模拟/);
  }
  assert.equal(task.status, "completed");
  assert.equal(getDemoTaskView(task).controlTitle, "重播模拟");
  assert.equal(demoTaskReducer(task, { type: "tick", runId: task.runId }), task);
  const replay = demoTaskReducer(task, { type: "start" });
  assert.equal(replay.status, "running");
  assert.equal(replay.completedSteps, 0);
  assert.ok(replay.runId > task.runId);
});

test("暂停不增加进度，恢复从原步骤继续且拒绝旧定时器回调", () => {
  let task = demoTaskReducer(INITIAL_DEMO_TASK, { type: "start" });
  const oldRunId = task.runId;
  for (let i = 0; i < 5; i++) task = demoTaskReducer(task, { type: "tick", runId: oldRunId });
  task = demoTaskReducer(task, { type: "pause" });
  assert.equal(getDemoTaskView(task).percent, 25);
  assert.match(getDemoTaskView(task).modalTitle, /已暂停/);
  assert.equal(demoTaskReducer(task, { type: "tick", runId: oldRunId }), task);
  task = demoTaskReducer(task, { type: "start" });
  assert.equal(task.completedSteps, 5);
  assert.equal(demoTaskReducer(task, { type: "tick", runId: oldRunId }), task);
  task = demoTaskReducer(task, { type: "tick", runId: task.runId });
  assert.equal(getDemoTaskView(task).percent, 30);
});

test("重置/重新开始不接受之前的 tick，空闲时不会自行更新", () => {
  assert.equal(demoTaskReducer(INITIAL_DEMO_TASK, { type: "tick", runId: 0 }), INITIAL_DEMO_TASK);
  const first = demoTaskReducer(INITIAL_DEMO_TASK, { type: "start" });
  const reset = demoTaskReducer(first, { type: "reset" });
  assert.equal(reset.status, "idle");
  assert.equal(reset.completedSteps, 0);
  const restarted = demoTaskReducer(reset, { type: "start" });
  assert.equal(demoTaskReducer(restarted, { type: "tick", runId: first.runId }), restarted);
  assert.equal(INITIAL_DEMO_TASK.status, "idle");
  assert.equal(INITIAL_DEMO_TASK.completedSteps, 0);
});
