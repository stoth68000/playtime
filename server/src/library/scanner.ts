import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import type { LibraryFile, Settings } from "../models.js";
import { ensureDir, readJson, writeJson } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";
import { EventBus } from "../events/eventBus.js";
import { ffprobeOutput, mediaInfoOutput, probeTransportStream } from "./probe.js";

const extensions = new Set([".ts", ".mts", ".m2ts", ".mpegts"]);
const execFileAsync = promisify(execFile);
const thumbnailWidth = 320;

export class LibraryScanner {
  private files = new Map<string, LibraryFile>();

  constructor(private settings: Settings, private events: EventBus) {}

  async loadCache(): Promise<void> {
    const cache = await readJson<LibraryFile[]>(this.cachePath());
    if (cache) this.files = new Map(cache.map((file) => [file.id, file]));
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  list(): LibraryFile[] {
    return [...this.files.values()].sort((a, b) => a.filename.localeCompare(b.filename));
  }

  get(id: string): LibraryFile | undefined {
    return this.files.get(id);
  }

  async thumbnailPath(id: string): Promise<string | undefined> {
    const file = this.files.get(id);
    if (!file?.metadata.thumbnailPath) return undefined;
    const thumbnailPath = resolveAppPath(file.metadata.thumbnailPath);
    try {
      await fs.access(thumbnailPath);
      return thumbnailPath;
    } catch {
      return undefined;
    }
  }

  async probeOutput(id: string): Promise<string | undefined> {
    const file = this.files.get(id);
    if (!file) return undefined;
    return ffprobeOutput(file.path, this.settings);
  }

  async mediaInfoOutput(id: string): Promise<string | undefined> {
    const file = this.files.get(id);
    if (!file) return undefined;
    return mediaInfoOutput(file.path, this.settings);
  }

  async scan(): Promise<LibraryFile[]> {
    this.events.emit("library.scan.started", "Library scan started");
    const discovered: LibraryFile[] = [];
    for (const libraryPath of this.settings.libraryPaths) {
      await this.walk(resolveAppPath(libraryPath), discovered);
    }
    await this.probeFiles(discovered);
    this.files = new Map(discovered.map((file) => [file.id, file]));
    await writeJson(this.cachePath(), discovered);
    this.events.emit("library.scan.completed", `Library scan found ${discovered.length} file(s)`, { count: discovered.length });
    return this.list();
  }

  private cachePath(): string {
    return path.join(resolveAppPath(this.settings.cacheDir), "library-index.json");
  }

  private async walk(dir: string, output: LibraryFile[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(fullPath, output);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(fullPath);
        const id = crypto.createHash("sha1").update(fullPath).digest("hex").slice(0, 16);
        const cached = this.files.get(id);
        const sidecar = await this.readSidecar(fullPath);
        const cachedHasThumbnail = !cached?.metadata.videoStreams?.length || this.hasCurrentThumbnail(id, cached);
        const cachedHasTransportType = Boolean(cached?.metadata.transportType);
        const unchanged = cached?.size === stat.size && cached.modifiedAt === stat.mtime.toISOString() && cached.metadataStatus === "probed" && cachedHasThumbnail && cachedHasTransportType;
        output.push({
          id,
          path: fullPath,
          filename: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          extension: path.extname(entry.name).toLowerCase(),
          metadataStatus: unchanged ? cached.metadataStatus : "basic",
          metadata: unchanged ? cached.metadata : { notes: ["Basic filesystem metadata indexed"] },
          sidecar
        });
      }
    }
  }

  private async readSidecar(filePath: string): Promise<LibraryFile["sidecar"]> {
    const sidecarPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.playtime.json`);
    try {
      const content = await fs.readFile(sidecarPath, "utf8");
      const parsed = JSON.parse(content) as { comment?: unknown };
      const sidecar: LibraryFile["sidecar"] = { path: sidecarPath };
      if (typeof parsed.comment === "string") sidecar.comment = parsed.comment;
      else if (parsed.comment !== undefined) sidecar.errors = ["Sidecar comment must be a string"];
      return sidecar;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      return { path: sidecarPath, errors: [`Sidecar read failed: ${(error as Error).message}`] };
    }
  }

  private async probeFiles(files: LibraryFile[]): Promise<void> {
    const pending = files.filter((file) => file.metadataStatus !== "probed");
    const concurrency = 2;
    let index = 0;
    const worker = async () => {
      while (index < pending.length) {
        const file = pending[index++];
        file.metadataStatus = "pending";
        this.events.emit("library.probe.started", `Probing ${file.filename}`, { id: file.id });
        const metadata = await probeTransportStream(file.path, this.settings);
        await this.generateThumbnail(file.id, file.path, metadata);
        file.metadata = metadata;
        file.metadataStatus = metadata.errors?.length ? "failed" : "probed";
        this.events.emit("library.probe.completed", `Probed ${file.filename}`, { id: file.id, status: file.metadataStatus });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  }

  private async generateThumbnail(id: string, filePath: string, metadata: LibraryFile["metadata"]): Promise<void> {
    if (!metadata.videoStreams?.length) return;
    const thumbnailPath = this.thumbnailCachePath(id);
    await ensureDir(path.dirname(thumbnailPath));
    try {
      await execFileAsync(this.ffmpegCommand(), [
        "-y",
        "-v", "error",
        "-i", filePath,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-vf", `scale=${thumbnailWidth}:-1`,
        thumbnailPath
      ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      metadata.thumbnailPath = thumbnailPath;
    } catch (error) {
      metadata.notes = [...(metadata.notes ?? []), `Thumbnail generation failed: ${(error as Error).message}`];
    }
  }

  private thumbnailCachePath(id: string): string {
    return path.join(resolveAppPath(this.settings.cacheDir), "thumbnails", `${id}-${thumbnailWidth}w.jpg`);
  }

  private hasCurrentThumbnail(id: string, cached?: LibraryFile): boolean {
    if (!cached?.metadata.thumbnailPath) return false;
    const expectedPath = this.thumbnailCachePath(id);
    return resolveAppPath(cached.metadata.thumbnailPath) === expectedPath && existsSync(expectedPath);
  }

  private ffmpegCommand(): string {
    const probeCommand = this.settings.metadataProbeCommand;
    if (probeCommand.endsWith("ffprobe")) return `${probeCommand.slice(0, -"ffprobe".length)}ffmpeg`;
    return "ffmpeg";
  }
}
