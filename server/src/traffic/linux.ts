import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TrafficProvider, TrafficSample } from "./provider.js";

export class LinuxTrafficProvider implements TrafficProvider {
  constructor(private sysClassNet = "/sys/class/net") {}

  async samples(): Promise<TrafficSample[]> {
    const names = await fs.readdir(this.sysClassNet);
    const addresses = interfaceAddresses();
    const samples = await Promise.all(names.map(async (name) => {
      const errors: string[] = [];
      const base = path.join(this.sysClassNet, name);
      const txBytes = await readNumber(path.join(base, "statistics", "tx_bytes"), errors);
      const speedMegabits = await readNumber(path.join(base, "speed"), []);
      const status = await readText(path.join(base, "operstate"));
      const sample: TrafficSample = {
        name,
        addresses: addresses.get(name) ?? [],
        txBytes,
        status
      };
      if (speedMegabits > 0) sample.speedBitsPerSecond = speedMegabits * 1_000_000;
      if (errors.length) sample.errors = errors;
      return sample;
    }));
    return samples.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function interfaceAddresses(): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    output.set(name, (items ?? []).map((item) => item.address));
  }
  return output;
}

async function readNumber(file: string, errors: string[]): Promise<number> {
  try {
    const text = await fs.readFile(file, "utf8");
    const value = Number(text.trim());
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    errors.push(`${path.basename(file)}: ${(error as Error).message}`);
    return 0;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(file, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}
