export type PlayoutState = "starting" | "running" | "stopping" | "exited" | "failed" | "restarting";

export interface Settings {
  serverPort: number;
  libraryPaths: string[];
  smootherCommand: string;
  smootherArgs: string[];
  metadataProbeCommand: string;
  metadataProbeArgs: string[];
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
  metadataStatus: "pending" | "basic" | "probed" | "failed";
  metadata: FileMetadata;
}

export interface FileMetadata {
  duration?: number;
  bitrate?: number;
  packetSize?: number;
  formatName?: string;
  probeScore?: number;
  programCount?: number;
  transportType?: "SPTS" | "MPTS";
  programs?: ProgramMetadata[];
  videoStreams?: StreamMetadata[];
  audioStreams?: StreamMetadata[];
  otherStreams?: StreamMetadata[];
  codecs?: string[];
  serviceNames?: string[];
  thumbnailPath?: string;
  errors?: string[];
  notes?: string[];
}

export interface ProgramMetadata {
  programId?: number;
  programNumber?: number;
  pmtPid?: number;
  pcrPid?: number;
  serviceName?: string;
  serviceProvider?: string;
  streamIndexes: number[];
}

export interface StreamMetadata {
  index: number;
  pid?: string;
  type?: string;
  codec?: string;
  profile?: string;
  language?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  fieldOrder?: string;
  channels?: number;
  channelLayout?: string;
  sampleRate?: number;
  bitrate?: number;
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
  signal?: NodeJS.Signals | null;
  restartCount: number;
  command: string[];
  logPath?: string;
  failureReason?: string;
  recentLogs: string[];
}

export interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  at: string;
  payload?: unknown;
}
