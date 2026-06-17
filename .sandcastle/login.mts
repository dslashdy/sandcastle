import { spawnSync } from "node:child_process";
import {
  defaultImageName,
  defaultPersistentHomeVolumeName,
} from "@ai-hero/sandcastle/sandboxes/docker";

const imageName =
  process.env.SANDCASTLE_IMAGE ?? defaultImageName(process.cwd());
const volumeName =
  process.env.SANDCASTLE_AGENT_HOME_VOLUME ??
  defaultPersistentHomeVolumeName(imageName);

const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

const commands = {
  claude: ["claude", "login"],
  codex: ["codex", "login", "--device-auth"],
} as const;

const requested = process.argv.slice(2);
const targets =
  requested.length > 0
    ? requested
    : (Object.keys(commands) as Array<keyof typeof commands>);

for (const target of targets) {
  if (!(target in commands)) {
    console.error(
      `Unknown login target "${target}". Use "claude", "codex", or no arg for both.`,
    );
    process.exitCode = 1;
    continue;
  }

  const [entrypoint, ...args] = commands[target as keyof typeof commands];
  console.log(`\n=== ${target} login for ${imageName} ===\n`);

  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      process.stdin.isTTY ? "-it" : "-i",
      "--user",
      `${uid}:${gid}`,
      "-e",
      "HOME=/home/agent",
      "-v",
      `${volumeName}:/home/agent`,
      "-w",
      "/home/agent",
      "--entrypoint",
      entrypoint,
      imageName,
      ...args,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    break;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
