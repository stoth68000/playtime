import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LibraryScanner } from "../src/library/scanner.js";
import { EventBus } from "../src/events/eventBus.js";
import type { Settings } from "../src/models.js";
import { safeName } from "../src/util/paths.js";

assert.equal(safeName("Morning Grid"), "Morning-Grid");
assert.equal(safeName("../../bad"), "..-..-bad");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-smoke-"));
const libraryDir = path.join(root, "library");
await fs.mkdir(libraryDir);
const validFile = path.join(libraryDir, "valid.ts");
const invalidFile = path.join(libraryDir, "invalid.ts");
await fs.writeFile(validFile, "sample");
await fs.writeFile(invalidFile, "sample");
await fs.writeFile(path.join(libraryDir, "valid.playtime.json"), JSON.stringify({ comment: "Important reference stream", tags: ["future"] }));
await fs.writeFile(path.join(libraryDir, "invalid.playtime.json"), "{not json");

const settings: Settings = {
  serverPort: 0,
  libraryPaths: [libraryDir],
  smootherCommand: "smoother",
  smootherArgs: ["-i", "{file}", "-o", "{target}"],
  metadataProbeCommand: "missing-ffprobe",
  metadataProbeArgs: ["{file}"],
  ffmpegCommand: "missing-ffmpeg",
  mediaInfoCommand: "missing-mediainfo",
  collectionsDir: path.join(root, "collections"),
  cacheDir: path.join(root, "cache"),
  logsDir: path.join(root, "logs"),
  defaultUdpAddress: "227.1.1.1:4001",
  defaultLoop: true,
  defaultAutoRestart: false
};

const scanner = new LibraryScanner(settings, new EventBus());
const files = await scanner.scan();
const valid = files.find((file) => file.filename === "valid.ts");
const invalid = files.find((file) => file.filename === "invalid.ts");
assert.equal(valid?.sidecar?.comment, "Important reference stream");
assert.equal(valid?.sidecar?.path, path.join(libraryDir, "valid.playtime.json"));
assert.ok(invalid?.sidecar?.errors?.[0].startsWith("Sidecar read failed:"));
assert.equal(await scanner.sidecarOutput(valid?.id ?? ""), JSON.stringify({ comment: "Important reference stream", tags: ["future"] }));

console.log("smoke tests passed");
