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
}

export class PlayoutSupervisor {
  private running = new Map<string, RunningProcess>();
  private instances = new Map<string, PlayoutInstance>();

  constructor(private settings: Settings, private events: EventBus, private findFile: (id: string) => LibraryFile | undefined) {}

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
        this.instances.delete(id);
        cleared += 1;
      }
    }
    if (cleared) this.events.emit("playout.cleared", `Cleared ${cleared} completed playout(s)`, { cleared });
    return cleared;
  }

  async start(entry: CollectionPlayout, collection?: Collection): Promise<PlayoutInstance> {
    const filePath = entry.filePath ?? (entry.fileId ? this.findFile(entry.fileId)?.path : undefined);
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
      startedAt: new Date().toISOString(),
      restartCount: 0,
      command,
      recentLogs: []
    };
    this.instances.set(id, instance);
    await this.launch(instance, entry.autoRestart);
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
    instance.state = "stopping";
    this.events.emit("playout.stopping", `Stopping ${instance.label}`, { id });
    if (running) running.child.kill("SIGTERM");
    else {
      instance.state = "exited";
      instance.stoppedAt = new Date().toISOString();
    }
    return instance;
  }

  async restart(id: string): Promise<PlayoutInstance> {
    const old = this.instances.get(id);
    if (!old) throw new Error("Playout not found");
    await this.stop(id);
    old.state = "restarting";
    const entry: CollectionPlayout = {
      id: old.entryId ?? nanoid(),
      label: old.label,
      filePath: old.filePath,
      target: old.target,
      loop: true,
      autoRestart: false,
      enabled: true
    };
    const next = await this.start(entry);
    next.restartCount = old.restartCount + 1;
    this.events.emit("playout.restarted", `Restarted ${old.label}`, { oldId: id, id: next.id });
    return next;
  }

  async stopCollection(name: string): Promise<number> {
    const matching = this.list().filter((instance) => instance.collectionName === name && ["starting", "running"].includes(instance.state));
    await Promise.all(matching.map((instance) => this.stop(instance.id)));
    return matching.length;
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

  private async launch(instance: PlayoutInstance, autoRestart: boolean): Promise<void> {
    await ensureDir(path.join(resolveAppPath(this.settings.logsDir), "playouts"));
    const [command, ...args] = instance.command;
    instance.logPath = path.join(resolveAppPath(this.settings.logsDir), "playouts", `${instance.id}.log`);
    const log = createWriteStream(instance.logPath, { flags: "a" });
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let logClosed = false;
    const closeLog = () => {
      if (!logClosed) {
        logClosed = true;
        log.end();
      }
    };
    instance.pid = child.pid;
    instance.state = "running";
    this.running.set(instance.id, { child, log, instance });
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
      this.events.emit("playout.failed", `${instance.label} failed to start`, { id: instance.id, error: error.message });
    });
    child.on("exit", (code, signal) => {
      this.running.delete(instance.id);
      closeLog();
      instance.exitCode = code;
      instance.signal = signal;
      instance.stoppedAt = new Date().toISOString();
      instance.state = code === 0 || instance.state === "stopping" ? "exited" : "failed";
      instance.failureReason = instance.state === "failed" ? `Exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}` : undefined;
      this.events.emit("playout.exited", `${instance.label} exited`, { id: instance.id, code, signal });
      if (autoRestart && instance.state === "failed") {
        instance.restartCount += 1;
        instance.state = "restarting";
        setTimeout(() => void this.launch(instance, autoRestart), 1000);
      }
    });
  }
}
