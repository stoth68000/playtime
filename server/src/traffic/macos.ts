import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { TrafficProvider, TrafficSample } from "./provider.js";

const execFileAsync = promisify(execFile);

export class MacOSTrafficProvider implements TrafficProvider {
  async samples(): Promise<TrafficSample[]> {
    const [{ stdout }, speeds] = await Promise.all([
      execFileAsync("netstat", ["-ibn"], { maxBuffer: 1024 * 1024 }),
      readInterfaceSpeeds()
    ]);
    return parseNetstat(stdout, interfaceAddresses(), speeds);
  }
}

export function parseNetstat(output: string, addresses = interfaceAddresses(), speeds = new Map<string, number>()): TrafficSample[] {
  const byName = new Map<string, TrafficSample>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10 || parts[0] === "Name") continue;
    const name = parts[0];
    const obytes = Number(parts[9]);
    if (!Number.isFinite(obytes)) continue;
    const current = byName.get(name);
    if (!current || obytes > current.txBytes) {
      byName.set(name, {
        name,
        addresses: addresses.get(name) ?? [],
        txBytes: obytes,
        speedBitsPerSecond: speeds.get(name)
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readInterfaceSpeeds(): Promise<Map<string, number>> {
  const speeds = new Map<string, number>();
  const names = Object.keys(os.networkInterfaces());
  await Promise.all(names.map(async (name) => {
    try {
      const { stdout } = await execFileAsync("ifconfig", [name], { maxBuffer: 256 * 1024 });
      const speed = parseIfconfigSpeed(stdout);
      if (speed) speeds.set(name, speed);
    } catch {
      // Interface speed is best-effort on macOS.
    }
  }));
  return speeds;
}

export function parseIfconfigSpeed(output: string): number | undefined {
  const match = output.match(/\((\d+)\s*(baseT|GbaseT|MbaseT|Gb|Mb|Kb|b)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("g")) return value * 1_000_000_000;
  if (unit.startsWith("m") || unit === "baset") return value * 1_000_000;
  if (unit.startsWith("k")) return value * 1_000;
  return value;
}

function interfaceAddresses(): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    output.set(name, (items ?? []).map((item) => item.address));
  }
  return output;
}
