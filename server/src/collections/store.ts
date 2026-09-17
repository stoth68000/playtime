import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { Collection, Settings } from "../models.js";
import { readJson, writeJson } from "../util/fs.js";
import { resolveAppPath, safeName } from "../util/paths.js";
import { EventBus } from "../events/eventBus.js";

const targetSchema = z.string().regex(/^(udp|srt):\/\/.+/i, "Target must start with udp:// or srt://");
const playoutSchema = z.object({
  id: z.string().default(() => nanoid()),
  label: z.string().min(1),
  fileId: z.string().optional(),
  filePath: z.string().optional(),
  target: targetSchema,
  loop: z.boolean(),
  autoRestart: z.boolean(),
  enabled: z.boolean()
}).refine((entry) => Boolean(entry.fileId || entry.filePath), "Playout requires fileId or filePath");
const collectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  playouts: z.array(playoutSchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString())
});

export class CollectionStore {
  constructor(private settings: Settings, private events: EventBus) {}

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  async list(): Promise<Collection[]> {
    const dir = resolveAppPath(this.settings.collectionsDir);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const collections = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map((name) => this.get(path.basename(name, ".json")))
    );
    return collections
      .filter((collection): collection is Collection => collection !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<Collection | null> {
    const data = await readJson<unknown>(this.fileFor(name));
    return data ? collectionSchema.parse(data) : null;
  }

  async save(collection: Collection): Promise<Collection> {
    const parsed = collectionSchema.parse({ ...collection, updatedAt: new Date().toISOString() });
    const name = safeName(parsed.name);
    if (!name) throw new Error("Collection name must contain letters or numbers");
    const finalCollection = { ...parsed, name };
    await writeJson(this.fileFor(name), finalCollection);
    this.events.emit("collection.saved", `Collection saved: ${name}`, { name });
    return finalCollection;
  }

  async delete(name: string): Promise<void> {
    try {
      await fs.unlink(this.fileFor(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.events.emit("collection.deleted", `Collection deleted: ${name}`, { name });
  }

  private fileFor(name: string): string {
    return path.join(resolveAppPath(this.settings.collectionsDir), `${safeName(name)}.json`);
  }
}
