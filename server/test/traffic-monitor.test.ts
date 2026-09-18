import assert from "node:assert/strict";
import { TrafficMonitor } from "../src/traffic/monitor.js";
import { parseIfconfigSpeed, parseNetstat } from "../src/traffic/macos.js";
import type { TrafficProvider, TrafficSample } from "../src/traffic/provider.js";

class FakeProvider implements TrafficProvider {
  private index = 0;

  constructor(private readonly batches: TrafficSample[][]) {}

  async samples(): Promise<TrafficSample[]> {
    return this.batches[Math.min(this.index++, this.batches.length - 1)];
  }
}

const originalNow = Date.now;
let now = 1_000;
Date.now = () => now;

try {
  const monitor = new TrafficMonitor(new FakeProvider([
    [{ name: "eth0", addresses: ["192.0.2.10"], txBytes: 1000, speedBitsPerSecond: 1_000_000_000, status: "up" }],
    [{ name: "eth0", addresses: ["192.0.2.10"], txBytes: 251_000, speedBitsPerSecond: 1_000_000_000, status: "up" }]
  ]));

  const first = await monitor.interfaces();
  assert.equal(first[0].txBitsPerSecond, 0);
  assert.equal(first[0].capacityKnown, true);

  now = 2_000;
  const second = await monitor.interfaces();
  assert.equal(second[0].txBitsPerSecond, 2_000_000);
  assert.equal(second[0].availableBitsPerSecond, 998_000_000);
  assert.equal(second[0].usagePercent, 0.2);
} finally {
  Date.now = originalNow;
}

const addresses = new Map([["en0", ["192.0.2.20"]]]);
const parsed = parseNetstat(`
Name  Mtu   Network       Address            Ipkts Ierrs    Ibytes    Opkts Oerrs    Obytes  Coll
en0   1500  <Link#11>     aa:bb:cc:dd:ee:ff     10     0      2000       20     0      4000     0
en0   1500  192.0.2       192.0.2.20            10     0      2000       20     0      3000     0
lo0   16384 <Link#1>                            100     0     10000      120     0     12000     0
`, addresses, new Map([["en0", 1_000_000_000]]));

assert.equal(parsed.length, 2);
assert.equal(parsed[0].name, "en0");
assert.equal(parsed[0].txBytes, 4000);
assert.equal(parsed[0].addresses[0], "192.0.2.20");
assert.equal(parsed[0].speedBitsPerSecond, 1_000_000_000);

assert.equal(parseIfconfigSpeed("media: autoselect (1000baseT <full-duplex>)"), 1_000_000_000);
assert.equal(parseIfconfigSpeed("media: autoselect (10GbaseT <full-duplex>)"), 10_000_000_000);
assert.equal(parseIfconfigSpeed("status: active"), undefined);

console.log("traffic monitor tests passed");
