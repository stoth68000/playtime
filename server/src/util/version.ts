import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gitVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["describe", "--abbrev=8", "--dirty", "--always", "--tags"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}
