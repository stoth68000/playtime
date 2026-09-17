import type { Collection, CollectionPlayout, LibraryFile, PlayoutInstance, Settings, ActivityEvent } from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers;
  const response = await fetch(url, {
    ...init,
    headers
  });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; warnings: string[] }>("/api/health"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Settings) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  files: () => request<LibraryFile[]>("/api/library/files"),
  probeOutput: (id: string) => request<{ output: string }>(`/api/library/files/${encodeURIComponent(id)}/probe-output`),
  rescan: () => request<LibraryFile[]>("/api/library/rescan", { method: "POST" }),
  collections: () => request<Collection[]>("/api/collections"),
  saveCollection: (collection: Collection) => request<Collection>("/api/collections", { method: "POST", body: JSON.stringify(collection) }),
  deleteCollection: (name: string) => request<{ ok: boolean }>(`/api/collections/${encodeURIComponent(name)}`, { method: "DELETE" }),
  playouts: () => request<PlayoutInstance[]>("/api/playouts"),
  startPlayout: (playout: CollectionPlayout) => request<PlayoutInstance>("/api/playouts", { method: "POST", body: JSON.stringify(playout) }),
  startCollection: (collection: Collection) => request<PlayoutInstance[]>("/api/playouts/collection", { method: "POST", body: JSON.stringify(collection) }),
  stopCollection: (collection: Collection) => request<{ stopped: number }>("/api/playouts/collection/stop", { method: "POST", body: JSON.stringify(collection) }),
  deletePlayout: (id: string) => request<{ ok: boolean }>(`/api/playouts/${id}`, { method: "DELETE" }),
  stopPlayout: (id: string) => request<PlayoutInstance>(`/api/playouts/${id}/stop`, { method: "POST" }),
  restartPlayout: (id: string) => request<PlayoutInstance>(`/api/playouts/${id}/restart`, { method: "POST" }),
  clearCompletedPlayouts: () => request<{ cleared: number }>("/api/playouts/clear-completed", { method: "POST" }),
  activity: () => request<ActivityEvent[]>("/api/activity")
};
