import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  app.get("/docs", async (_request, reply) => {
    return reply.type("text/html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PlayTime API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      :root {
        color-scheme: dark;
        --bg: #101418;
        --panel: #171d23;
        --panel-2: #202832;
        --line: #303a45;
        --text: #e7edf4;
        --muted: #9aa7b6;
        --accent: #4fb3c4;
      }
      body {
        margin: 0;
        background: var(--bg);
      }
      .swagger-ui {
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .swagger-ui .topbar { display: none; }
      .swagger-ui .wrapper {
        max-width: none;
        padding: 0 32px;
      }
      .swagger-ui .info {
        margin: 24px 0 18px;
      }
      .swagger-ui .info .title,
      .swagger-ui .info p,
      .swagger-ui .info li,
      .swagger-ui .opblock-tag,
      .swagger-ui .opblock .opblock-summary-description,
      .swagger-ui table thead tr td,
      .swagger-ui table thead tr th,
      .swagger-ui .parameter__name,
      .swagger-ui .parameter__type,
      .swagger-ui .response-col_status,
      .swagger-ui .response-col_description__inner div,
      .swagger-ui .model,
      .swagger-ui .model-title,
      .swagger-ui .model-box,
      .swagger-ui .model-toggle,
      .swagger-ui .tab li,
      .swagger-ui label,
      .swagger-ui h1,
      .swagger-ui h2,
      .swagger-ui h3,
      .swagger-ui h4,
      .swagger-ui h5 {
        color: var(--text);
      }
      .swagger-ui .info .title small,
      .swagger-ui .info .base-url,
      .swagger-ui .scheme-container,
      .swagger-ui .opblock-tag small,
      .swagger-ui .parameter__deprecated,
      .swagger-ui .parameter__in,
      .swagger-ui .property.primitive,
      .swagger-ui .prop-type,
      .swagger-ui .model .prop .prop-format {
        color: var(--muted);
      }
      .swagger-ui .scheme-container,
      .swagger-ui .opblock,
      .swagger-ui .model-box,
      .swagger-ui section.models {
        background: var(--panel);
        border: 1px solid var(--line);
        box-shadow: none;
      }
      .swagger-ui .opblock {
        border-radius: 6px;
      }
      .swagger-ui .opblock .opblock-summary {
        border-color: var(--line);
      }
      .swagger-ui .opblock .opblock-section-header {
        background: var(--panel-2);
        box-shadow: none;
      }
      .swagger-ui .opblock .opblock-summary-path,
      .swagger-ui .opblock .opblock-summary-path__deprecated,
      .swagger-ui .opblock .opblock-summary-operation-id,
      .swagger-ui .responses-inner h4,
      .swagger-ui .responses-inner h5,
      .swagger-ui .execute-wrapper .btn,
      .swagger-ui .btn {
        color: var(--text);
      }
      .swagger-ui .opblock.opblock-get { border-color: #3c7d8a; background: rgba(79, 179, 196, 0.08); }
      .swagger-ui .opblock.opblock-post { border-color: #598c62; background: rgba(95, 170, 112, 0.08); }
      .swagger-ui .opblock.opblock-put { border-color: #a98a42; background: rgba(197, 157, 74, 0.08); }
      .swagger-ui .opblock.opblock-delete { border-color: #9b4d59; background: rgba(188, 80, 94, 0.08); }
      .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #287d8f; }
      .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #347447; }
      .swagger-ui .opblock.opblock-put .opblock-summary-method { background: #92712d; }
      .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #8b3946; }
      .swagger-ui input,
      .swagger-ui textarea,
      .swagger-ui select {
        background: #0b0f14;
        border: 1px solid var(--line);
        color: var(--text);
      }
      .swagger-ui .microlight,
      .swagger-ui .highlight-code {
        background: #0b0f14 !important;
        color: #dce6ef !important;
      }
      .swagger-ui .btn,
      .swagger-ui .try-out__btn,
      .swagger-ui .execute {
        background: var(--panel-2);
        border-color: #50616f;
        box-shadow: none;
      }
      .swagger-ui .btn:hover,
      .swagger-ui .try-out__btn:hover,
      .swagger-ui .execute:hover {
        border-color: var(--accent);
        box-shadow: none;
      }
      .swagger-ui a,
      .swagger-ui .opblock-summary-control:focus {
        color: var(--accent);
      }
      .swagger-ui svg,
      .swagger-ui .model-toggle::after {
        filter: invert(1) hue-rotate(180deg);
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener("load", () => {
        window.ui = SwaggerUIBundle({
          url: "/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          layout: "BaseLayout"
        });
      });
    </script>
  </body>
</html>`);
  });

  app.get("/openapi.json", async (_request, reply) => {
    const spec = await readFile(path.resolve(process.cwd(), "openapi.json"), "utf8");
    return reply.type("application/json").send(spec);
  });

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
  app.get<{ Params: { id: string } }>("/api/library/files/:id/thumbnail", async (request, reply) => {
    const thumbnailPath = await services.library.thumbnailPath(request.params.id);
    if (!thumbnailPath) return reply.code(404).send({ error: "Thumbnail not found" });
    return reply.type("image/jpeg").send(createReadStream(thumbnailPath));
  });
  app.get<{ Params: { id: string } }>("/api/library/files/:id/probe-output", async (request, reply) => {
    const output = await services.library.probeOutput(request.params.id);
    if (!output) return reply.code(404).send({ error: "File not found" });
    return { output };
  });
  app.get<{ Params: { id: string } }>("/api/library/files/:id/mediainfo-output", async (request, reply) => {
    const output = await services.library.mediaInfoOutput(request.params.id);
    if (!output) return reply.code(404).send({ error: "File not found" });
    return { output };
  });
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
    await services.playouts.deleteCollectionInstances(request.params.name);
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
  app.delete<{ Params: { id: string } }>("/api/playouts/:id", async (request) => {
    services.playouts.delete(request.params.id);
    return { ok: true };
  });
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
