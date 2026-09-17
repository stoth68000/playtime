#!/usr/bin/env node

const args = process.argv.slice(2);
const input = args[args.findIndex((arg) => arg === "--input") + 1] ?? "unknown";
const output = args[args.findIndex((arg) => arg === "--output") + 1] ?? "unknown";

console.log(`fake smoother starting input=${input} output=${output}`);

let packets = 0;
const timer = setInterval(() => {
  packets += 188 * 100;
  console.log(`played=${packets} bytes target=${output}`);
}, 1000);

process.on("SIGTERM", () => {
  clearInterval(timer);
  console.log("fake smoother stopped");
  process.exit(0);
});
