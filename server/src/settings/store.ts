import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { Settings } from "../models.js";
import { ensureDir, readJson, writeJson } from "../util/fs.js";
import { resolveAppPath } from "../util/paths.js";

const settingsSchema = z.object({
  serverPort: z.number().int().min(1).max(65535).default(4500),
  libraryPaths: z.array(z.string()).default(["./samples"]),
  smootherCommand: z.string().default("./bin/tstools_bitrate_smoother"),
  smootherArgs: z.array(z.string()).default(["--input", "{file}", "--output", "{target}"]),
  collectionsDir: z.string().default("./data/collections"),
  cacheDir: z.string().default("./data/cache"),
  logsDir: z.string().default("./data/logs"),
  defaultLoop: z.boolean().default(true),
  defaultAutoRestart: z.boolean().default(false)
});

export class SettingsStore {
  constructor(private readonly file = resolveAppPath("./data/settings.json")) {}

  async load(): Promise<Settings> {
    const loaded = await readJson<unknown>(this.file);
    const settings = settingsSchema.parse(loaded ?? {});
    await this.save(settings);
    await ensureDir(resolveAppPath(settings.collectionsDir));
    await ensureDir(resolveAppPath(settings.cacheDir));
    await ensureDir(resolveAppPath(settings.logsDir));
    return settings;
  }

  async save(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(settings);
    await writeJson(this.file, parsed);
    return parsed;
  }

  validateRuntime(settings: Settings): string[] {
    const warnings: string[] = [];
    for (const libraryPath of settings.libraryPaths) {
      if (!existsSync(resolveAppPath(libraryPath))) warnings.push(`Library path not found: ${libraryPath}`);
    }
    const commandPath = resolveAppPath(settings.smootherCommand);
    if (settings.smootherCommand.includes("/") && !existsSync(commandPath)) {
      warnings.push(`Smoother command not found: ${settings.smootherCommand}`);
    }
    if (!settings.smootherArgs.some((arg) => arg.includes("{file}"))) warnings.push("smootherArgs should include {file}");
    if (!settings.smootherArgs.some((arg) => arg.includes("{target}"))) warnings.push("smootherArgs should include {target}");
    return warnings;
  }
}
