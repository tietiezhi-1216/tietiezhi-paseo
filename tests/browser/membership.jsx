import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AccountQuotaDetails } from "../../client/quota-panel.tsx";

const start = Date.now();
const hour = 3_600_000, day = 24 * hour;
const pending = new Set();
const setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis);
globalThis.setTimeout = (callback, delay, ...args) => {
  let timer;
  timer = setTimer(() => { pending.delete(timer); callback(...args); }, delay);
  if (delay > 0 && delay <= 30_000) pending.add(timer);
  return timer;
};
globalThis.clearTimeout = timer => { pending.delete(timer); clearTimer(timer); };
const dark = { surface0: "#202024", surface1: "#29292e", border: "#3c3c42", foreground: "#eeeeef", foregroundMuted: "#a4a4ac", accent: "#68a784", statusWarning: "#c59b59", statusSuccess: "#68a784", statusDanger: "#df6666" };
const light = { ...dark, surface0: "#fff", surface1: "#f5f5f7", border: "#d0d0d5", foreground: "#222228", foregroundMuted: "#63636c" };
const account = (id, at, family = "codex") => ({ id, label: id, family, slot: family, active: true, canSwitch: true, authType: "oauth", expiresAt: start - 1, subscriptionExpiresAt: at, plan: "Pro", problem: null });
const quota = (id, family) => ({ accountId: id, plan: "Pro", fetchedAt: start, checkedAt: start, stale: false, error: null,
  windows: family === "antigravity" ? [
    { id: "gemini-week", pool: "gemini", label: "本周", usedPercent: 51, resetAt: start + 7 * day },
    { id: "claude-week", pool: "claude", label: "本周", usedPercent: 68, resetAt: start + 7 * day },
  ] : [{ id: "week", pool: "shared", label: "本周", usedPercent: 68, resetAt: start + 7 * day }],
});
function App() {
  const [active, setActive] = useState(true);
  const [isLight, setLight] = useState(false);
  const [renewed, setRenewed] = useState(null);
  globalThis.__membership = { timers: () => pending.size, stop: () => setActive(false), light: setLight, renew: () => setRenewed(Date.now() + 2 * hour) };
  const colors = isLight ? light : dark;
  const fixtures = [
    account("hours", renewed ?? start + 3 * hour + 20 * 60_000 + 5_000),
    account("days", start + 13 * day + 4 * hour),
    account("soon", start + 40_000),
    account("past", start - day),
    account("missing", null),
    account("ag", start + 3 * hour + 20 * 60_000 + 5_000, "antigravity"),
  ];
  return <main style={{ background: colors.surface0, color: colors.foreground, minHeight: "100vh", padding: 16, boxSizing: "border-box", width: "calc(100% - 32px)", maxWidth: 440 }}>
    {active ? fixtures.map(item => <section data-testid={"membership-card-" + item.id} key={item.id} style={{ background: colors.surface1, border: "1px solid " + colors.border, borderRadius: 8, marginBottom: 8, padding: 10 }}>
      <header style={{ fontSize: 12, marginBottom: 8 }}>{item.id} · PRO</header>
      <AccountQuotaDetails theme={{ colors }} account={item} quota={quota(item.id, item.family)} pending={false} />
    </section>) : null}
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
