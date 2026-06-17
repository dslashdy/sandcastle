import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const initCwd = process.env.INIT_CWD
  ? resolve(process.env.INIT_CWD)
  : undefined;

const shouldInstallHusky =
  process.env.HUSKY !== "0" && existsSync(".git") && initCwd === cwd;

if (!shouldInstallHusky) {
  process.exit(0);
}

const result = spawnSync("husky", { stdio: "inherit", shell: true });

if (result.error) {
  console.warn(`husky install skipped: ${result.error.message}`);
  process.exit(0);
}

if (result.status !== 0) {
  console.warn(`husky install skipped: exited with ${result.status ?? 1}`);
}
