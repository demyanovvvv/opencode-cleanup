/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { CleanupApp } from "./tui/app.js"

const tui: TuiPlugin = async (api) => {
  const open = (page: "dashboard" | "sessions" | "analyze" | "cleanup" | "maintenance" = "dashboard") => {
    api.ui.dialog.setSize("xlarge")
    api.ui.dialog.replace(() => <CleanupApp api={api} initialPage={page} />)
  }
  api.keymap.registerLayer({
    mode: "base",
    commands: [
      { name: "opencode-cleanup.dashboard", title: "Cleanup: Dashboard", category: "Cleanup", namespace: "palette", slashName: "cleanup", description: "Open the OpenCode storage and memory dashboard.", run: open },
      { name: "opencode-cleanup.sessions", title: "Cleanup: Sessions", category: "Cleanup", namespace: "palette", description: "Inspect OpenCode sessions and their logical storage.", run: () => open("sessions") },
      { name: "opencode-cleanup.analyze", title: "Cleanup: Analyze storage", category: "Cleanup", namespace: "palette", description: "Analyze SQLite, event history and managed files.", run: () => open("analyze") },
      { name: "opencode-cleanup.selective", title: "Cleanup: Selective cleanup", category: "Cleanup", namespace: "palette", description: "Preview protected, selective cleanup.", run: () => open("cleanup") },
      { name: "opencode-cleanup.maintenance", title: "Cleanup: Database maintenance", category: "Cleanup", namespace: "palette", description: "Queue verified backup, archive and VACUUM after exit.", run: () => open("maintenance") },
    ],
    bindings: [{ key: "ctrl+shift+o", cmd: "opencode-cleanup.dashboard", desc: "Open Cleanup dashboard" }],
  })
}

const plugin: TuiPluginModule & { id: string } = { id: "opencode-cleanup", tui }
export default plugin
