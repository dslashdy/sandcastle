import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );

  return {
    ...actual,
    execFile: vi.fn(),
    execFileSync: vi.fn(),
    spawn: vi.fn(),
  };
});

import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { sbx } from "./sbx.js";
import type {
  BindMountCreateOptions,
  BindMountSandboxHandle,
} from "../SandboxProvider.js";

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);

afterEach(() => {
  mockExecFile.mockReset();
  mockSpawn.mockReset();
});

describe("sbx()", () => {
  it("returns a bind-mount SandboxProvider named sbx", () => {
    const provider = sbx();

    expect(provider.tag).toBe("bind-mount");
    expect(provider.name).toBe("sbx");
    expect(provider.env).toEqual({});
  });

  it("accepts provider env", () => {
    const provider = sbx({ env: { SBX_VAR: "hello" } });

    expect(provider.env).toEqual({ SBX_VAR: "hello" });
  });

  it("validates explicit sandbox names", () => {
    expect(() => sbx({ name: "valid-name.1+dev" })).not.toThrow();
    expect(() => sbx({ name: "bad name" })).toThrow("Invalid SBX sandbox name");
  });

  it("validates configured workspace paths at construction time", () => {
    expect(() => sbx({ workspaces: [{ path: "src" }] })).not.toThrow();
    expect(() =>
      sbx({ workspaces: [{ path: "nonexistent_dir_xyz" }] }),
    ).toThrow("SBX workspace path does not exist");
    expect(() => sbx({ workspaces: [{ path: "package.json" }] })).toThrow(
      "SBX workspace path must be a directory",
    );
  });

  it("creates an SBX shell sandbox with worktree, git, and configured workspaces", async () => {
    mockSbxSuccess();

    const cwd = process.cwd();
    const srcDir = join(cwd, "src");
    const provider = sbx({
      name: "sandcastle-test",
      agent: "claude",
      template: "node",
      kits: ["gh", "codex"],
      cpus: 4,
      memory: "8gb",
      workspaces: [{ path: "src", readonly: true }],
    });

    const handle = await provider.create(
      createOptions({
        mounts: [
          { hostPath: cwd, sandboxPath: "/home/agent/workspace" },
          { hostPath: "package.json", sandboxPath: "package.json" },
          { hostPath: srcDir, sandboxPath: "/mnt/src", readonly: true },
        ],
      }),
    );

    expect(handle.worktreePath).toBe(cwd);

    const createCall = mockExecFile.mock.calls.find(
      ([cmd, args]) =>
        cmd === "sbx" && Array.isArray(args) && args[0] === "create",
    );
    expect(createCall).toBeDefined();
    expect(createCall![1]).toEqual([
      "create",
      "--quiet",
      "--name",
      "sandcastle-test",
      "--template",
      "node",
      "--cpus",
      "4",
      "--memory",
      "8gb",
      "--kit",
      "gh",
      "--kit",
      "codex",
      "claude",
      cwd,
      `${srcDir}:ro`,
    ]);

    await handle.close();
  });

  it("passes env, cwd, stdin, and sudo through sbx exec", async () => {
    mockSbxSuccess();
    mockSpawn.mockImplementation(
      () =>
        makeProcess({ stdout: "one\ntwo\n", stderr: "warn\n", code: 7 }) as any,
    );

    const cwd = process.cwd();
    const provider = sbx({ name: "sandcastle-test" });
    const handle = await provider.create(
      createOptions({ env: { FOO: "bar" } }),
    );
    const lines: string[] = [];

    const result = await handle.exec("echo hi", {
      onLine: (line) => lines.push(line),
      stdin: "hello",
      sudo: true,
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "sbx",
      [
        "exec",
        "-i",
        "-u",
        "root",
        "-e",
        "FOO=bar",
        "-w",
        cwd,
        "sandcastle-test",
        "sh",
        "-c",
        "echo hi",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    expect(lines).toEqual(["one", "two"]);
    expect(result).toEqual({
      stdout: "one\ntwo",
      stderr: "warn\n",
      exitCode: 7,
    });

    await handle.close();
  });

  it("supports interactive exec with TTY allocation", async () => {
    mockSbxSuccess();
    mockSpawn.mockImplementation(() => makeProcess({ code: 0 }) as any);

    const provider = sbx({ name: "sandcastle-test" });
    const handle = await provider.create(
      createOptions({ env: { FOO: "bar" } }),
    );
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = true;

    const result = await handle.interactiveExec!(["bash"], {
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      cwd: "/tmp/project",
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "sbx",
      [
        "exec",
        "-it",
        "-e",
        "FOO=bar",
        "-w",
        "/tmp/project",
        "sandcastle-test",
        "bash",
      ],
      {
        stdio: [stdin, expect.any(PassThrough), expect.any(PassThrough)],
      },
    );
    expect(result.exitCode).toBe(0);

    await handle.close();
  });

  it("copies files with sbx cp", async () => {
    mockSbxSuccess();

    const provider = sbx({ name: "sandcastle-test" });
    const handle = (await provider.create(
      createOptions(),
    )) as BindMountSandboxHandle;

    await handle.copyFileIn("/host/input.txt", "/workspace/input.txt");
    await handle.copyFileOut("/workspace/output.txt", "/host/output.txt");

    expect(mockExecFile).toHaveBeenCalledWith(
      "sbx",
      ["cp", "/host/input.txt", "sandcastle-test:/workspace/input.txt"],
      expect.any(Function),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "sbx",
      ["cp", "sandcastle-test:/workspace/output.txt", "/host/output.txt"],
      expect.any(Function),
    );

    await handle.close();
  });

  it("removes the sandbox on close", async () => {
    mockSbxSuccess();

    const provider = sbx({ name: "sandcastle-test" });
    const handle = await provider.create(createOptions());

    await handle.close();

    expect(mockExecFile).toHaveBeenCalledWith(
      "sbx",
      ["rm", "--force", "sandcastle-test"],
      expect.any(Function),
    );
  });
});

const mockSbxSuccess = () => {
  mockExecFile.mockImplementation((_command, _args, ...rest: any[]) => {
    const callback = rest[rest.length - 1];
    callback(null, "", "");
    return undefined as any;
  });
};

const createOptions = (
  overrides: Partial<BindMountCreateOptions> = {},
): BindMountCreateOptions => {
  const cwd = process.cwd();
  return {
    worktreePath: cwd,
    hostRepoPath: cwd,
    mounts: [{ hostPath: cwd, sandboxPath: "/home/agent/workspace" }],
    env: {},
    ...overrides,
  };
};

const makeProcess = ({
  stdout = "",
  stderr = "",
  code = 0,
}: {
  stdout?: string;
  stderr?: string;
  code?: number;
}) => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();

  setImmediate(() => {
    proc.stdout.write(stdout);
    proc.stdout.end();
    proc.stderr.write(stderr);
    proc.stderr.end();
    proc.emit("close", code);
  });

  return proc;
};
