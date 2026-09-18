import path from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { SettingsStore } from "./settings/store.js";
import { EventBus } from "./events/eventBus.js";
import { LibraryScanner } from "./library/scanner.js";
import { CollectionStore } from "./collections/store.js";
import { PlayoutSupervisor } from "./playout/supervisor.js";
import { registerRoutes } from "./api/routes.js";
import { TrafficMonitor } from "./traffic/monitor.js";
import { gitVersion } from "./util/version.js";

const app = Fastify({ logger: true });
const settingsStore = new SettingsStore();
let settings = await settingsStore.load();
const events = new EventBus();
const library = new LibraryScanner(settings, events);
const collections = new CollectionStore(settings, events);
const playouts = new PlayoutSupervisor(settings, events, () => library.list());
const traffic = new TrafficMonitor();
const version = await gitVersion();
let shuttingDown = false;
const startupOnBootDelayMs = 3000;

async function shutdown(signal?: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (signal) app.log.info({ signal }, "Shutting down PlayTime");
  await app.close();
}

app.addHook("onClose", async () => {
  await playouts.shutdown();
});

await library.loadCache();
void library.scan();

await app.register(cors, { origin: true });
await registerRoutes(app, {
  settingsStore,
  getSettings: () => settings,
  gitVersion: version,
  setSettings: (next) => {
    settings = next;
  },
  library,
  collections,
  playouts,
  traffic,
  events
});

const webDist = path.resolve(process.cwd(), "dist/web");
if (existsSync(webDist)) {
  await app.register(staticFiles, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const warnings = settingsStore.validateRuntime(settings);
for (const warning of warnings) app.log.warn(warning);

await app.listen({ port: settings.serverPort, host: "127.0.0.1" });

setTimeout(() => {
  void startBootCollections();
}, startupOnBootDelayMs);

async function startBootCollections(): Promise<void> {
  if (shuttingDown) return;
  const bootCollections = (await collections.list()).filter((collection) => collection.startupOnBoot);
  for (const collection of bootCollections) {
    try {
      const started = await playouts.startCollection(collection);
      events.emit("collection.startup_on_boot", `Started ${collection.name} on boot`, { name: collection.name, started: started.length });
    } catch (error) {
      app.log.error({ err: error, collection: collection.name }, "Startup on Boot collection failed");
      events.emit("collection.startup_on_boot_failed", `Startup on Boot failed: ${collection.name}`, { name: collection.name, error: (error as Error).message });
    }
  }
}

process.once("SIGINT", (signal) => {
  void shutdown(signal).then(() => process.exit(0), (error) => {
    app.log.error(error);
    process.exit(1);
  });
});
process.once("SIGTERM", (signal) => {
  void shutdown(signal).then(() => process.exit(0), (error) => {
    app.log.error(error);
    process.exit(1);
  });
});
