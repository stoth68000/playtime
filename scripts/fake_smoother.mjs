#!/usr/bin/env node

const args = process.argv.slice(2);
const valueAfter = (...names) => {
  const index = args.findIndex((arg) => names.includes(arg));
  return index >= 0 ? args[index + 1] : undefined;
};
const input = valueAfter("--input", "-i") ?? "unknown";
const output = valueAfter("--output", "-o") ?? "unknown";

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
