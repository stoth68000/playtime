import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LibraryFile, Settings } from "../models.js";
import { readJson, writeJson } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";
import { EventBus } from "../events/eventBus.js";
import { probeTransportStream } from "./probe.js";

const extensions = new Set([".ts", ".mts", ".m2ts", ".mpegts"]);

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
        const unchanged = cached?.size === stat.size && cached.modifiedAt === stat.mtime.toISOString() && cached.metadataStatus === "probed";
        output.push({
          id,
          path: fullPath,
          filename: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          extension: path.extname(entry.name).toLowerCase(),
          metadataStatus: unchanged ? cached.metadataStatus : "basic",
          metadata: unchanged ? cached.metadata : { notes: ["Basic filesystem metadata indexed"] }
        });
      }
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
        file.metadata = metadata;
        file.metadataStatus = metadata.errors?.length ? "failed" : "probed";
        this.events.emit("library.probe.completed", `Probed ${file.filename}`, { id: file.id, status: file.metadataStatus });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  }
}
