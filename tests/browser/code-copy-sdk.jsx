export * from "./sdk.jsx";
export function copyText(text) {
  globalThis.__codeClipboard.calls.push(text);
  if (globalThis.__codeClipboard.mode === "fail") return Promise.reject(Error("clipboard denied"));
  if (globalThis.__codeClipboard.mode === "defer") return new Promise(resolve => { globalThis.__codeClipboard.finish = resolve; });
  return Promise.resolve();
}
