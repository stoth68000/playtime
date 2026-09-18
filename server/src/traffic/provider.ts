export interface TrafficSample {
  name: string;
  addresses: string[];
  txBytes: number;
  speedBitsPerSecond?: number;
  status?: string;
  errors?: string[];
}

export interface TrafficProvider {
  samples(): Promise<TrafficSample[]>;
}
