import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Database, FolderSync, Library, Play, RadioTower, RotateCw, Save, Settings as SettingsIcon, Square, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api } from "./api/client";
import type { ActivityEvent, Collection, CollectionPlayout, LibraryFile, PlayoutInstance, Settings } from "./types";
import "./styles/app.css";

type Page = "dashboard" | "library" | "collections" | "activity" | "settings";

const emptyCollection = (): Collection => ({ name: "new-collection", description: "", updatedAt: new Date().toISOString(), playouts: [] });
const newEntry = (file?: LibraryFile): CollectionPlayout => ({
  id: crypto.randomUUID(),
  label: file?.filename ?? "New playout",
  fileId: file?.id,
  filePath: file ? undefined : "",
  target: "udp://239.10.10.1:5000",
  loop: true,
  autoRestart: false,
  enabled: true
});

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function uptime(startedAt?: string): string {
  if (!startedAt) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<Collection>(emptyCollection());
  const [playouts, setPlayouts] = useState<PlayoutInstance[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const [health, nextSettings, nextFiles, nextCollections, nextPlayouts, nextActivity] = await Promise.all([
      api.health(),
      api.settings(),
      api.files(),
      api.collections(),
      api.playouts(),
      api.activity()
    ]);
    setWarnings(health.warnings);
    setSettings(nextSettings);
    setFiles(nextFiles);
    setCollections(nextCollections);
    setPlayouts(nextPlayouts);
    setActivity(nextActivity);
    if (nextCollections.length && activeCollection.playouts.length === 0) setActiveCollection(nextCollections[0]);
  };

  useEffect(() => {
    void refresh().catch((err) => setError(err.message));
    const events = new EventSource("/api/events");
    events.onmessage = () => void refresh();
    ["playout.started", "playout.exited", "playout.failed", "playout.log", "library.scan.completed", "collection.saved", "collection.deleted", "settings.updated"].forEach((name) => {
      events.addEventListener(name, () => void refresh());
    });
    const timer = window.setInterval(() => void api.playouts().then(setPlayouts), 1500);
    return () => {
      events.close();
      window.clearInterval(timer);
    };
  }, []);

  const filteredFiles = useMemo(() => {
    const q = query.toLowerCase();
    return files.filter((file) => `${file.filename} ${file.path}`.toLowerCase().includes(q));
  }, [files, query]);

  const saveCollection = async () => {
    const saved = await api.saveCollection(activeCollection);
    setActiveCollection(saved);
    await refresh();
  };

  const updateEntry = (id: string, patch: Partial<CollectionPlayout>) => {
    setActiveCollection((collection) => ({
      ...collection,
      playouts: collection.playouts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    }));
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><RadioTower size={22} /> <span>PlayTime</span></div>
        <nav>
          <button className={clsx({ active: page === "dashboard" })} onClick={() => setPage("dashboard")}><Play size={16} />Dashboard</button>
          <button className={clsx({ active: page === "library" })} onClick={() => setPage("library")}><Library size={16} />Library</button>
          <button className={clsx({ active: page === "collections" })} onClick={() => setPage("collections")}><Database size={16} />Collections</button>
          <button className={clsx({ active: page === "activity" })} onClick={() => setPage("activity")}><Activity size={16} />Activity</button>
          <button className={clsx({ active: page === "settings" })} onClick={() => setPage("settings")}><SettingsIcon size={16} />Settings</button>
        </nav>
        <div className="status-block">
          <span className="metric">{playouts.filter((p) => p.state === "running").length}</span>
          <span>running playouts</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{page[0].toUpperCase() + page.slice(1)}</h1>
            <p>{files.length} library files · {collections.length} collections · API 127.0.0.1:4500</p>
          </div>
          <button className="primary" onClick={() => void refresh()}><RotateCw size={16} />Refresh</button>
        </header>
        {error && <div className="alert danger">{error}</div>}
        {warnings.map((warning) => <div className="alert" key={warning}>{warning}</div>)}
        {page === "dashboard" && <Dashboard playouts={playouts} onStop={(id) => api.stopPlayout(id).then(refresh)} onRestart={(id) => api.restartPlayout(id).then(refresh)} />}
        {page === "library" && <LibraryPage files={filteredFiles} query={query} setQuery={setQuery} rescan={() => api.rescan().then(setFiles)} addFile={(file) => { setActiveCollection((c) => ({ ...c, playouts: [...c.playouts, newEntry(file)] })); setPage("collections"); }} />}
        {page === "collections" && <CollectionsPage collections={collections} active={activeCollection} setActive={setActiveCollection} files={files} save={saveCollection} updateEntry={updateEntry} refresh={refresh} />}
        {page === "activity" && <ActivityPage activity={activity} />}
        {page === "settings" && settings && <SettingsPage settings={settings} setSettings={setSettings} save={(value) => api.saveSettings(value).then((saved) => { setSettings(saved); return refresh(); })} />}
      </main>
    </div>
  );
}

function Dashboard({ playouts, onStop, onRestart }: { playouts: PlayoutInstance[]; onStop: (id: string) => Promise<unknown>; onRestart: (id: string) => Promise<unknown> }) {
  return (
    <section className="panel">
      <div className="panel-title"><h2>On Air</h2><span>{playouts.length} instances</span></div>
      <div className="table">
        <div className="row head"><span>State</span><span>Label</span><span>Source</span><span>Target</span><span>PID</span><span>Uptime</span><span>Controls</span></div>
        {playouts.map((p) => (
          <div className="row" key={p.id}>
            <span><i className={clsx("lamp", p.state)} />{p.state}</span>
            <span>{p.label}</span>
            <span className="truncate">{p.filePath}</span>
            <span className="mono">{p.target}</span>
            <span>{p.pid ?? "-"}</span>
            <span>{uptime(p.startedAt)}</span>
            <span className="actions"><button title="Restart" onClick={() => void onRestart(p.id)}><RotateCw size={15} /></button><button title="Stop" onClick={() => void onStop(p.id)}><Square size={15} /></button></span>
          </div>
        ))}
        {!playouts.length && <div className="empty">No active or recent playouts.</div>}
      </div>
    </section>
  );
}

function LibraryPage({ files, query, setQuery, rescan, addFile }: { files: LibraryFile[]; query: string; setQuery: (q: string) => void; rescan: () => Promise<unknown>; addFile: (file: LibraryFile) => void }) {
  return (
    <section className="panel">
      <div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search library" /><button onClick={() => void rescan()}><FolderSync size={16} />Rescan</button></div>
      <div className="table library-table">
        <div className="row head"><span>File</span><span>Size</span><span>Modified</span><span>Status</span><span></span></div>
        {files.map((file) => <div className="row" key={file.id}><span className="truncate">{file.path}</span><span>{formatBytes(file.size)}</span><span>{new Date(file.modifiedAt).toLocaleString()}</span><span>{file.metadataStatus}</span><span><button onClick={() => addFile(file)}>Add</button></span></div>)}
        {!files.length && <div className="empty">No MPEG-TS files indexed. Check settings, then rescan.</div>}
      </div>
    </section>
  );
}

function CollectionsPage(props: { collections: Collection[]; active: Collection; setActive: (c: Collection) => void; files: LibraryFile[]; save: () => Promise<void>; updateEntry: (id: string, patch: Partial<CollectionPlayout>) => void; refresh: () => Promise<void> }) {
  const { collections, active, setActive, files, save, updateEntry, refresh } = props;
  return (
    <div className="split">
      <section className="panel rail">
        <div className="panel-title"><h2>Saved</h2><button onClick={() => setActive(emptyCollection())}>New</button></div>
        {collections.map((collection) => <button className="collection-button" key={collection.name} onClick={() => setActive(collection)}>{collection.name}<span>{collection.playouts.length} entries</span></button>)}
      </section>
      <section className="panel">
        <div className="toolbar">
          <input value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })} />
          <button className="primary" onClick={() => void save()}><Save size={16} />Save</button>
          <button onClick={() => void api.startCollection(active.name).then(refresh)}><Play size={16} />Start</button>
          <button onClick={() => void api.stopCollection(active.name).then(refresh)}><Square size={16} />Stop</button>
          <button className="danger-button" onClick={() => void api.deleteCollection(active.name).then(refresh)}><Trash2 size={16} /></button>
        </div>
        <textarea value={active.description} onChange={(e) => setActive({ ...active, description: e.target.value })} placeholder="Description" />
        <div className="toolbar"><button onClick={() => setActive({ ...active, playouts: [...active.playouts, newEntry(files[0])] })}>Add Playout</button></div>
        <div className="entry-list">
          {active.playouts.map((entry) => (
            <div className="entry" key={entry.id}>
              <input value={entry.label} onChange={(e) => updateEntry(entry.id, { label: e.target.value })} placeholder="Label" />
              <select value={entry.fileId ?? ""} onChange={(e) => updateEntry(entry.id, { fileId: e.target.value, filePath: undefined })}>
                <option value="">Manual file path</option>
                {files.map((file) => <option key={file.id} value={file.id}>{file.filename}</option>)}
              </select>
              {!entry.fileId && <input value={entry.filePath ?? ""} onChange={(e) => updateEntry(entry.id, { filePath: e.target.value })} placeholder="/path/to/file.ts" />}
              <input value={entry.target} onChange={(e) => updateEntry(entry.id, { target: e.target.value })} placeholder="udp://ip:port or srt://host:port" />
              <label><input type="checkbox" checked={entry.enabled} onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })} />Enabled</label>
              <label><input type="checkbox" checked={entry.autoRestart} onChange={(e) => updateEntry(entry.id, { autoRestart: e.target.checked })} />Auto restart</label>
              <button onClick={() => setActive({ ...active, playouts: active.playouts.filter((p) => p.id !== entry.id) })}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityPage({ activity }: { activity: ActivityEvent[] }) {
  return <section className="panel"><div className="event-list">{activity.map((event) => <div className="event" key={event.id}><span>{new Date(event.at).toLocaleTimeString()}</span><strong>{event.type}</strong><p>{event.message}</p></div>)}</div></section>;
}

function SettingsPage({ settings, setSettings, save }: { settings: Settings; setSettings: (s: Settings) => void; save: (s: Settings) => Promise<unknown> }) {
  const [paths, setPaths] = useState(settings.libraryPaths.join("\n"));
  const [args, setArgs] = useState(settings.smootherArgs.join("\n"));
  const next = { ...settings, libraryPaths: paths.split(/\n/).filter(Boolean), smootherArgs: args.split(/\n/).filter(Boolean) };
  return (
    <section className="panel settings-grid">
      <label>Library paths<textarea value={paths} onChange={(e) => setPaths(e.target.value)} /></label>
      <label>Smoother command<input value={settings.smootherCommand} onChange={(e) => setSettings({ ...settings, smootherCommand: e.target.value })} /></label>
      <label>Smoother args<textarea value={args} onChange={(e) => setArgs(e.target.value)} /></label>
      <label>Collections dir<input value={settings.collectionsDir} onChange={(e) => setSettings({ ...settings, collectionsDir: e.target.value })} /></label>
      <label>Cache dir<input value={settings.cacheDir} onChange={(e) => setSettings({ ...settings, cacheDir: e.target.value })} /></label>
      <label>Logs dir<input value={settings.logsDir} onChange={(e) => setSettings({ ...settings, logsDir: e.target.value })} /></label>
      <button className="primary" onClick={() => void save(next)}>Save Settings</button>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
