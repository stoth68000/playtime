import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PlayoutSupervisor } from "../src/playout/supervisor.js";
import { EventBus } from "../src/events/eventBus.js";
import type { Collection, CollectionPlayout, LibraryFile, PlayoutInstance, Settings } from "../src/models.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-supervisor-"));
const okScript = path.join(root, "ok.mjs");
const failScript = path.join(root, "fail.mjs");
const flakyScript = path.join(root, "flaky.mjs");
const stubbornScript = path.join(root, "stubborn.mjs");
const cleanRestartScript = path.join(root, "clean-restart.mjs");
const source = path.join(root, "source.ts");
await fs.writeFile(source, "sample");
await fs.writeFile(okScript, `
const args = process.argv.slice(2);
const input = args[args.indexOf("-i") + 1];
const output = args[args.indexOf("-o") + 1];
console.log("started " + input + " " + output);
let count = 0;
const timer = setInterval(() => {
  count += 1;
  console.log("tick " + count);
}, 100);
process.on("SIGTERM", () => {
  clearInterval(timer);
  console.error("stopped");
  process.exit(0);
});
`);
await fs.writeFile(failScript, `
console.error("intentional failure");
process.exit(7);
`);
await fs.writeFile(flakyScript, `
import { existsSync, writeFileSync } from "node:fs";
const marker = process.argv[2];
if (!existsSync(marker)) {
  writeFileSync(marker, "failed");
  console.error("first launch failed");
  process.exit(9);
}
console.log("restart succeeded");
const timer = setInterval(() => console.log("running"), 100);
process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
`);
await fs.writeFile(stubbornScript, `
console.log("ignoring sigterm");
process.on("SIGTERM", () => {
  console.error("ignored sigterm");
});
setInterval(() => console.log("still running"), 100);
`);
await fs.writeFile(cleanRestartScript, `
import { existsSync, writeFileSync } from "node:fs";
const marker = process.argv[2];
if (!existsSync(marker)) {
  writeFileSync(marker, "exited");
  console.log("first launch complete");
  process.exit(0);
}
console.log("clean restart succeeded");
const timer = setInterval(() => console.log("running"), 100);
process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
`);

const baseSettings: Settings = {
  serverPort: 0,
  libraryPaths: [root],
  smootherCommand: process.execPath,
  smootherArgs: [okScript, "-i", "{file}", "-o", "{target}"],
  metadataProbeCommand: "ffprobe",
  metadataProbeArgs: ["{file}"],
  mediaInfoCommand: "mediainfo",
  collectionsDir: path.join(root, "collections"),
  cacheDir: path.join(root, "cache"),
  logsDir: path.join(root, "logs"),
  defaultLoop: true,
  defaultAutoRestart: false
};

const entry = (patch: Partial<CollectionPlayout> = {}): CollectionPlayout => ({
  id: randomUUID(),
  label: "test",
  filePath: source,
  target: "udp://239.1.1.1:5000",
  loop: true,
  autoRestart: false,
  enabled: true,
  ...patch
});

const librarySource: LibraryFile = {
  id: "current-library-id",
  path: source,
  filename: path.basename(source),
  size: 6,
  modifiedAt: new Date().toISOString(),
  extension: ".ts",
  metadataStatus: "probed",
  metadata: {}
};

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function waitForState(instance: PlayoutInstance, state: PlayoutInstance["state"]): Promise<void> {
  await waitFor(() => instance.state === state, `state ${state}`);
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const command = supervisor.renderCommand(source, "udp://239.1.1.1:5000");
  assert.deepEqual(command, [process.execPath, okScript, "-i", source, "-o", "udp://239.1.1.1:5000"]);
  assert.throws(() => supervisor.validateCommand([process.execPath, okScript, "-i", source], source, "udp://239.1.1.1:5000"), /target URL/);
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const started = await supervisor.start(entry());
  assert.equal(started.state, "running");
  assert.ok(started.pid);
  assert.ok(started.logPath?.endsWith(".log"));
  await waitFor(() => started.recentLogs.some((line) => line.includes("tick")), "log capture");
  await supervisor.stop(started.id);
  await waitForState(started, "exited");
  assert.equal(started.exitCode, 0);
  assert.equal(supervisor.clearCompleted(), 1);
  assert.equal(supervisor.list().length, 0);
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const first = await supervisor.start(entry({ target: "udp://239.1.1.1:5001" }));
  const second = await supervisor.start(entry({ target: "udp://239.1.1.1:5002" }));
  await supervisor.shutdown();
  await waitForState(first, "exited");
  await waitForState(second, "exited");
  assert.equal(first.signal, "SIGTERM");
  assert.equal(second.signal, "SIGTERM");
  supervisor.clearCompleted();
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const collectionEntry = entry();
  const collection: Collection = {
    name: "Current Collection",
    description: "",
    startupOnBoot: false,
    playouts: [collectionEntry],
    updatedAt: new Date().toISOString()
  };
  const [started] = await supervisor.startCollection(collection);
  assert.equal(started.state, "running");
  const stopped = await supervisor.stopCollection({ ...collection, name: "Current Collection Edited" });
  assert.equal(stopped, 1);
  await waitForState(started, "exited");
  supervisor.clearCompleted();
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => [librarySource]);
  const started = await supervisor.start(entry({ fileId: "stale-library-id", filePath: undefined, label: path.basename(source) }));
  assert.equal(started.filePath, source);
  await supervisor.stop(started.id);
  await waitForState(started, "exited");
  supervisor.clearCompleted();
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const collectionEntry = entry();
  const collection: Collection = {
    name: "Delete Me",
    description: "",
    startupOnBoot: false,
    playouts: [collectionEntry],
    updatedAt: new Date().toISOString()
  };
  const [started] = await supervisor.startCollection(collection);
  await waitForState(started, "running");
  const deleted = await supervisor.deleteCollectionInstances(collection.name);
  assert.equal(deleted, 1);
  assert.equal(supervisor.list().length, 0);
  assert.equal(started.state, "exited");
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const first = await supervisor.start(entry());
  const restarted = await supervisor.restart(first.id);
  assert.equal(restarted.id, first.id);
  assert.equal(restarted.restartCount, 1);
  assert.equal(supervisor.list().length, 1);
  await supervisor.stop(restarted.id);
  await waitForState(restarted, "exited");
  const restartedAgain = await supervisor.restart(restarted.id);
  assert.equal(restartedAgain.id, restarted.id);
  assert.equal(restartedAgain.restartCount, 2);
  assert.equal(supervisor.list().length, 1);
  await supervisor.stop(restartedAgain.id);
  await waitForState(restartedAgain, "exited");
  supervisor.clearCompleted();
}

{
  const supervisor = new PlayoutSupervisor({ ...baseSettings, smootherArgs: [failScript, "-i", "{file}", "-o", "{target}"] }, new EventBus(), () => []);
  const failed = await supervisor.start(entry());
  await waitForState(failed, "failed");
  assert.match(failed.failureReason ?? "", /Exited with code 7/);
  assert.ok(failed.recentLogs.some((line) => line.includes("intentional failure")));
  assert.equal(supervisor.delete(failed.id).id, failed.id);
  assert.equal(supervisor.delete(failed.id), undefined);
  assert.equal(supervisor.list().length, 0);
}

{
  const supervisor = new PlayoutSupervisor(baseSettings, new EventBus(), () => []);
  const started = await supervisor.start(entry());
  assert.throws(() => supervisor.delete(started.id), /completed playout/);
  await supervisor.stop(started.id);
  await waitForState(started, "exited");
  supervisor.clearCompleted();
}

{
  const marker = path.join(root, "flaky-marker");
  const supervisor = new PlayoutSupervisor({ ...baseSettings, smootherArgs: [flakyScript, marker, "-i", "{file}", "-o", "{target}"] }, new EventBus(), () => []);
  const restarted = await supervisor.start(entry({ autoRestart: true }));
  await waitFor(() => restarted.restartCount > 0, "auto restart");
  await waitForState(restarted, "running");
  assert.equal(restarted.autoRestart, true);
  assert.equal(restarted.loop, true);
  await supervisor.stop(restarted.id);
  await waitForState(restarted, "exited");
}

{
  const marker = path.join(root, "clean-restart-marker");
  const supervisor = new PlayoutSupervisor({ ...baseSettings, smootherArgs: [cleanRestartScript, marker, "-i", "{file}", "-o", "{target}"] }, new EventBus(), () => []);
  const restarted = await supervisor.start(entry({ autoRestart: false, loop: true }));
  await waitFor(() => restarted.restartCount > 0, "clean loop restart");
  await waitForState(restarted, "running");
  await supervisor.stop(restarted.id);
  await waitForState(restarted, "exited");
}

{
  const supervisor = new PlayoutSupervisor({ ...baseSettings, smootherArgs: [failScript, "-i", "{file}", "-o", "{target}"] }, new EventBus(), () => []);
  const failed = await supervisor.start(entry({ autoRestart: false, loop: true }));
  await waitForState(failed, "failed");
  assert.equal(failed.restartCount, 0);
  supervisor.clearCompleted();
}

{
  const supervisor = new PlayoutSupervisor({ ...baseSettings, smootherArgs: [stubbornScript, "-i", "{file}", "-o", "{target}"] }, new EventBus(), () => []);
  const stubborn = await supervisor.start(entry());
  await waitFor(() => stubborn.recentLogs.some((line) => line.includes("still running")), "stubborn startup");
  await supervisor.stop(stubborn.id);
  await waitForState(stubborn, "exited");
  assert.equal(stubborn.signal, "SIGKILL");
  assert.ok(stubborn.recentLogs.some((line) => line.includes("SIGKILL")));
}

console.log("playout supervisor integration tests passed");
