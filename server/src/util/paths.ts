import path from "node:path";

export const rootDir = process.cwd();

export function resolveAppPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

export function safeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
