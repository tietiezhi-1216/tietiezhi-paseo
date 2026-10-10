/** Fixed remote program: reads metadata locally; credentials are never serialized or returned. */
export const PI_ANTIGRAVITY_INVENTORY_SCRIPT = String.raw`
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const home = os.homedir();
function read(p) { try { return { exists: true, value: JSON.parse(fs.readFileSync(p, "utf8")) }; } catch (e) { return { exists: false, problem: e.code === "ENOENT" ? "missing" : "unreadable", value: {} }; } }
const paseoHome = process.env.PASEO_HOME || path.join(home, ".paseo");
const config = read(path.join(paseoHome, "config.json")).value;
const configured = config?.agents?.providers?.pi?.env?.PI_CODING_AGENT_DIR;
let dir = process.env.TIETIEZHI_PI_AGENT_DIR || configured || process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
if (dir.startsWith("~/")) dir = path.join(home, dir.slice(2));
if (!path.isAbsolute(dir)) throw Error("Pi directory not absolute");
const settings = read(path.join(dir, "settings.json"));
const sources = (Array.isArray(settings.value.packages) ? settings.value.packages : []).map(x => typeof x === "string" ? x : x?.source).filter(x => typeof x === "string" && /^npm:pi-antigravity(?:@|$)/.test(x));
const manifest = read(path.join(dir, "npm", "node_modules", "pi-antigravity", "package.json"));
let extensions = [];
try { extensions = fs.readdirSync(path.join(dir, "extensions")).filter(x => /antigravity/i.test(x)); } catch {}
const auth = read(path.join(dir, "auth.json"));
const accounts = new Map();
const active = new Set();
function add(slot, credential, live) {
  if (!/^(antigravity|google-antigravity)(?:$|-account-)/.test(slot) || !credential || typeof credential !== "object") return;
  if (typeof credential.access !== "string" && typeof credential.refresh !== "string" && typeof credential.key !== "string") return;
  const email = [credential.email, credential.account].find(x => typeof x === "string" && /^[^\s@]+@[^\s@]+$/.test(x));
  const identity = email?.toLowerCase() || crypto.createHash("sha256").update(String(credential.refresh || credential.key || credential.access)).digest("hex");
  const isActive = live && ["antigravity", "google-antigravity"].includes(slot);
  if (isActive) active.add(identity);
  const old = accounts.get(identity);
  if (!old || live) accounts.set(identity, {
    email: email ? email.replace(/^(.{0,3})[^@]*@/, "$1***@").slice(0, 120) : null,
    authType: credential.type === "oauth" ? "oauth" : credential.type === "api_key" ? "api_key" : "unknown",
    complete: credential.type === "oauth" ? !!(credential.access && credential.refresh && Number.isFinite(credential.expires)) : credential.type === "api_key" && !!credential.key
  });
}
for (const [file, canonical] of [[path.join(paseoHome,"model-quota.json"),false],[path.join(paseoHome,"ttz.json"),false],[path.join(paseoHome,"tietiezhi","accounts.json"),true]]) {
  const doc = read(file).value;
  for (const a of Array.isArray(doc.accounts) ? doc.accounts : []) add(a.slot || a.id || "", canonical ? a.credential : a.cred, false);
}
for (const [slot, credential] of Object.entries(auth.value)) add(slot, credential, true);
console.log(JSON.stringify({
  device: os.hostname(), piDirectory: dir, settingsReadable: settings.exists,
  plugin: { configured: sources.length > 0, installed: manifest.exists && manifest.value.name === "pi-antigravity", version: manifest.value.version || null, localExtensions: extensions },
  authReadable: auth.exists, accountCount: accounts.size,
  accounts: [...accounts.entries()].slice(0,20).map(([id,a]) => ({...a,active:active.has(id)})),
  truncated: accounts.size > 20
}));
`;
