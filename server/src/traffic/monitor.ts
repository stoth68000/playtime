import os from "node:os";
import type { TrafficInterface } from "../models.js";
import { LinuxTrafficProvider } from "./linux.js";
import { MacOSTrafficProvider } from "./macos.js";
import type { TrafficProvider, TrafficSample } from "./provider.js";

interface PreviousSample {
  txBytes: number;
  sampledAt: number;
}

export class TrafficMonitor {
  private previous = new Map<string, PreviousSample>();

  constructor(private provider: TrafficProvider = createTrafficProvider()) {}

  async interfaces(): Promise<TrafficInterface[]> {
    const sampledAt = Date.now();
    const samples = await this.provider.samples();
    return samples.map((sample) => this.toInterface(sample, sampledAt));
  }

  private toInterface(sample: TrafficSample, sampledAt: number): TrafficInterface {
    const previous = this.previous.get(sample.name);
    this.previous.set(sample.name, { txBytes: sample.txBytes, sampledAt });
    const elapsedSeconds = previous ? (sampledAt - previous.sampledAt) / 1000 : 0;
    const byteDelta = previous ? Math.max(0, sample.txBytes - previous.txBytes) : 0;
    const txBitsPerSecond = elapsedSeconds > 0 ? (byteDelta * 8) / elapsedSeconds : 0;
    const capacityKnown = Boolean(sample.speedBitsPerSecond && sample.speedBitsPerSecond > 0);
    const availableBitsPerSecond = capacityKnown ? Math.max(0, (sample.speedBitsPerSecond ?? 0) - txBitsPerSecond) : undefined;
    const usagePercent = capacityKnown ? Math.min(999, (txBitsPerSecond / (sample.speedBitsPerSecond ?? 1)) * 100) : undefined;
    return {
      name: sample.name,
      addresses: sample.addresses,
      txBitsPerSecond,
      speedBitsPerSecond: sample.speedBitsPerSecond,
      availableBitsPerSecond,
      usagePercent,
      capacityKnown,
      status: sample.status,
      errors: sample.errors
    };
  }
}

function createTrafficProvider(): TrafficProvider {
  if (process.platform === "linux") return new LinuxTrafficProvider();
  if (process.platform === "darwin") return new MacOSTrafficProvider();
  return {
    async samples() {
      return Object.keys(os.networkInterfaces()).sort().map((name) => ({
        name,
        addresses: (os.networkInterfaces()[name] ?? []).map((item) => item.address),
        txBytes: 0,
        errors: [`Traffic counters are not implemented for ${process.platform}`]
      }));
    }
  };
}
