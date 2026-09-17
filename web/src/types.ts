export type PlayoutState = "starting" | "running" | "stopping" | "exited" | "failed" | "restarting";

export interface Settings {
  serverPort: number;
  libraryPaths: string[];
  smootherCommand: string;
  smootherArgs: string[];
  collectionsDir: string;
  cacheDir: string;
  logsDir: string;
  defaultLoop: boolean;
  defaultAutoRestart: boolean;
}

export interface LibraryFile {
  id: string;
  path: string;
  filename: string;
  size: number;
  modifiedAt: string;
  extension: string;
  metadataStatus: string;
  metadata: { bitrate?: number; duration?: number; packetSize?: number; notes?: string[] };
}

export interface CollectionPlayout {
  id: string;
  label: string;
  fileId?: string;
  filePath?: string;
  target: string;
  loop: boolean;
  autoRestart: boolean;
  enabled: boolean;
}

export interface Collection {
  name: string;
  description: string;
  playouts: CollectionPlayout[];
  updatedAt: string;
}

export interface PlayoutInstance {
  id: string;
  collectionName?: string;
  entryId?: string;
  label: string;
  filePath: string;
  target: string;
  state: PlayoutState;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  restartCount: number;
  command: string[];
  recentLogs: string[];
}

export interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  at: string;
  payload?: unknown;
}
