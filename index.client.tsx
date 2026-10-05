import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DashboardSurface } from "./client/dashboard";

export default function contribute(client: PluginClientContext) {
  const stopSurface = client.addSurface("dashboard", DashboardSurface);
  const stopSidebar = client.addSidebarItem({
    id: "dashboard",
    title: "tietiezhi",
    icon: "PanelsTopLeft",
    surface: "dashboard",
  });
  return () => {
    stopSidebar();
    stopSurface();
  };
}
