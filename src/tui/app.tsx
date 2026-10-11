/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { analyzeDatabase, type DatabaseAnalysis } from "../analysis/database.js"
import { formatBytes, formatDuration, percent } from "../analysis/format.js"
import { openCodeProcesses } from "../platform/processes.js"
import { defaultJobPaths, queueMaintenance } from "../maintenance/queue.js"
import { buildCleanupPlan } from "../cleanup/plan.js"

type Page = "dashboard" | "sessions" | "analyze" | "cleanup" | "maintenance"

function databasePath(api: TuiPluginApi): string {
  const configured = process.env.OPENCODE_DB
  const dataRoot = process.env.XDG_DATA_HOME ?? (process.platform === "win32" ? join(homedir(), ".local", "share") : join(homedir(), ".local", "share"))
  if (configured && configured !== ":memory:") return isAbsolute(configured) ? configured : join(dataRoot, configured)
  const hostData = api.state.path.state.replace(/[\\/]state(?:[\\/].*)?$/, "")
  return hostData.endsWith("opencode") ? join(hostData, "opencode.db") : join(dataRoot, "opencode", "opencode.db")
}

function Header(props: { title: string; back: () => void }) {
  return <box flexDirection="row" justifyContent="space-between" height={2}>
    <text>{`OpenCode Cleanup  ›  ${props.title}`}</text>
    <text onMouseDown={props.back}>[Back]</text>
  </box>
}

function Metric(props: { label: string; value: string; detail?: string }) {
  return <box flexDirection="column" width={28} height={4} border={true} paddingLeft={1} paddingRight={1}>
    <text>{props.label}</text>
    <text>{props.value}</text>
    <text>{props.detail ?? ""}</text>
  </box>
}

function Dashboard(props: { api: TuiPluginApi; go: (page: Page) => void; back: () => void }) {
  const [analysis, setAnalysis] = createSignal<DatabaseAnalysis>()
  const [memory, setMemory] = createSignal<{ rssBytes: number; privateBytes?: number }[]>([])
  const [error, setError] = createSignal<string>()
  const refresh = async () => {
    try {
      setError()
      const [next, processes] = await Promise.all([analyzeDatabase(databasePath(props.api)), openCodeProcesses()])
      setAnalysis(next)
      setMemory(processes)
    } catch (cause) { setError(String(cause)) }
  }
  void refresh()
  return <box flexDirection="column" padding={1}>
    <Header title="Dashboard" back={props.back} />
    <Show when={error()}><text>{`Error: ${error()}`}</text></Show>
    <Show when={analysis()} fallback={<text>Reading OpenCode storage…</text>}>
      {(value) => <>
        <box flexDirection="row">
          <Metric label="Database" value={formatBytes(value().identity.fileSize + value().identity.walSize)} detail={value().identity.canonicalPath} />
          <Metric label="Sessions" value={String(value().sessions.length)} detail={`${value().tables.message ?? 0} messages / ${value().tables.part ?? 0} parts`} />
          <Metric label="Event history" value={value().eventCount.toLocaleString()} detail={`${value().detachedEventAggregates.toLocaleString()} detached groups`} />
          <Metric label="SQLite free pages" value={formatBytes(value().freeBytes)} detail={`${percent(value().freePages, value().pageCount)}% of database pages`} />
        </box>
        <box flexDirection="row">
          <Metric label="Snapshots" value={formatBytes(value().filesystem.snapshotBytes)} detail={`${value().filesystem.snapshotCount} files`} />
          <Metric label="Session diffs" value={formatBytes(value().filesystem.sessionDiffBytes)} detail={`${value().filesystem.sessionDiffCount} files`} />
          <Metric label="Tool output" value={formatBytes(value().filesystem.toolOutputBytes)} />
          <Metric label="OpenCode RAM" value={formatBytes(memory().reduce((sum, item) => sum + item.rssBytes, 0))} detail={`${memory().length} process(es)`} />
        </box>
        <text>{`DB identity: ${value().identity.canonicalPath}  schema ${value().identity.schemaSignature.slice(0, 12)}`}</text>
        <text>{`Last scan: ${new Date().toLocaleTimeString()}   [Refresh]`}</text>
        <box flexDirection="row">
          <text onMouseDown={() => void refresh()}>Refresh</text><text>  </text>
          <text onMouseDown={() => props.go("sessions")}>Sessions</text><text>  </text>
          <text onMouseDown={() => props.go("analyze")}>Analyze storage</text><text>  </text>
          <text onMouseDown={() => props.go("cleanup")}>Selective cleanup</text><text>  </text>
          <text onMouseDown={() => props.go("maintenance")}>Maintenance</text>
        </box>
      </>}
    </Show>
  </box>
}

function Sessions(props: { api: TuiPluginApi; back: () => void }) {
  const [sessions, setSessions] = createSignal<DatabaseAnalysis["sessions"]>([])
  const [error, setError] = createSignal<string>()
  void analyzeDatabase(databasePath(props.api), { deep: true }).then((value) => setSessions(value.sessions)).catch((cause) => setError(String(cause)))
  return <box flexDirection="column" padding={1}>
    <Header title="Sessions" back={props.back} />
    <text>ID                         Updated       Parts   Logical bytes   Title</text>
    <Show when={!error()} fallback={<text>{error()}</text>}>
      <scrollbox flexGrow={1} minHeight={0}>
        <For each={sessions()}>{(session) => <text>{`${session.id.padEnd(27)} ${formatDuration(Date.now() - session.updatedAt).padStart(8)} ago  ${String(session.partCount).padStart(5)}  ${formatBytes(session.logicalBytes).padStart(12)}   ${session.title}`}</text>}</For>
      </scrollbox>
    </Show>
    <text>Protected/current/busy/latest sessions are excluded from destructive plans.</text>
  </box>
}

function Cleanup(props: { api: TuiPluginApi; back: () => void }) {
  const [protectedIds, setProtectedIds] = createSignal<string[]>([])
  const [message, setMessage] = createSignal("Loading sessions…")
  const choose = async () => {
    try {
      const analysis = await analyzeDatabase(databasePath(props.api), { deep: true })
      props.api.ui.dialog.replace(() => props.api.ui.DialogSelect({
        title: "Protected sessions",
        placeholder: "Search sessions",
        options: analysis.sessions.map((session) => ({ title: session.title || session.id, value: session.id, description: `${session.id} · ${formatBytes(session.logicalBytes)}` })),
        onSelect: (option) => {
          if (!option.value) return
          setProtectedIds((ids) => ids.includes(String(option.value)) ? ids : [...ids, String(option.value)])
          props.api.ui.toast({ variant: "success", message: `Protected ${String(option.value)}` })
          props.api.ui.dialog.replace(() => <Cleanup api={props.api} back={props.back} />)
        },
      }))
    } catch (cause) { setMessage(String(cause)) }
  }
  return <box flexDirection="column" padding={1}>
    <Header title="Selective cleanup" back={props.back} />
    <text>Choose protected sessions first. Current, busy and latest sessions are always protected.</text>
    <text>{`Protected in this preview: ${protectedIds().length}`}</text>
    <text onMouseDown={() => void choose()}>[Choose protected session]</text>
    <text onMouseDown={() => setMessage("Plan preview requires explicit cleanup filters and will never expand the approved selection.")}>[Preview cleanup plan]</text>
    <text>{message()}</text>
  </box>
}

function Analyze(props: { api: TuiPluginApi; back: () => void }) {
  const [analysis, setAnalysis] = createSignal<DatabaseAnalysis>()
  void analyzeDatabase(databasePath(props.api), { deep: true }).then(setAnalysis)
  return <box flexDirection="column" padding={1}>
    <Header title="Analyze storage" back={props.back} />
    <Show when={analysis()} fallback={<text>Running bounded deep analysis…</text>}>
      {(value) => <>
        <text>Storage by part type</text>
        <For each={value().partStats}>{(item) => <text>{`${item.type.padEnd(18)} ${String(item.count).padStart(8)} parts  ${formatBytes(item.logicalBytes).padStart(12)}  ${item.percent.toFixed(2)}%`}</text>}</For>
        <text>{`Detached event aggregates: ${value().detachedEventAggregates.toLocaleString()}`}</text>
        <text>Detached history is source data and is never deleted automatically.</text>
      </>}
    </Show>
  </box>
}

function Maintenance(props: { api: TuiPluginApi; back: () => void }) {
  const [queued, setQueued] = createSignal(false)
  const [message, setMessage] = createSignal("No maintenance job queued")
  const queue = async () => {
    try {
      const path = databasePath(props.api)
      const analysis = await analyzeDatabase(path, { deep: true })
      const plan = buildCleanupPlan(analysis.sessions.map((session) => ({ kind: "session", id: session.id, parentId: session.parentId, title: session.title, updatedAt: session.updatedAt, logicalBytes: session.logicalBytes, physicalBytes: session.logicalBytes })), { selectedIds: new Set(), protectedIds: new Set(analysis.sessions.map((session) => session.id)), currentSessionId: undefined, busySessionIds: new Set(), latestRootIds: new Set(), fingerprint: analysis.identity.databaseFingerprint })
      const paths = defaultJobPaths(analysis.identity.canonicalPath)
      await queueMaintenance(paths.jobPath, { id: crypto.randomUUID(), databasePath: analysis.identity.canonicalPath, databaseCanonicalPath: analysis.identity.canonicalPath, schemaSignature: analysis.identity.schemaSignature, plan, operations: { archiveDetached: true, deleteSessions: false, vacuum: true }, managedRoot: paths.managedRoot, backupPath: paths.backupPath, archivePath: paths.archivePath, expectedDatabaseFingerprint: analysis.identity.databaseFingerprint, createdAt: new Date().toISOString(), state: "queued" })
      setQueued(true)
      setMessage(`Queued after validation. The worker waits for OpenCode to close. Job: ${paths.jobPath}`)
      props.api.ui.toast({ variant: "success", message: "Verified maintenance job queued for after OpenCode exits." })
    } catch (cause) { setMessage(String(cause)); props.api.ui.toast({ variant: "error", message: String(cause) }) }
  }
  return <box flexDirection="column" padding={1}>
    <Header title="Database maintenance" back={props.back} />
    <text>Maintenance runs only after OpenCode exits.</text>
    <text>It creates a checked SQLite backup, archives detached history, revalidates the plan, then can VACUUM.</text>
    <text>{message()}</text>
    <text onMouseDown={() => void queue()}>{queued() ? "[Queued]" : "[Queue verified maintenance]"}</text>
  </box>
}

export function CleanupApp(props: { api: TuiPluginApi; initialPage?: Page }) {
  const [page, setPage] = createSignal<Page>(props.initialPage ?? "dashboard")
  const back = () => page() === "dashboard" ? props.api.ui.dialog.clear() : setPage("dashboard")
  return <Switch fallback={<Dashboard api={props.api} go={setPage} back={back} />}>
    <Match when={page() === "sessions"}><Sessions api={props.api} back={back} /></Match>
    <Match when={page() === "analyze"}><Analyze api={props.api} back={back} /></Match>
    <Match when={page() === "cleanup"}><Cleanup api={props.api} back={back} /></Match>
    <Match when={page() === "maintenance"}><Maintenance api={props.api} back={back} /></Match>
    <Match when={page() === "dashboard"}><Dashboard api={props.api} go={setPage} back={back} /></Match>
  </Switch>
}
