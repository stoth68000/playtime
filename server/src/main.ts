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

const app = Fastify({ logger: true });
const settingsStore = new SettingsStore();
let settings = await settingsStore.load();
const events = new EventBus();
const library = new LibraryScanner(settings, events);
const collections = new CollectionStore(settings, events);
const playouts = new PlayoutSupervisor(settings, events, (id) => library.get(id));

await library.loadCache();
void library.scan();

await app.register(cors, { origin: true });
await registerRoutes(app, {
  settingsStore,
  getSettings: () => settings,
  setSettings: (next) => {
    settings = next;
  },
  library,
  collections,
  playouts,
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
