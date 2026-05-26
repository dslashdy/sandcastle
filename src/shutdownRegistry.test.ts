import { afterEach, describe, expect, it, vi } from "vitest";
import { registerShutdown } from "./shutdownRegistry.js";

describe("shutdownRegistry", () => {
  let restoreExit: (() => void) | undefined;

  afterEach(() => {
    restoreExit?.();
    restoreExit = undefined;
  });

  const stubExit = () => {
    const spy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    restoreExit = () => spy.mockRestore();
    return spy;
  };

  it("installs one listener per signal regardless of how many shutdowns are registered", () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    const exitBefore = process.listenerCount("exit");

    const unregisters = Array.from({ length: 25 }, () =>
      registerShutdown(() => {}),
    );

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
    expect(process.listenerCount("exit")).toBe(exitBefore + 1);

    unregisters.forEach((u) => u());

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(process.listenerCount("exit")).toBe(exitBefore);
  });

  it("runs every registered teardown then exits once with code 1 on SIGINT", () => {
    const exit = stubExit();
    const calls: string[] = [];
    const u1 = registerShutdown(() => calls.push("a"));
    const u2 = registerShutdown(() => calls.push("b"));

    process.emit("SIGINT");

    expect(calls).toEqual(["a", "b"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);

    u1();
    u2();
  });

  it("runs registered teardowns on SIGTERM", () => {
    stubExit();
    const calls: string[] = [];
    const u1 = registerShutdown(() => calls.push("x"));

    process.emit("SIGTERM");

    expect(calls).toEqual(["x"]);
    u1();
  });

  it("does not run a teardown after it has been unregistered", () => {
    stubExit();
    const calls: string[] = [];
    const stay = registerShutdown(() => calls.push("stay"));
    const gone = registerShutdown(() => calls.push("gone"));

    gone();
    process.emit("SIGINT");

    expect(calls).toEqual(["stay"]);
    stay();
  });

  it("a throwing teardown does not prevent the others from running", () => {
    stubExit();
    const calls: string[] = [];
    const u1 = registerShutdown(() => {
      throw new Error("boom");
    });
    const u2 = registerShutdown(() => calls.push("ran"));

    process.emit("SIGINT");

    expect(calls).toEqual(["ran"]);
    u1();
    u2();
  });

  it("unregister is idempotent", () => {
    const exitBefore = process.listenerCount("exit");
    const unreg = registerShutdown(() => {});
    unreg();
    unreg();
    expect(process.listenerCount("exit")).toBe(exitBefore);
  });
});
