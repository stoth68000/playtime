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
  metadataProbeCommand: z.string().default("./bin/ffprobe"),
  metadataProbeArgs: z.array(z.string()).default(["-v", "error", "-show_format", "-show_streams", "-show_programs", "-of", "json", "{file}"]),
  ffmpegCommand: z.string().default("./bin/ffmpeg"),
  mediaInfoCommand: z.string().default("./bin/mediainfo"),
  collectionsDir: z.string().default("./data/collections"),
  cacheDir: z.string().default("./data/cache"),
  logsDir: z.string().default("./data/logs"),
  defaultUdpAddress: z.string().default("227.1.1.1:4001"),
  defaultLoop: z.boolean().default(true),
  defaultAutoRestart: z.boolean().default(false)
});

export class SettingsStore {
  constructor(private readonly file = resolveAppPath("./data/settings.json")) {}

  async load(): Promise<Settings> {
    const loaded = await readJson<unknown>(this.file);
    const settings = this.preferBundledTools(settingsSchema.parse(loaded ?? {}));
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
    const probeCommandPath = resolveAppPath(settings.metadataProbeCommand);
    if (settings.metadataProbeCommand.includes("/") && !existsSync(probeCommandPath)) {
      warnings.push(`Metadata probe command not found: ${settings.metadataProbeCommand}`);
    }
    const ffmpegCommandPath = resolveAppPath(settings.ffmpegCommand);
    if (settings.ffmpegCommand.includes("/") && !existsSync(ffmpegCommandPath)) {
      warnings.push(`FFmpeg command not found: ${settings.ffmpegCommand}`);
    }
    const mediaInfoCommandPath = resolveAppPath(settings.mediaInfoCommand);
    if (settings.mediaInfoCommand.includes("/") && !existsSync(mediaInfoCommandPath)) {
      warnings.push(`MediaInfo command not found: ${settings.mediaInfoCommand}`);
    }
    if (!settings.smootherArgs.some((arg) => arg.includes("{file}"))) warnings.push("smootherArgs should include {file}");
    if (!settings.smootherArgs.some((arg) => arg.includes("{target}"))) warnings.push("smootherArgs should include {target}");
    if (!settings.metadataProbeArgs.some((arg) => arg.includes("{file}"))) warnings.push("metadataProbeArgs should include {file}");
    if (!/^(udp:\/\/)?\d{1,3}(\.\d{1,3}){3}:\d+$/i.test(settings.defaultUdpAddress)) warnings.push("defaultUdpAddress should look like 227.1.1.1:4001");
    return warnings;
  }

  private preferBundledTools(settings: Settings): Settings {
    return {
      ...settings,
      metadataProbeCommand: this.preferBundledTool(settings.metadataProbeCommand, "ffprobe"),
      ffmpegCommand: this.preferBundledTool(settings.ffmpegCommand, "ffmpeg"),
      mediaInfoCommand: this.preferBundledTool(settings.mediaInfoCommand, "mediainfo")
    };
  }

  private preferBundledTool(command: string, binary: string): string {
    const bundled = `./bin/${binary}`;
    return command === binary && existsSync(resolveAppPath(bundled)) ? bundled : command;
  }
}
