import type { FastifyInstance } from "fastify";
import type { Collection, CollectionPlayout, Settings } from "../models.js";
import { SettingsStore } from "../settings/store.js";
import { LibraryScanner } from "../library/scanner.js";
import { CollectionStore } from "../collections/store.js";
import { PlayoutSupervisor } from "../playout/supervisor.js";
import { EventBus } from "../events/eventBus.js";

export interface AppServices {
  settingsStore: SettingsStore;
  getSettings: () => Settings;
  setSettings: (settings: Settings) => void;
  library: LibraryScanner;
  collections: CollectionStore;
  playouts: PlayoutSupervisor;
  events: EventBus;
}

export async function registerRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, warnings: services.settingsStore.validateRuntime(services.getSettings()) }));
  app.get("/api/settings", async () => services.getSettings());
  app.put<{ Body: Settings }>("/api/settings", async (request) => {
    const settings = await services.settingsStore.save(request.body);
    services.setSettings(settings);
    services.library.updateSettings(settings);
    services.collections.updateSettings(settings);
    services.playouts.updateSettings(settings);
    services.events.emit("settings.updated", "Settings updated");
    return settings;
  });

  app.get("/api/library/files", async () => services.library.list());
  app.get<{ Params: { id: string } }>("/api/library/files/:id", async (request, reply) => {
    const file = services.library.get(request.params.id);
    if (!file) return reply.code(404).send({ error: "File not found" });
    return file;
  });
  app.post("/api/library/rescan", async () => services.library.scan());

  app.get("/api/collections", async () => services.collections.list());
  app.post<{ Body: Collection }>("/api/collections", async (request) => services.collections.save(request.body));
  app.get<{ Params: { name: string } }>("/api/collections/:name", async (request, reply) => {
    const collection = await services.collections.get(request.params.name);
    if (!collection) return reply.code(404).send({ error: "Collection not found" });
    return collection;
  });
  app.put<{ Params: { name: string }; Body: Collection }>("/api/collections/:name", async (request) => {
    return services.collections.save({ ...request.body, name: request.params.name });
  });
  app.delete<{ Params: { name: string } }>("/api/collections/:name", async (request) => {
    await services.collections.delete(request.params.name);
    return { ok: true };
  });

  app.get("/api/playouts", async () => services.playouts.list());
  app.post<{ Body: CollectionPlayout }>("/api/playouts", async (request) => services.playouts.start(request.body));
  app.post<{ Body: Collection }>("/api/playouts/collection", async (request) => services.playouts.startCollection(request.body));
  app.post<{ Body: Collection }>("/api/playouts/collection/stop", async (request) => ({ stopped: await services.playouts.stopCollection(request.body) }));
  app.post("/api/playouts/clear-completed", async () => ({ cleared: services.playouts.clearCompleted() }));
  app.get<{ Params: { id: string } }>("/api/playouts/:id", async (request, reply) => {
    const playout = services.playouts.get(request.params.id);
    if (!playout) return reply.code(404).send({ error: "Playout not found" });
    return playout;
  });
  app.delete<{ Params: { id: string } }>("/api/playouts/:id", async (request) => services.playouts.delete(request.params.id));
  app.post<{ Params: { id: string } }>("/api/playouts/:id/stop", async (request) => services.playouts.stop(request.params.id));
  app.post<{ Params: { id: string } }>("/api/playouts/:id/restart", async (request) => services.playouts.restart(request.params.id));

  app.get("/api/activity", async () => services.events.listActivity());
  app.get("/api/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const unsubscribe = services.events.subscribe((event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", unsubscribe);
  });
}
