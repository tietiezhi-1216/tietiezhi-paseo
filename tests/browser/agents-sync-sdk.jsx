import { useContext } from "react";
import { Runtime } from "./sdk.jsx";
export * from "./sdk.jsx";
let environment;
export function setAgentSyncEnvironment(value) { environment = value; }
export function usePaseo() { return useContext(Runtime).paseo; }
export function getPaseoClient(serverId) {
  if (!environment.hosts.some(host => host.serverId === serverId && host.status === "online")) throw new Error("Host disconnected");
  return environment.apis[serverId];
}
