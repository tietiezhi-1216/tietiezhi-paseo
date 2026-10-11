import { useContext, useState } from "react";
import { Runtime } from "./sdk.jsx";
export * from "./sdk.jsx";
export function useSettings() {
  const runtime = useContext(Runtime);
  const [state, setState] = useState(() => runtime.preferences[runtime.hostId] ?? { tab: "pulls", seenPulls: 0, seenSvn: 0 });
  return { status: "ready", values: state, revision: JSON.stringify(state), saving: false, saveError: null,
    save: async next => { runtime.preferences[runtime.hostId] = next; setState(next); return true; } };
}
