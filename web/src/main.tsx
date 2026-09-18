import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, ArrowDown, ArrowUp, Clipboard, Copy, Database, ExternalLink, Eye, FolderSync, Library, ListPlus, Play, RotateCw, Save, Search, Settings as SettingsIcon, Square, Terminal, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { api } from "./api/client";
import type { ActivityEvent, Collection, CollectionPlayout, LibraryFile, PlayoutInstance, Settings } from "./types";
import appIcon from "./app-icon.png";
import "./styles/app.css";

type Page = "dashboard" | "library" | "collections" | "activity" | "settings";

const emptyCollection = (): Collection => ({ name: "new-collection", description: "", startupOnBoot: false, updatedAt: new Date().toISOString(), playouts: [] });
const newEntry = (file?: LibraryFile): CollectionPlayout => ({
  id: crypto.randomUUID(),
  label: file?.filename ?? "New playout",
  fileId: file?.id,
  filePath: file?.path ?? "",
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

function formatDuration(value?: number): string {
  if (!value) return "-";
  const total = Math.round(value);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBitrate(value?: number): string {
  if (!value) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mb/s`;
  return `${Math.round(value / 1000)} kb/s`;
}

function videoSummary(file: LibraryFile): string {
  const video = file.metadata.videoStreams?.[0];
  if (!video) return "-";
  const size = video.width && video.height ? `${video.width} x ${video.height}${scanType(video.fieldOrder)}` : "";
  const rate = formatFrameRate(video.frameRate);
  const codec = formatVideoCodec(video.codec);
  return [size, rate, codec ? `(${codec})` : undefined].filter(Boolean).join(" ");
}

function transportTypeSummary(file: LibraryFile): string {
  return file.metadata.transportType ?? "-";
}

function formatFrameRate(value?: string): string | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  const rate = denominator ? numerator / denominator : Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return rate.toFixed(rate >= 100 ? 1 : 2).replace(/\.00$/, "");
}

function scanType(fieldOrder?: string): string {
  if (!fieldOrder) return "";
  return fieldOrder === "progressive" ? "p" : "i";
}

function formatVideoCodec(codec?: string): string | undefined {
  if (!codec) return undefined;
  const names: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    mpeg2video: "MPEG-2",
    mpeg4: "MPEG-4"
  };
  return names[codec] ?? codec.toUpperCase();
}

function audioSummary(file: LibraryFile): string {
  const audio = file.metadata.audioStreams ?? [];
  if (!audio.length) return "-";
  return audio.map((stream) => [formatAudioCodec(stream.codec), formatChannels(stream.channelLayout, stream.channels)].filter(Boolean).join(" ")).join(" / ");
}

function formatAudioCodec(codec?: string): string | undefined {
  if (!codec) return undefined;
  const names: Record<string, string> = {
    ac3: "AC3",
    eac3: "E-AC3",
    aac: "AAC",
    mp2: "MP2",
    mp3: "MP3"
  };
  return names[codec] ?? codec.toUpperCase();
}

function formatChannels(layout?: string, channels?: number): string | undefined {
  const clean = layout?.toLowerCase();
  if (clean?.startsWith("mono")) return "1.0";
  if (clean?.startsWith("stereo")) return "2.0";
  if (clean?.startsWith("5.1")) return "5.1";
  if (clean?.startsWith("7.1")) return "7.1";
  if (channels === 1) return "1.0";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return channels ? `${channels}ch` : undefined;
}

function collectionComparable(collection: Collection): string {
  return JSON.stringify({ name: collection.name, description: collection.description, startupOnBoot: collection.startupOnBoot, playouts: collection.playouts });
}

function validateEntry(entry: CollectionPlayout, files: LibraryFile[], entries: CollectionPlayout[]): string[] {
  const issues: string[] = [];
  const target = entry.target.trim();
  if (!entry.label.trim()) issues.push("Missing label");
  const resolvedFile = resolveEntryFile(entry, files);
  if (!entry.fileId && !entry.filePath?.trim()) issues.push("Missing source");
  if (entry.fileId && !resolvedFile) issues.push("Library file not found");
  if (!/^(udp|srt):\/\/[^:/\s]+:\d+([/?#].*)?$/i.test(target)) issues.push("Invalid target");
  if (entry.enabled && entries.some((other) => other.id !== entry.id && other.enabled && other.target.trim() === target)) issues.push("Duplicate target");
  return issues;
}

function basename(value?: string): string {
  return value?.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function resolveEntryFile(entry: CollectionPlayout, files: LibraryFile[]): LibraryFile | undefined {
  if (entry.fileId) {
    const byId = files.find((file) => file.id === entry.fileId);
    if (byId) return byId;
  }
  if (entry.filePath) {
    const byPath = files.find((file) => file.path === entry.filePath);
    if (byPath) return byPath;
    const name = basename(entry.filePath);
    const byPathName = files.find((file) => file.filename === name);
    if (byPathName) return byPathName;
  }
  return files.find((file) => file.filename === entry.label);
}

function fileLabel(entry: CollectionPlayout, files: LibraryFile[]): string {
  const resolvedFile = resolveEntryFile(entry, files);
  if (resolvedFile) return resolvedFile.filename;
  if (entry.fileId) return "Missing library file";
  return entry.filePath || "Manual file path";
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
    setActiveCollection((current) => {
      if (!nextCollections.length) return current.playouts.length ? current : emptyCollection();
      if (!current.name || (current.name === "new-collection" && !current.playouts.length)) return nextCollections[0];
      return nextCollections.some((collection) => collection.name === current.name) ? current : nextCollections[0];
    });
  };

  useEffect(() => {
    void refresh().catch((err) => setError(err.message));
    const events = new EventSource("/api/events");
    events.onmessage = () => void refresh();
    ["playout.started", "playout.exited", "playout.failed", "playout.deleted", "playout.log", "library.scan.completed", "collection.saved", "collection.deleted", "settings.updated"].forEach((name) => {
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
    return files.filter((file) => `${file.filename} ${file.path} ${file.sidecar?.comment ?? ""}`.toLowerCase().includes(q));
  }, [files, query]);

  const saveCollection = async () => {
    const saved = await api.saveCollection(activeCollection);
    setActiveCollection(saved);
    await refresh();
  };

  const startCollection = async (collection: Collection) => {
    setError("");
    try {
      const started = await api.startCollection(collection);
      await refresh();
      const count = started.length;
      const jobText = count === 1 ? "playout" : "playouts";
      window.alert(`Collection "${collection.name}" started with ${count} ${jobText}.`);
    } catch (err) {
      setError(`Start failed: ${(err as Error).message}`);
      throw err;
    }
  };

  const stopCollection = async (collection: Collection) => {
    setError("");
    try {
      await api.stopCollection(collection);
      await refresh();
    } catch (err) {
      setError(`Stop failed: ${(err as Error).message}`);
      throw err;
    }
  };

  const stopPlayout = async (id: string) => {
    setError("");
    const previousPlayouts = playouts;
    setPlayouts((current) => current.map((playout) => (
      playout.id === id ? { ...playout, state: "stopping" } : playout
    )));
    try {
      await api.stopPlayout(id);
      await refresh();
    } catch (err) {
      setPlayouts(previousPlayouts);
      setError(`Stop failed: ${(err as Error).message}`);
      throw err;
    }
  };

  const restartPlayout = async (id: string) => {
    setError("");
    const previousPlayouts = playouts;
    setPlayouts((current) => current.map((playout) => (
      playout.id === id ? { ...playout, state: "restarting" } : playout
    )));
    try {
      await api.restartPlayout(id);
      await refresh();
    } catch (err) {
      setPlayouts(previousPlayouts);
      setError(`Restart failed: ${(err as Error).message}`);
      throw err;
    }
  };

  const deleteCollection = async (name: string) => {
    setError("");
    const previousCollections = collections;
    const previousActive = activeCollection;
    const optimisticCollections = collections.filter((collection) => collection.name !== name);
    setCollections(optimisticCollections);
    setActiveCollection((current) => (current.name === name ? optimisticCollections[0] ?? emptyCollection() : current));
    try {
      await api.deleteCollection(name);
      const nextCollections = await api.collections();
      setCollections(nextCollections);
      setActiveCollection((current) => {
        if (!nextCollections.length) return emptyCollection();
        return nextCollections.some((collection) => collection.name === current.name) ? current : nextCollections[0];
      });
    } catch (err) {
      setCollections(previousCollections);
      setActiveCollection(previousActive);
      setError(`Delete failed: ${(err as Error).message}`);
      throw err;
    }
  };

  const deletePlayout = async (id: string) => {
    setError("");
    const previousPlayouts = playouts;
    setPlayouts((current) => current.filter((playout) => playout.id !== id));
    try {
      await api.deletePlayout(id);
      await refresh();
    } catch (err) {
      setPlayouts(previousPlayouts);
      setError(`Delete failed: ${(err as Error).message}`);
      throw err;
    }
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
        <div className="brand"><img src={appIcon} alt="" /> <span>PlayTime</span></div>
        <nav>
          <button className={clsx({ active: page === "dashboard" })} onClick={() => setPage("dashboard")}><Play size={16} />Dashboard</button>
          <button className={clsx({ active: page === "library" })} onClick={() => setPage("library")}><Library size={16} />Library</button>
          <button className={clsx({ active: page === "collections" })} onClick={() => setPage("collections")}><Database size={16} />Collections</button>
          <button className={clsx({ active: page === "activity" })} onClick={() => setPage("activity")}><Activity size={16} />Activity</button>
          <button className={clsx({ active: page === "settings" })} onClick={() => setPage("settings")}><SettingsIcon size={16} />Settings</button>
          <button onClick={() => window.open("/docs", "_blank", "noopener,noreferrer")}><ExternalLink size={16} />API Docs</button>
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
        {page === "dashboard" && <Dashboard files={files} playouts={playouts} onStop={stopPlayout} onRestart={restartPlayout} onDelete={deletePlayout} onStartAgain={(playout) => api.startPlayout({ id: crypto.randomUUID(), label: playout.label, filePath: playout.filePath, target: playout.target, loop: playout.loop, autoRestart: playout.autoRestart, enabled: true }).then(refresh)} onClearCompleted={() => api.clearCompletedPlayouts().then(refresh)} />}
        {page === "library" && <LibraryPage files={filteredFiles} query={query} setQuery={setQuery} rescan={() => api.rescan().then(setFiles)} addFile={(file) => { setActiveCollection((c) => ({ ...c, playouts: [...c.playouts, newEntry(file)] })); setPage("collections"); }} />}
        {page === "collections" && <CollectionsPage collections={collections} active={activeCollection} setActive={setActiveCollection} files={files} playouts={playouts} save={saveCollection} startCollection={startCollection} stopCollection={stopCollection} deleteCollection={deleteCollection} updateEntry={updateEntry} refresh={refresh} />}
        {page === "activity" && <ActivityPage activity={activity} />}
        {page === "settings" && settings && <SettingsPage settings={settings} setSettings={setSettings} save={(value) => api.saveSettings(value).then((saved) => { setSettings(saved); return refresh(); })} />}
      </main>
    </div>
  );
}

function Dashboard({ files, playouts, onStop, onRestart, onDelete, onStartAgain, onClearCompleted }: { files: LibraryFile[]; playouts: PlayoutInstance[]; onStop: (id: string) => Promise<unknown>; onRestart: (id: string) => Promise<unknown>; onDelete: (id: string) => Promise<unknown>; onStartAgain: (playout: PlayoutInstance) => Promise<unknown>; onClearCompleted: () => Promise<unknown> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "failed" | "complete">("all");
  const selected = playouts.find((playout) => playout.id === selectedId) ?? null;
  const visible = playouts.filter((playout) => {
    if (filter === "active") return ["starting", "running", "restarting", "stopping"].includes(playout.state);
    if (filter === "failed") return playout.state === "failed";
    if (filter === "complete") return playout.state === "exited";
    return true;
  });
  const completedCount = playouts.filter((playout) => ["exited", "failed"].includes(playout.state)).length;
  return (
    <>
    <section className="panel">
      <div className="panel-title">
        <h2>On Air</h2>
        <div className="toolbar compact">
          {(["all", "active", "failed", "complete"] as const).map((item) => <button className={clsx({ active: filter === item })} key={item} onClick={() => setFilter(item)}>{item}</button>)}
          <button disabled={!completedCount} onClick={() => void onClearCompleted()}>Clear Completed</button>
        </div>
      </div>
      <div className="table">
        <div className="row head playout-row"><span>Preview</span><span>State</span><span>Details</span><span>PID</span><span>Uptime</span><span>Last Log</span><span>Controls</span></div>
        {visible.map((p) => {
          const file = files.find((item) => item.path === p.filePath);
          const lastLog = p.failureReason ?? p.recentLogs.at(-1) ?? "-";
          const completed = ["exited", "failed"].includes(p.state);
          return (
          <div className={clsx("row", "playout-row", "inspect-row", { selected: selectedId === p.id })} key={p.id} role="button" tabIndex={0} onClick={() => setSelectedId(p.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(p.id); }}>
            <FileThumbnail file={file} size="dashboard" />
            <span><i className={clsx("lamp", p.state)} />{p.state}</span>
            <span className="playout-details">
              <strong className="truncate" title={p.label}>{p.label}</strong>
              <small className="truncate" title={p.filePath}>{p.filePath}</small>
              <small className="mono truncate" title={p.target}>{p.target}</small>
            </span>
            <span>{p.pid ?? "-"}</span>
            <span>{uptime(p.startedAt)}</span>
            <span className="truncate log-snippet" title={lastLog}>{lastLog}</span>
            <span className="actions">
              <button title="Restart" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onRestart(p.id); }}><RotateCw size={15} /></button>
              <button title="Stop" disabled={!["starting", "running", "restarting"].includes(p.state)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onStop(p.id); }}><Square size={15} /></button>
              {completed && <button title="Delete completed record" className="danger-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDelete(p.id); }}><Trash2 size={15} /></button>}
            </span>
          </div>
          );
        })}
        {!visible.length && <div className="empty">No playouts match this view.</div>}
      </div>
    </section>
    {selected && <PlayoutDrawer playout={selected} close={() => setSelectedId(null)} onStop={onStop} onRestart={onRestart} onStartAgain={onStartAgain} />}
    </>
  );
}

function PlayoutDrawer({ playout, close, onStop, onRestart, onStartAgain }: { playout: PlayoutInstance; close: () => void; onStop: (id: string) => Promise<unknown>; onRestart: (id: string) => Promise<unknown>; onStartAgain: (playout: PlayoutInstance) => Promise<unknown> }) {
  const commandLine = playout.command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
  const active = ["starting", "running", "restarting"].includes(playout.state);
  const copyCommand = () => void navigator.clipboard?.writeText(commandLine);
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <h2>{playout.label}</h2>
          <p><i className={clsx("lamp", playout.state)} />{playout.state}</p>
        </div>
        <button title="Close" onClick={close}><X size={16} /></button>
      </div>
      {playout.failureReason && <div className="alert danger">{playout.failureReason}</div>}
      <div className="detail-grid">
        <Detail label="Collection" value={playout.collectionName ?? "-"} />
        <Detail label="PID" value={playout.pid?.toString() ?? "-"} />
        <Detail label="Started" value={playout.startedAt ? new Date(playout.startedAt).toLocaleString() : "-"} />
        <Detail label="Stopped" value={playout.stoppedAt ? new Date(playout.stoppedAt).toLocaleString() : "-"} />
        <Detail label="Exit" value={playout.exitCode !== undefined ? `${playout.exitCode ?? "signal"}${playout.signal ? ` ${playout.signal}` : ""}` : "-"} />
        <Detail label="Restarts" value={playout.restartCount.toString()} />
        <Detail label="Source" value={playout.filePath} wide />
        <Detail label="Target" value={playout.target} wide />
        <Detail label="Log file" value={playout.logPath ?? "-"} wide />
      </div>
      <div className="drawer-actions">
        <button disabled={!active} onClick={() => void onStop(playout.id)}><Square size={15} />Stop</button>
        <button onClick={() => void onRestart(playout.id)}><RotateCw size={15} />Restart</button>
        <button onClick={() => void onStartAgain(playout)}><Play size={15} />Start Again</button>
        <button onClick={copyCommand}><Clipboard size={15} />Copy Command</button>
      </div>
      <div className="command-box"><Terminal size={16} /><code>{commandLine}</code></div>
      <div className="log-box">
        {playout.recentLogs.map((line, index) => <div className={clsx("log-line", { err: line.includes("[stderr]") || line.includes("[error]") })} key={`${line}-${index}`}>{line}</div>)}
        {!playout.recentLogs.length && <div className="empty">No log lines captured yet.</div>}
      </div>
    </aside>
  );
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={clsx("detail", { wide })}><span>{label}</span><strong>{value}</strong></div>;
}

function LibraryPage({ files, query, setQuery, rescan, addFile }: { files: LibraryFile[]; query: string; setQuery: (q: string) => void; rescan: () => Promise<unknown>; addFile: (file: LibraryFile) => void }) {
  const [probeFile, setProbeFile] = useState<LibraryFile | null>(null);
  const [probeOutput, setProbeOutput] = useState("");
  const [probeError, setProbeError] = useState("");
  const openProbe = async (file: LibraryFile) => {
    setProbeFile(file);
    setProbeOutput("");
    setProbeError("");
    try {
      const result = await api.probeOutput(file.id);
      setProbeOutput(result.output);
    } catch (err) {
      setProbeError((err as Error).message);
    }
  };
  return (
    <>
    <section className="panel">
      <div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search library" /><button onClick={() => void rescan()}><FolderSync size={16} />Rescan</button></div>
      <div className="table library-table">
        <div className="row head"><span>Preview</span><span>File</span><span>Duration</span><span>Bitrate</span><span>Video</span><span>Audio</span><span></span></div>
        {files.map((file) => {
          const video = videoSummary(file);
          const transportType = transportTypeSummary(file);
          const audio = audioSummary(file);
          const comment = file.sidecar?.comment ?? "";
          const sidecarErrors = file.sidecar?.errors?.join("\n") ?? "";
          return (
          <div className="row" key={file.id} onDoubleClick={() => void openProbe(file)}>
            <FileThumbnail file={file} />
            <span className="truncate" title={[file.filename, file.path, sidecarErrors || comment].filter(Boolean).join("\n")}>
              <strong>{file.filename}</strong>
              <small>{file.path}</small>
              {(comment || sidecarErrors) && <small className={clsx("comment-cell", { warn: sidecarErrors })}>{comment || "Sidecar error"}</small>}
            </span>
            <span>{formatDuration(file.metadata.duration)}</span>
            <span>{formatBitrate(file.metadata.bitrate)}</span>
            <span className="video-summary-cell" title={`${video}\n${transportType}`}>
              <span className="truncate media-summary-cell">{video}</span>
              <small>{transportType}</small>
            </span>
            <span className="truncate media-summary-cell" title={audio}>{audio}</span>
            <span className="row-actions">
              <button title="Analyze media" onClick={(event) => { event.stopPropagation(); void openProbe(file); }}><Eye size={15} /></button>
              <button onClick={(event) => { event.stopPropagation(); addFile(file); }}>Add</button>
            </span>
          </div>
          );
        })}
        {!files.length && <div className="empty">No MPEG-TS files indexed. Check settings, then rescan.</div>}
      </div>
    </section>
    {probeFile && <ProbeOutputModal file={probeFile} output={probeOutput} error={probeError} close={() => setProbeFile(null)} />}
    </>
  );
}

function ProbeOutputModal({ file, output, error, close }: { file: LibraryFile; output: string; error: string; close: () => void }) {
  const [tab, setTab] = useState<"ffprobe" | "mediainfo">("mediainfo");
  const [mediaInfoOutput, setMediaInfoOutput] = useState("");
  const [mediaInfoError, setMediaInfoError] = useState("");
  const loadMediaInfo = async (switchTab = true) => {
    if (switchTab) setTab("mediainfo");
    if (mediaInfoOutput || mediaInfoError) return;
    try {
      const result = await api.mediaInfoOutput(file.id);
      setMediaInfoOutput(result.output);
    } catch (err) {
      setMediaInfoError((err as Error).message);
    }
  };
  useEffect(() => {
    void loadMediaInfo(false);
  }, [file.id]);
  const activeOutput = tab === "ffprobe" ? output : mediaInfoOutput;
  const activeError = tab === "ffprobe" ? error : mediaInfoError;
  return (
    <div className="modal-backdrop">
      <div className="modal probe-modal">
        <div className="modal-head">
          <h2>Media Analysis</h2>
          <button title="Close" onClick={close}><X size={16} /></button>
        </div>
        <div className="probe-title"><strong>{file.filename}</strong><span>{file.path}</span></div>
        <div className="probe-tabs" role="tablist" aria-label="Media analysis output">
          <button className={clsx({ active: tab === "mediainfo" })} onClick={() => void loadMediaInfo()}>MediaInfo</button>
          <button className={clsx({ active: tab === "ffprobe" })} onClick={() => setTab("ffprobe")}>ffprobe</button>
        </div>
        <div className="probe-body">
          {activeError && <div className="alert danger">{activeError}</div>}
          <pre className="probe-output">{activeOutput || (!activeError ? "Loading..." : "")}</pre>
        </div>
      </div>
    </div>
  );
}

function FileThumbnail({ file, size = "default" }: { file?: LibraryFile; size?: "default" | "small" | "entry" | "dashboard" }) {
  const thumbnailSrc = file?.metadata.thumbnailPath ? `/api/library/files/${encodeURIComponent(file.id)}/thumbnail` : undefined;
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const positionPreview = (event: React.MouseEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const previewWidth = 320;
    const previewHeight = 180;
    const margin = 12;
    const rightSide = rect.right + margin;
    const left = rightSide + previewWidth <= window.innerWidth - margin ? rightSide : Math.max(margin, rect.left - previewWidth - margin);
    const centeredTop = rect.top + rect.height / 2 - previewHeight / 2;
    const top = Math.min(Math.max(margin, centeredTop), Math.max(margin, window.innerHeight - previewHeight - margin));
    setPreviewPosition({ left, top });
  };
  return (
    <span className={clsx("thumbnail-cell", { small: size === "small", entry: size === "entry", dashboard: size === "dashboard" })} onMouseEnter={positionPreview} onMouseMove={positionPreview} onMouseLeave={() => setPreviewPosition(null)}>
      {thumbnailSrc ? (
        <>
          <img className="thumb-image" src={thumbnailSrc} alt="" />
          <span className="thumbnail-preview" style={previewPosition ?? undefined}><img src={thumbnailSrc} alt="" /></span>
        </>
      ) : <span className="thumbnail-placeholder"><Library size={size === "small" ? 14 : 18} /></span>}
    </span>
  );
}

function CollectionsPage(props: { collections: Collection[]; active: Collection; setActive: (c: Collection) => void; files: LibraryFile[]; playouts: PlayoutInstance[]; save: () => Promise<void>; startCollection: (collection: Collection) => Promise<void>; stopCollection: (collection: Collection) => Promise<void>; deleteCollection: (name: string) => Promise<void>; updateEntry: (id: string, patch: Partial<CollectionPlayout>) => void; refresh: () => Promise<void> }) {
  const { collections, active, setActive, files, playouts, save, startCollection, stopCollection, deleteCollection: removeCollection, updateEntry, refresh } = props;
  const [pickerEntryId, setPickerEntryId] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [probeFile, setProbeFile] = useState<LibraryFile | null>(null);
  const [probeOutput, setProbeOutput] = useState("");
  const [probeError, setProbeError] = useState("");
  const savedVersion = collections.find((collection) => collection.name === active.name);
  const dirty = !savedVersion || collectionComparable(savedVersion) !== collectionComparable(active);
  const collectionIssues = active.playouts.flatMap((entry) => validateEntry(entry, files, active.playouts).map((issue) => `${entry.label || "Unnamed"}: ${issue}`));
  const enabledIssues = active.playouts.filter((entry) => entry.enabled).flatMap((entry) => validateEntry(entry, files, active.playouts));
  const validToStart = active.playouts.some((entry) => entry.enabled) && enabledIssues.length === 0;
  const pickerFiles = files.filter((file) => {
    const q = pickerQuery.toLowerCase();
    return `${file.filename} ${file.path} ${file.metadata.codecs?.join(" ") ?? ""} ${file.metadata.serviceNames?.join(" ") ?? ""}`.toLowerCase().includes(q);
  });
  const chooseFile = (file: LibraryFile) => {
    if (!pickerEntryId) return;
    if (pickerEntryId === "new") {
      setActive({ ...active, playouts: [...active.playouts, newEntry(file)] });
    } else {
      updateEntry(pickerEntryId, { fileId: file.id, filePath: file.path, label: file.filename });
    }
    setPickerEntryId(null);
    setPickerQuery("");
  };
  const moveEntry = (id: string, direction: -1 | 1) => {
    const index = active.playouts.findIndex((entry) => entry.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= active.playouts.length) return;
    const next = [...active.playouts];
    const [entry] = next.splice(index, 1);
    next.splice(nextIndex, 0, entry);
    setActive({ ...active, playouts: next });
  };
  const duplicateEntry = (entry: CollectionPlayout) => {
    setActive({
      ...active,
      playouts: [...active.playouts, { ...entry, id: crypto.randomUUID(), label: `${entry.label} copy` }]
    });
  };
  const deleteCollection = async () => {
    if (!savedVersion) return;
    const activeJobCount = playouts.filter((playout) => playout.collectionName === savedVersion.name && ["starting", "running", "restarting", "stopping"].includes(playout.state)).length;
    const jobText = activeJobCount === 1 ? "active job" : "active jobs";
    if (!window.confirm(`Delete collection "${savedVersion.name}" and delete ${activeJobCount} ${jobText}?`)) return;
    await removeCollection(savedVersion.name);
  };
  const startActiveCollection = async () => {
    const activeJobCount = playouts.filter((playout) => playout.collectionName === active.name && ["starting", "running", "restarting", "stopping"].includes(playout.state)).length;
    if (activeJobCount) {
      const jobText = activeJobCount === 1 ? "running playout" : "running playouts";
      if (!window.confirm(`Collection "${active.name}" already has ${activeJobCount} ${jobText}. Stop the existing collection and start again?`)) return;
      await stopCollection(active);
    }
    await startCollection(active);
  };
  const openProbe = async (file: LibraryFile) => {
    setProbeFile(file);
    setProbeOutput("");
    setProbeError("");
    try {
      const result = await api.probeOutput(file.id);
      setProbeOutput(result.output);
    } catch (err) {
      setProbeError((err as Error).message);
    }
  };
  return (
    <div className="split">
      <section className="panel rail">
        <div className="panel-title"><h2>Saved</h2><button onClick={() => setActive(emptyCollection())}>New</button></div>
        {collections.map((collection) => <button className={clsx("collection-button", { active: collection.name === active.name })} key={collection.name} onClick={() => setActive(collection)}>{collection.name}<span>{collection.playouts.length} entries</span></button>)}
      </section>
      <section className="panel">
        <div className="toolbar">
          <input value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })} />
          <span className={clsx("badge", dirty ? "warn" : "ok")}>{dirty ? "Unsaved" : "Saved"}</span>
          <button className="primary" disabled={collectionIssues.length > 0} onClick={() => void save()}><Save size={16} />Save</button>
          <button disabled={!validToStart} onClick={() => void startActiveCollection()}><Play size={16} />Start</button>
          <button onClick={() => void stopCollection(active)}><Square size={16} />Stop</button>
          <button className="danger-button" disabled={!savedVersion} onClick={() => void deleteCollection()}><Trash2 size={16} /></button>
        </div>
        <div className="collection-options">
          <label><input type="checkbox" checked={active.startupOnBoot} onChange={(e) => setActive({ ...active, startupOnBoot: e.target.checked })} />Startup on Boot</label>
        </div>
        <textarea value={active.description} onChange={(e) => setActive({ ...active, description: e.target.value })} placeholder="Description" />
        {collectionIssues.length > 0 && <div className="validation-strip">{collectionIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
        <div className="toolbar">
          <button onClick={() => setPickerEntryId("new")}><ListPlus size={16} />Add From Library</button>
          <button onClick={() => setActive({ ...active, playouts: [...active.playouts, newEntry()] })}>Add Manual</button>
        </div>
        <div className="entry-list">
          {active.playouts.map((entry, index) => {
            const issues = validateEntry(entry, files, active.playouts);
            const selectedFile = resolveEntryFile(entry, files);
            return (
            <div className={clsx("entry", { invalid: issues.length })} key={entry.id}>
              <div className="entry-head">
                <span className="badge index">{index + 1}</span>
                <input value={entry.label} onChange={(e) => updateEntry(entry.id, { label: e.target.value })} placeholder="Label" />
                <button title="Move up" disabled={index === 0} onClick={() => moveEntry(entry.id, -1)}><ArrowUp size={15} /></button>
                <button title="Move down" disabled={index === active.playouts.length - 1} onClick={() => moveEntry(entry.id, 1)}><ArrowDown size={15} /></button>
                <button title="Duplicate" onClick={() => duplicateEntry(entry)}><Copy size={15} /></button>
                <button title="Analyze media" disabled={!selectedFile} onClick={() => selectedFile && void openProbe(selectedFile)}><Eye size={15} /></button>
                <button title="Start entry" disabled={issues.length > 0 || dirty} onClick={() => void api.startPlayout(entry).then(refresh)}><Play size={15} /></button>
                <button title="Remove" onClick={() => setActive({ ...active, playouts: active.playouts.filter((p) => p.id !== entry.id) })}><Trash2 size={15} /></button>
              </div>
              <div className="entry-grid">
                <div className="entry-thumbnail">
                  <FileThumbnail file={selectedFile} size="entry" />
                </div>
                <div className="entry-fields">
                  <button className="source-button" title={fileLabel(entry, files)} onClick={() => setPickerEntryId(entry.id)}>
                    <span>{fileLabel(entry, files)}</span>
                  </button>
                  {!entry.fileId && <input value={entry.filePath ?? ""} onChange={(e) => updateEntry(entry.id, { filePath: e.target.value })} placeholder="/path/to/file.ts" />}
                  <input value={entry.target} onChange={(e) => updateEntry(entry.id, { target: e.target.value })} placeholder="udp://ip:port or srt://host:port" />
                  <div className="entry-status-row">
                    <div className="entry-toggles">
                      <label><input type="checkbox" checked={entry.enabled} onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })} />Enabled</label>
                      <label><input type="checkbox" checked={entry.loop} onChange={(e) => updateEntry(entry.id, { loop: e.target.checked })} />Loop</label>
                      <label><input type="checkbox" checked={entry.autoRestart} onChange={(e) => updateEntry(entry.id, { autoRestart: e.target.checked })} />Auto restart</label>
                    </div>
                    {selectedFile && <div className="entry-meta compact"><span>{formatDuration(selectedFile.metadata.duration)}</span><span>{formatBitrate(selectedFile.metadata.bitrate)}</span></div>}
                  </div>
                </div>
              </div>
              {issues.length > 0 && <div className="entry-errors">{issues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
            </div>
            );
          })}
          {!active.playouts.length && <div className="empty">No playout entries yet.</div>}
        </div>
      </section>
      {pickerEntryId && <FilePicker files={pickerFiles} query={pickerQuery} setQuery={setPickerQuery} choose={chooseFile} close={() => setPickerEntryId(null)} />}
      {probeFile && <ProbeOutputModal file={probeFile} output={probeOutput} error={probeError} close={() => setProbeFile(null)} />}
    </div>
  );
}

function FilePicker({ files, query, setQuery, choose, close }: { files: LibraryFile[]; query: string; setQuery: (value: string) => void; choose: (file: LibraryFile) => void; close: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <h2>Select Library File</h2>
          <button title="Close" onClick={close}><X size={16} /></button>
        </div>
        <div className="searchline"><Search size={16} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search filename, path, codec, service" /></div>
        <div className="table picker-table">
          <div className="row head"><span>Preview</span><span>File</span><span>Duration</span><span>Bitrate</span><span>Video</span><span>Audio</span></div>
          {files.map((file) => {
            const video = videoSummary(file);
            const transportType = transportTypeSummary(file);
            const audio = audioSummary(file);
            return (
            <button className="row picker-row" key={file.id} onClick={() => choose(file)}>
              <FileThumbnail file={file} />
              <span className="truncate" title={`${file.filename}\n${file.path}`}><strong>{file.filename}</strong><small>{file.path}</small></span>
              <span>{formatDuration(file.metadata.duration)}</span>
              <span>{formatBitrate(file.metadata.bitrate)}</span>
              <span className="video-summary-cell" title={`${video}\n${transportType}`}>
                <span className="truncate media-summary-cell">{video}</span>
                <small>{transportType}</small>
              </span>
              <span className="truncate media-summary-cell" title={audio}>{audio}</span>
            </button>
            );
          })}
          {!files.length && <div className="empty">No matching files.</div>}
        </div>
      </div>
    </div>
  );
}

function ActivityPage({ activity }: { activity: ActivityEvent[] }) {
  return <section className="panel"><div className="event-list">{activity.map((event) => <div className="event" key={event.id}><span>{new Date(event.at).toLocaleTimeString()}</span><strong>{event.type}</strong><p>{event.message}</p></div>)}</div></section>;
}

function SettingsPage({ settings, setSettings, save }: { settings: Settings; setSettings: (s: Settings) => void; save: (s: Settings) => Promise<unknown> }) {
  const [paths, setPaths] = useState(settings.libraryPaths.join("\n"));
  const [args, setArgs] = useState(settings.smootherArgs.join("\n"));
  const [probeArgs, setProbeArgs] = useState(settings.metadataProbeArgs.join("\n"));
  const next = { ...settings, libraryPaths: paths.split(/\n/).filter(Boolean), smootherArgs: args.split(/\n/).filter(Boolean), metadataProbeArgs: probeArgs.split(/\n/).filter(Boolean) };
  return (
    <section className="panel settings-grid">
      <label>Library paths<textarea value={paths} onChange={(e) => setPaths(e.target.value)} /></label>
      <label>Smoother command<input value={settings.smootherCommand} onChange={(e) => setSettings({ ...settings, smootherCommand: e.target.value })} /></label>
      <label>Smoother args<textarea value={args} onChange={(e) => setArgs(e.target.value)} /></label>
      <label>Metadata probe command<input value={settings.metadataProbeCommand} onChange={(e) => setSettings({ ...settings, metadataProbeCommand: e.target.value })} /></label>
      <label>Metadata probe args<textarea value={probeArgs} onChange={(e) => setProbeArgs(e.target.value)} /></label>
      <label>MediaInfo command<input value={settings.mediaInfoCommand} onChange={(e) => setSettings({ ...settings, mediaInfoCommand: e.target.value })} /></label>
      <label>Collections dir<input value={settings.collectionsDir} onChange={(e) => setSettings({ ...settings, collectionsDir: e.target.value })} /></label>
      <label>Cache dir<input value={settings.cacheDir} onChange={(e) => setSettings({ ...settings, cacheDir: e.target.value })} /></label>
      <label>Logs dir<input value={settings.logsDir} onChange={(e) => setSettings({ ...settings, logsDir: e.target.value })} /></label>
      <button className="primary" onClick={() => void save(next)}>Save Settings</button>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
