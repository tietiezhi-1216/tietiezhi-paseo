import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Markdown } from "../../client/markdown.tsx";

const original = '\tconst text = "<&>";  \n\n中文清单：\n  - 保留缩进\n  - 只复制块内文字';
const documentOf = source => '块外正文，不应复制。\n\n```text\n' + source + '\n```\n\n```sh\nprintf "second block"\n```';
globalThis.__codeClipboard = { calls: [], mode: "ok" };
function App() {
  const [source, setSource] = useState(original);
  const [shown, setShown] = useState(true);
  const [light, setLight] = useState(false);
  const colors = light
    ? { surface0: "#fff", surface1: "#f5f6f5", surface2: "#e6e8e6", foreground: "#222", foregroundMuted: "#657069", border: "#cbd3ce", statusSuccess: "#297958", statusDanger: "#a63333", accent: "#297958" }
    : { surface0: "#171c19", surface1: "#212722", surface2: "#292f29", foreground: "#efefef", foregroundMuted: "#9aa59c", border: "#394139", statusSuccess: "#56aa88", statusDanger: "#ee7777", accent: "#56aa88" };
  globalThis.__codeCopy = { original, source: setSource, shown: setShown, light: setLight };
  return <main style={{ background: colors.surface0, minHeight: "100vh", padding: 16, boxSizing: "border-box" }}>
    <article style={{ maxWidth: 820, margin: "0 auto" }}>{shown ? <Markdown text={documentOf(source)} theme={{ colors }} /> : null}</article>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
