import { describe, expect, it } from "vitest";
import {
  listSandboxProviders,
  getSandboxProvider,
  getAgent,
  isSandboxProviderSupportedForAgent,
} from "./InitService.js";

describe("Sandbox provider registry", () => {
  it("listSandboxProviders returns docker, podman, and sbx", () => {
    const providers = listSandboxProviders();
    expect(providers.some((p) => p.name === "docker")).toBe(true);
    expect(providers.some((p) => p.name === "podman")).toBe(true);
    expect(providers.some((p) => p.name === "sbx")).toBe(true);
  });

  it("getSandboxProvider returns docker entry", () => {
    const provider = getSandboxProvider("docker");
    expect(provider).toBeDefined();
    expect(provider!.containerfileName).toBe("Dockerfile");
    expect(provider!.cliNamespace).toBe("docker");
    expect(provider!.factoryCall(getAgent("claude-code")!, "image")).toBe(
      "docker()",
    );
  });

  it("getSandboxProvider returns podman entry", () => {
    const provider = getSandboxProvider("podman");
    expect(provider).toBeDefined();
    expect(provider!.containerfileName).toBe("Containerfile");
    expect(provider!.cliNamespace).toBe("podman");
    expect(provider!.factoryCall(getAgent("claude-code")!, "image")).toBe(
      "podman()",
    );
  });

  it("getSandboxProvider returns sbx entry with agent-aware factory call", () => {
    const provider = getSandboxProvider("sbx");
    expect(provider).toBeDefined();
    expect(provider!.containerfileName).toBe("Dockerfile");
    expect(provider!.cliNamespace).toBe("sbx");
    expect(provider!.loadIntoSbxTemplateStore).toBe(true);
    expect(
      provider!.factoryCall(getAgent("claude-code")!, "sandcastle:test"),
    ).toBe('sbx({ agent: "claude", template: "sandcastle:test" })');
    expect(provider!.factoryCall(getAgent("codex")!, "sandcastle:test")).toBe(
      'sbx({ agent: "codex", template: "sandcastle:test" })',
    );
  });

  it("restricts sbx to Claude Code and Codex agents", () => {
    const provider = getSandboxProvider("sbx")!;

    expect(
      isSandboxProviderSupportedForAgent(provider, getAgent("claude-code")!),
    ).toBe(true);
    expect(
      isSandboxProviderSupportedForAgent(provider, getAgent("codex")!),
    ).toBe(true);
    expect(isSandboxProviderSupportedForAgent(provider, getAgent("pi")!)).toBe(
      false,
    );
  });

  it("getSandboxProvider returns undefined for unknown provider", () => {
    expect(getSandboxProvider("nonexistent")).toBeUndefined();
  });
});
