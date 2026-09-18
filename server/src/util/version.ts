import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gitVersion(): Promise<string> {
  try {
    const [{ stdout: revision }, dirty] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"]),
      isGitDirty()
    ]);
    return `${revision.trim()}${dirty ? "-dirty" : ""}`;
  } catch {
    return "unknown";
  }
}

async function isGitDirty(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
