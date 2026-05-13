/**
 * SBX sandbox provider — creates SBX shell sandboxes with direct workspace mounts.
 *
 * Usage:
 *   import { sbx } from "sandcastle/sandboxes/sbx";
 *   await run({ agent: claudeCode("claude-opus-4-7"), sandbox: sbx() });
 */

import {
  execFile,
  execFileSync,
  spawn,
  type StdioOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  createBindMountSandboxProvider,
  type BindMountCreateOptions,
  type BindMountSandboxHandle,
  type ExecResult,
  type InteractiveExecOptions,
  type SandboxProvider,
} from "../SandboxProvider.js";
import { resolveHostPath } from "../mountUtils.js";

export interface SbxWorkspace {
  /**
   * Host directory to mount into the SBX sandbox.
   *
   * SBX mounts workspaces at the same absolute path inside the sandbox. Unlike
   * Docker/Podman mounts, this cannot remap to a different sandbox path.
   */
  readonly path: string;
  /** Mount the workspace read-only. */
  readonly readonly?: boolean;
}

export interface SbxOptions {
  /** SBX binary to execute (default: "sbx"). */
  readonly command?: string;
  /**
   * SBX agent sandbox type to create (default: "shell").
   *
   * Use `"claude"` when you want SBX's Claude Code image/auth integration,
   * for example when running Claude Code with a Claude Max subscription
   * instead of an Anthropic API key.
   */
  readonly agent?: string;
  /**
   * Exact SBX sandbox name. When omitted, a unique sandcastle-* name is used.
   *
   * Use this only when creating one sandbox at a time; SBX names must be unique.
   */
  readonly name?: string;
  /** SBX template passed to `sbx create --template`. */
  readonly template?: string;
  /** SBX kits passed to `sbx create --kit`. */
  readonly kits?: readonly string[];
  /** CPU count passed to `sbx create --cpus`. */
  readonly cpus?: number;
  /** Memory limit passed to `sbx create --memory` (for example, "4gb"). */
  readonly memory?: string;
  /**
   * Additional host directories to mount as SBX workspaces.
   *
   * These are direct same-path mounts. SBX does not support a separate
   * sandboxPath, so use Docker or Podman if path remapping is required.
   */
  readonly workspaces?: readonly SbxWorkspace[];
  /** Environment variables injected by this provider. Merged at launch time with env resolver and agent provider env. */
  readonly env?: Record<string, string>;
}

interface ResolvedSbxWorkspace {
  readonly path: string;
  readonly readonly?: boolean;
}

const SBX_NAME_RE = /^[A-Za-z0-9.+-]+$/;

/**
 * Create an SBX sandbox provider.
 *
 * The returned provider creates `sbx create shell` sandboxes. SBX mounts the
 * Sandcastle worktree at the same absolute host path inside the sandbox, so
 * `handle.worktreePath` is the host worktree path instead of
 * `/home/agent/workspace`.
 */
export const sbx = (options?: SbxOptions): SandboxProvider => {
  const sbxCommand = options?.command ?? "sbx";
  const configuredWorkspaces = options?.workspaces?.map(resolveWorkspace) ?? [];

  if (options?.name) {
    assertValidSandboxName(options.name);
  }

  return createBindMountSandboxProvider({
    name: "sbx",
    env: options?.env,
    sandboxHomedir: "/home/agent",
    create: async (
      createOptions: BindMountCreateOptions,
    ): Promise<BindMountSandboxHandle> => {
      const sandboxName = options?.name ?? `sandcastle-${randomUUID()}`;
      assertValidSandboxName(sandboxName);

      const worktreePath = createOptions.worktreePath;
      const workspaces = collectWorkspaces(createOptions, configuredWorkspaces);
      const workspaceArgs = workspaces.map(formatWorkspaceArg);

      await execSbx(sbxCommand, [
        "create",
        "--quiet",
        "--name",
        sandboxName,
        ...formatCreateOptions(options),
        options?.agent ?? "shell",
        ...workspaceArgs,
      ]);

      const onExit = () => {
        try {
          execFileSync(sbxCommand, ["rm", "--force", sandboxName], {
            stdio: "ignore",
            timeout: 5000,
          });
        } catch {
          /* best-effort */
        }
      };
      const onSignal = () => {
        onExit();
        process.exit(1);
      };
      process.on("exit", onExit);
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);

      const envArgs = Object.entries(createOptions.env).flatMap(
        ([key, value]) => ["-e", `${key}=${value}`],
      );

      const handle: BindMountSandboxHandle = {
        worktreePath,

        exec: (
          command: string,
          opts?: {
            onLine?: (line: string) => void;
            cwd?: string;
            sudo?: boolean;
            stdin?: string;
            signal?: AbortSignal;
          },
        ): Promise<ExecResult> => {
          const args = ["exec"];
          if (opts?.stdin !== undefined) args.push("-i");
          if (opts?.sudo) args.push("-u", "root");
          args.push(...envArgs, "-w", opts?.cwd ?? worktreePath);
          args.push(sandboxName, "sh", "-c", command);

          return new Promise((resolve, reject) => {
            if (opts?.signal?.aborted) {
              reject(opts.signal.reason ?? new Error("sbx exec aborted"));
              return;
            }

            const proc = spawn(sbxCommand, args, {
              stdio: [
                opts?.stdin !== undefined ? "pipe" : "ignore",
                "pipe",
                "pipe",
              ],
            });

            let killTimer: ReturnType<typeof setTimeout> | undefined;
            const abort = () => {
              proc.kill("SIGTERM");
              killTimer = setTimeout(() => {
                if (proc.exitCode === null && proc.signalCode === null) {
                  proc.kill("SIGKILL");
                }
              }, 2000);
            };
            opts?.signal?.addEventListener("abort", abort, { once: true });

            if (opts?.stdin !== undefined) {
              proc.stdin!.write(opts.stdin);
              proc.stdin!.end();
            }

            const stdoutChunks: string[] = [];
            const stderrChunks: string[] = [];

            if (opts?.onLine) {
              const onLine = opts.onLine;
              const rl = createInterface({ input: proc.stdout! });
              rl.on("line", (line) => {
                stdoutChunks.push(line);
                onLine(line);
              });
            } else {
              proc.stdout!.on("data", (chunk: Buffer) => {
                stdoutChunks.push(chunk.toString());
              });
            }

            proc.stderr!.on("data", (chunk: Buffer) => {
              stderrChunks.push(chunk.toString());
            });

            proc.on("error", (error) => {
              opts?.signal?.removeEventListener("abort", abort);
              if (killTimer) clearTimeout(killTimer);
              reject(new Error(`${sbxCommand} exec failed: ${error.message}`));
            });

            proc.on("close", (code) => {
              opts?.signal?.removeEventListener("abort", abort);
              if (killTimer) clearTimeout(killTimer);
              resolve({
                stdout: stdoutChunks.join(opts?.onLine ? "\n" : ""),
                stderr: stderrChunks.join(""),
                exitCode: code ?? 0,
              });
            });
          });
        },

        interactiveExec: (
          args: string[],
          opts: InteractiveExecOptions,
        ): Promise<{ exitCode: number }> => {
          return new Promise((resolve, reject) => {
            const sbxArgs = ["exec"];
            if (
              "isTTY" in opts.stdin &&
              (opts.stdin as { isTTY?: boolean }).isTTY
            ) {
              sbxArgs.push("-it");
            } else {
              sbxArgs.push("-i");
            }
            sbxArgs.push(...envArgs, "-w", opts.cwd ?? worktreePath);
            sbxArgs.push(sandboxName, ...args);

            const proc = spawn(sbxCommand, sbxArgs, {
              stdio: [opts.stdin, opts.stdout, opts.stderr] as StdioOptions,
            });

            proc.on("error", (error: Error) => {
              reject(new Error(`${sbxCommand} exec failed: ${error.message}`));
            });

            proc.on("close", (code: number | null) => {
              resolve({ exitCode: code ?? 0 });
            });
          });
        },

        copyFileIn: (hostPath: string, sandboxPath: string): Promise<void> =>
          execSbx(sbxCommand, [
            "cp",
            hostPath,
            `${sandboxName}:${sandboxPath}`,
          ]),

        copyFileOut: (sandboxPath: string, hostPath: string): Promise<void> =>
          execSbx(sbxCommand, [
            "cp",
            `${sandboxName}:${sandboxPath}`,
            hostPath,
          ]),

        close: async (): Promise<void> => {
          process.removeListener("exit", onExit);
          process.removeListener("SIGINT", onSignal);
          process.removeListener("SIGTERM", onSignal);
          await execSbx(sbxCommand, ["rm", "--force", sandboxName]);
        },
      };

      return handle;
    },
  });
};

const execSbx = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(new Error(`${command} ${args[0]} failed: ${error.message}`));
      } else {
        resolve();
      }
    });
  });

const formatCreateOptions = (options?: SbxOptions): string[] => {
  const args: string[] = [];
  if (options?.template) args.push("--template", options.template);
  if (options?.cpus !== undefined) args.push("--cpus", String(options.cpus));
  if (options?.memory) args.push("--memory", options.memory);
  for (const kit of options?.kits ?? []) {
    args.push("--kit", kit);
  }
  return args;
};

const resolveWorkspace = (workspace: SbxWorkspace): ResolvedSbxWorkspace => {
  const resolvedPath = resolveHostPath(workspace.path);
  if (!existsSync(resolvedPath)) {
    throw new Error(
      `SBX workspace path does not exist: ${workspace.path}` +
        (workspace.path !== resolvedPath
          ? ` (resolved to ${resolvedPath})`
          : ""),
    );
  }
  if (!statSync(resolvedPath).isDirectory()) {
    throw new Error(
      `SBX workspace path must be a directory: ${workspace.path}` +
        (workspace.path !== resolvedPath
          ? ` (resolved to ${resolvedPath})`
          : ""),
    );
  }
  return {
    path: resolvedPath,
    ...(workspace.readonly ? { readonly: true } : {}),
  };
};

const collectWorkspaces = (
  createOptions: BindMountCreateOptions,
  configuredWorkspaces: readonly ResolvedSbxWorkspace[],
): ResolvedSbxWorkspace[] => {
  const paths = new Map<string, boolean>();

  const add = (path: string, readonly: boolean) => {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return;
    }
    const existingReadonly = paths.get(path);
    paths.set(
      path,
      existingReadonly === undefined ? readonly : existingReadonly && readonly,
    );
  };

  add(createOptions.worktreePath, false);

  for (const mount of createOptions.mounts) {
    add(mount.hostPath, mount.readonly === true);
  }

  for (const workspace of configuredWorkspaces) {
    add(workspace.path, workspace.readonly === true);
  }

  return Array.from(paths, ([path, readonly]) => ({
    path,
    ...(readonly ? { readonly: true } : {}),
  }));
};

const formatWorkspaceArg = (workspace: ResolvedSbxWorkspace): string =>
  workspace.readonly ? `${workspace.path}:ro` : workspace.path;

const assertValidSandboxName = (name: string): void => {
  if (!SBX_NAME_RE.test(name)) {
    throw new Error(
      `Invalid SBX sandbox name "${name}". SBX names may contain only letters, numbers, periods, plus signs, and hyphens.`,
    );
  }
};
