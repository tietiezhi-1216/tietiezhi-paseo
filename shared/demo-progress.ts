// A client-side simulation, not a report of real Agent/tool activity.
export const DEMO_TASK_TOTAL_STEPS = 20;
export const DEMO_TASK_INTERVAL_MS = 1_000;
export type DemoTaskStatus = "idle" | "running" | "paused" | "completed";
export type DemoTaskState = Readonly<{ status: DemoTaskStatus; completedSteps: number; runId: number }>;
export type DemoTaskAction = { type: "start" | "pause" | "reset" } | { type: "tick"; runId: number };
export const INITIAL_DEMO_TASK: DemoTaskState = Object.freeze({ status: "idle", completedSteps: 0, runId: 0 });

export function demoTaskReducer(state: DemoTaskState, action: DemoTaskAction): DemoTaskState {
  switch (action.type) {
    case "start":
      if (state.status === "running") return state;
      return { status: "running", completedSteps: state.status === "paused" ? state.completedSteps : 0, runId: state.runId + 1 };
    case "pause":
      return state.status === "running" ? { ...state, status: "paused", runId: state.runId + 1 } : state;
    case "reset":
      return { ...INITIAL_DEMO_TASK, runId: state.runId + 1 };
    case "tick": {
      // Queued ticks from a paused/reset/restarted run must not affect the next run.
      if (state.status !== "running" || action.runId !== state.runId) return state;
      const completedSteps = Math.min(DEMO_TASK_TOTAL_STEPS, state.completedSteps + 1);
      return { ...state, completedSteps, status: completedSteps === DEMO_TASK_TOTAL_STEPS ? "completed" : "running" };
    }
  }
}

const STAGES = ["整理示例说明", "整理示例功能", "模拟类型检查", "模拟测试输出", "汇总示例结果"] as const;
export function getDemoTaskView(state: DemoTaskState) {
  const percent = Math.round(state.completedSteps / DEMO_TASK_TOTAL_STEPS * 100);
  const phase = { idle: "待开始", running: "执行中", paused: "已暂停", completed: "已完成" }[state.status];
  const stage = state.status === "idle" ? "等待开始" : state.status === "completed" ? "模拟任务完成" : STAGES[Math.min(STAGES.length - 1, Math.floor(state.completedSteps / 4))];
  const controlTitle = { idle: "开始模拟", running: "暂停模拟", paused: "继续模拟", completed: "重播模拟" }[state.status];
  return {
    percent, phase, stage, controlTitle,
    controlSymbol: state.status === "running" ? "Ⅱ" : state.status === "completed" ? "↻" : "▶",
    sidebarTitle: state.status === "idle" ? "对话 Log · 进度示例" : `${percent}% · ${phase}（模拟）`,
    modalTitle: `对话 Log · ${phase} · ${percent}%（模拟）`,
    stepLabel: `${stage} · ${state.completedSteps}/${DEMO_TASK_TOTAL_STEPS} 步`,
  };
}
