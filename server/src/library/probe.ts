import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileMetadata, ProgramMetadata, Settings, StreamMetadata } from "../models.js";
import { resolveAppPath } from "../util/paths.js";

const execFileAsync = promisify(execFile);

interface FfprobeOutput {
  programs?: FfprobeProgram[];
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    probe_score?: number;
    nb_programs?: number;
  };
}

interface FfprobeProgram {
  program_id?: number;
  program_num?: number;
  pmt_pid?: number;
  pcr_pid?: number;
  tags?: {
    service_name?: string;
    service_provider?: string;
  };
  streams?: FfprobeStream[];
}

interface FfprobeStream {
  index?: number;
  id?: string;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  field_order?: string;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bit_rate?: string;
  ts_packetsize?: string;
  tags?: {
    language?: string;
  };
}

export async function probeTransportStream(filePath: string, settings: Settings): Promise<FileMetadata> {
  const command = settings.metadataProbeCommand.includes("/") ? resolveAppPath(settings.metadataProbeCommand) : settings.metadataProbeCommand;
  const args = settings.metadataProbeArgs.map((arg) => arg.replaceAll("{file}", filePath));

  try {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    return normalize(JSON.parse(stdout) as FfprobeOutput, filePath);
  } catch (error) {
    return {
      errors: [(error as Error).message],
      notes: ["Metadata probe failed"]
    };
  }
}

function normalize(data: FfprobeOutput, filePath: string): FileMetadata {
  const streams = data.streams ?? [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video").map(normalizeStream);
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio").map(normalizeStream);
  const otherStreams = streams.filter((stream) => stream.codec_type !== "video" && stream.codec_type !== "audio").map(normalizeStream);
  const programs = (data.programs ?? []).map(normalizeProgram);
  const packetSize = firstNumber(streams.map((stream) => stream.ts_packetsize));
  const codecs = unique(streams.map((stream) => stream.codec_name).filter(Boolean) as string[]);
  const serviceNames = unique(programs.map((program) => program.serviceName).filter(Boolean) as string[]);

  return {
    duration: parseNumber(data.format?.duration),
    bitrate: parseNumber(data.format?.bit_rate),
    packetSize,
    formatName: data.format?.format_name,
    probeScore: data.format?.probe_score,
    programCount: data.format?.nb_programs ?? programs.length,
    programs,
    videoStreams,
    audioStreams,
    otherStreams,
    codecs,
    serviceNames,
    notes: [`Probed with ffprobe: ${filePath}`]
  };
}

function normalizeProgram(program: FfprobeProgram): ProgramMetadata {
  return {
    programId: program.program_id,
    programNumber: program.program_num,
    pmtPid: program.pmt_pid,
    pcrPid: program.pcr_pid,
    serviceName: program.tags?.service_name,
    serviceProvider: program.tags?.service_provider,
    streamIndexes: (program.streams ?? []).map((stream) => stream.index).filter((index): index is number => typeof index === "number")
  };
}

function normalizeStream(stream: FfprobeStream): StreamMetadata {
  return {
    index: stream.index ?? -1,
    pid: stream.id,
    type: stream.codec_type,
    codec: stream.codec_name,
    profile: stream.profile,
    language: stream.tags?.language,
    width: stream.width,
    height: stream.height,
    frameRate: cleanRate(stream.avg_frame_rate) ?? cleanRate(stream.r_frame_rate),
    fieldOrder: stream.field_order,
    channels: stream.channels,
    channelLayout: stream.channel_layout,
    sampleRate: parseNumber(stream.sample_rate),
    bitrate: parseNumber(stream.bit_rate)
  };
}

function parseNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(values: Array<string | number | undefined>): number | undefined {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function cleanRate(value: string | undefined): string | undefined {
  if (!value || value === "0/0") return undefined;
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
