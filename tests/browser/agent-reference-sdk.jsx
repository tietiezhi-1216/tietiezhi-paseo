export * from "./agents-sync-sdk.jsx";
export function copyText(value) { globalThis.__agentReferenceClipboard = value; return Promise.resolve(); }
