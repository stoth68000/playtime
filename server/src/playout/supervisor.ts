import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Collection, CollectionPlayout, LibraryFile, PlayoutInstance, Settings } from "../models.js";
import { EventBus } from "../events/eventBus.js";
import { ensureDir } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";

interface RunningProcess {
  child: ChildProcess;
  log: WriteStream;
  instance: PlayoutInstance;
  exitPromise: Promise<void>;
  forceStopTimer?: NodeJS.Timeout;
}

const stopGraceMs = 2500;
const shutdownGraceMs = 3000;

export class PlayoutSupervisor {
  private running = new Map<string, RunningProcess>();
  private instances = new Map<string, PlayoutInstance>();
  private restartTimers = new Map<string, NodeJS.Timeout>();

  constructor(private settings: Settings, private events: EventBus, private listFiles: () => LibraryFile[]) {}

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  list(): PlayoutInstance[] {
    return [...this.instances.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  get(id: string): PlayoutInstance | undefined {
    return this.instances.get(id);
  }

  clearCompleted(): number {
    let cleared = 0;
    for (const [id, instance] of this.instances.entries()) {
      if (!this.running.has(id) && ["exited", "failed"].includes(instance.state)) {
        this.clearRestartTimer(id);
        this.instances.delete(id);
        cleared += 1;
      }
    }
    if (cleared) this.events.emit("playout.cleared", `Cleared ${cleared} completed playout(s)`, { cleared });
    return cleared;
  }

  delete(id: string): PlayoutInstance | undefined {
    const instance = this.instances.get(id);
    if (!instance) return undefined;
    if (this.running.has(id) || !["exited", "failed"].includes(instance.state)) throw new Error("Only completed playout records can be deleted");
    this.clearRestartTimer(id);
    this.instances.delete(id);
    this.events.emit("playout.deleted", `Deleted ${instance.label}`, { id });
    return instance;
  }

  async deleteCollectionInstances(collectionName: string): Promise<number> {
    const matching = this.list().filter((instance) => instance.collectionName === collectionName);
    await Promise.all(matching.map(async (instance) => {
      if (this.running.has(instance.id) || instance.state === "restarting") {
        await this.stop(instance.id);
        await this.running.get(instance.id)?.exitPromise;
      }
      this.clearRestartTimer(instance.id);
      this.instances.delete(instance.id);
      this.events.emit("playout.deleted", `Deleted ${instance.label}`, { id: instance.id, collectionName });
    }));
    if (matching.length) this.events.emit("playout.collection_deleted", `Deleted ${matching.length} playout(s) for ${collectionName}`, { collectionName, deleted: matching.length });
    return matching.length;
  }

  async start(entry: CollectionPlayout, collection?: Collection): Promise<PlayoutInstance> {
    const filePath = this.resolveEntryFilePath(entry);
    if (!filePath) throw new Error("Unable to resolve playout source file");
    if (!/^(udp|srt):\/\/.+/i.test(entry.target)) throw new Error("Target must start with udp:// or srt://");

    const id = nanoid();
    const command = this.renderCommand(filePath, entry.target);
    this.validateCommand(command, filePath, entry.target);
    const instance: PlayoutInstance = {
      id,
      collectionName: collection?.name,
      entryId: entry.id,
      label: entry.label,
      filePath,
      target: entry.target,
      state: "starting",
      loop: entry.loop,
      autoRestart: entry.autoRestart,
      startedAt: new Date().toISOString(),
      restartCount: 0,
      command,
      recentLogs: []
    };
    this.instances.set(id, instance);
    await this.launch(instance);
    return instance;
  }

  async startCollection(collection: Collection): Promise<PlayoutInstance[]> {
    const started: PlayoutInstance[] = [];
    for (const entry of collection.playouts.filter((item) => item.enabled)) {
      started.push(await this.start(entry, collection));
    }
    return started;
  }

  async stop(id: string): Promise<PlayoutInstance> {
    const running = this.running.get(id);
    const instance = this.instances.get(id);
    if (!instance) throw new Error("Playout not found");
    this.clearRestartTimer(id);
    instance.state = "stopping";
    this.events.emit("playout.stopping", `Stopping ${instance.label}`, { id });
    if (running) {
      running.child.kill("SIGTERM");
      running.forceStopTimer = setTimeout(() => {
        if (this.running.has(id)) {
          instance.recentLogs = [...instance.recentLogs, `[system] Process did not exit after SIGTERM; sending SIGKILL`].slice(-80);
          this.events.emit("playout.force_stopping", `Force stopping ${instance.label}`, { id });
          running.child.kill("SIGKILL");
        }
      }, stopGraceMs);
    }
    else {
      instance.state = "exited";
      instance.stoppedAt = new Date().toISOString();
    }
    return instance;
  }

  async restart(id: string): Promise<PlayoutInstance> {
    const instance = this.instances.get(id);
    if (!instance) throw new Error("Playout not found");
    this.clearRestartTimer(id);
    const running = this.running.get(id);
    if (running) {
      await this.stop(id);
      await running.exitPromise;
    }
    instance.state = "restarting";
    instance.restartCount += 1;
    instance.startedAt = new Date().toISOString();
    instance.stoppedAt = undefined;
    instance.exitCode = undefined;
    instance.signal = undefined;
    instance.failureReason = undefined;
    instance.pid = undefined;
    instance.command = this.renderCommand(instance.filePath, instance.target);
    this.validateCommand(instance.command, instance.filePath, instance.target);
    await this.launch(instance);
    this.events.emit("playout.restarted", `Restarted ${instance.label}`, { id });
    return instance;
  }

  async stopCollection(collection: Collection): Promise<number> {
    const activeStates: PlayoutInstance["state"][] = ["starting", "running", "restarting", "stopping"];
    const entryIds = new Set(collection.playouts.map((entry) => entry.id));
    const sourcesAndTargets = new Set(collection.playouts.map((entry) => {
      const filePath = this.resolveEntryFilePath(entry);
      return filePath ? `${filePath}\0${entry.target}` : "";
    }).filter(Boolean));
    const matching = this.list().filter((instance) => {
      if (!activeStates.includes(instance.state)) return false;
      if (instance.collectionName === collection.name) return true;
      if (instance.entryId && entryIds.has(instance.entryId)) return true;
      return sourcesAndTargets.has(`${instance.filePath}\0${instance.target}`);
    });
    await Promise.all(matching.map(async (instance) => {
      await this.stop(instance.id);
      await this.running.get(instance.id)?.exitPromise;
    }));
    return matching.length;
  }

  async shutdown(): Promise<void> {
    const running = [...this.running.values()];
    for (const id of this.restartTimers.keys()) this.clearRestartTimer(id);
    if (!running.length) return;
    for (const item of running) {
      item.instance.state = "stopping";
      this.events.emit("playout.stopping", `Stopping ${item.instance.label}`, { id: item.instance.id, shutdown: true });
      item.child.kill("SIGTERM");
    }
    await Promise.race([
      Promise.all(running.map((item) => item.exitPromise)),
      new Promise<void>((resolve) => setTimeout(resolve, shutdownGraceMs))
    ]);
    const stubborn = [...this.running.values()];
    for (const item of stubborn) {
      item.instance.recentLogs = [...item.instance.recentLogs, `[system] Server shutdown forced SIGKILL`].slice(-80);
      this.events.emit("playout.force_stopping", `Force stopping ${item.instance.label}`, { id: item.instance.id, shutdown: true });
      item.child.kill("SIGKILL");
    }
    await Promise.all(stubborn.map((item) => item.exitPromise));
  }

  renderCommand(file: string, target: string): string[] {
    return [
      resolveAppPath(this.settings.smootherCommand),
      ...this.settings.smootherArgs.map((arg) => arg.replaceAll("{file}", file).replaceAll("{target}", target))
    ];
  }

  validateCommand(command: string[], file: string, target: string): void {
    if (!command[0]) throw new Error("Smoother command is empty");
    if (!command.includes(file)) throw new Error("Rendered smoother command does not include the source file");
    if (!command.includes(target)) throw new Error("Rendered smoother command does not include the target URL");
    const unresolved = command.find((part) => part.includes("{file}") || part.includes("{target}"));
    if (unresolved) throw new Error(`Rendered smoother command has unresolved template token: ${unresolved}`);
  }

  private resolveEntryFilePath(entry: CollectionPlayout): string | undefined {
    const files = this.listFiles();
    if (entry.fileId) {
      const byId = files.find((file) => file.id === entry.fileId);
      if (byId) return byId.path;
    }
    if (entry.filePath) {
      const byPath = files.find((file) => file.path === entry.filePath);
      if (byPath) return byPath.path;
      const byPathName = files.find((file) => file.filename === path.basename(entry.filePath ?? ""));
      if (byPathName) return byPathName.path;
      return entry.filePath;
    }
    return files.find((file) => file.filename === entry.label)?.path;
  }

  private async launch(instance: PlayoutInstance): Promise<void> {
    await ensureDir(path.join(resolveAppPath(this.settings.logsDir), "playouts"));
    const [command, ...args] = instance.command;
    instance.logPath = path.join(resolveAppPath(this.settings.logsDir), "playouts", `${instance.id}.log`);
    const log = createWriteStream(instance.logPath, { flags: "a" });
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let resolveExit: () => void = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let logClosed = false;
    const closeLog = () => {
      if (!logClosed) {
        logClosed = true;
        log.end();
      }
    };
    instance.pid = child.pid;
    instance.state = "running";
    this.running.set(instance.id, { child, log, instance, exitPromise });
    this.events.emit("playout.started", `Started ${instance.label}`, { id: instance.id, pid: child.pid });

    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const text = `[${stream}] ${line}`;
        instance.recentLogs = [...instance.recentLogs, text].slice(-80);
        log.write(`${new Date().toISOString()} ${text}\n`);
        this.events.emit("playout.log", text, { id: instance.id });
      }
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    child.on("error", (error) => {
      this.running.delete(instance.id);
      instance.state = "failed";
      instance.failureReason = error.message;
      instance.stoppedAt = new Date().toISOString();
      instance.recentLogs = [...instance.recentLogs, `[error] ${error.message}`].slice(-80);
      closeLog();
      resolveExit();
      this.events.emit("playout.failed", `${instance.label} failed to start`, { id: instance.id, error: error.message });
    });
    child.on("exit", (code, signal) => {
      const running = this.running.get(instance.id);
      if (running?.forceStopTimer) clearTimeout(running.forceStopTimer);
      const operatorStopped = instance.state === "stopping";
      const cleanExit = code === 0;
      const shouldRestart = !operatorStopped && ((cleanExit && instance.loop) || (!cleanExit && instance.autoRestart));
      this.running.delete(instance.id);
      closeLog();
      instance.exitCode = code;
      instance.signal = signal;
      instance.stoppedAt = new Date().toISOString();
      instance.state = code === 0 || instance.state === "stopping" ? "exited" : "failed";
      instance.failureReason = instance.state === "failed" ? `Exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}` : undefined;
      resolveExit();
      this.events.emit("playout.exited", `${instance.label} exited`, { id: instance.id, code, signal });
      if (shouldRestart) {
        instance.restartCount += 1;
        instance.state = "restarting";
        instance.pid = undefined;
        const timer = setTimeout(() => {
          this.restartTimers.delete(instance.id);
          if (instance.state === "restarting") void this.launch(instance);
        }, 1000);
        this.restartTimers.set(instance.id, timer);
      }
    });
  }

  private clearRestartTimer(id: string): void {
    const timer = this.restartTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.restartTimers.delete(id);
  }
}
