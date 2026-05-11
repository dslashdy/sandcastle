import * as sandcastle from "@ai-hero/sandcastle";
import { sbx } from "@ai-hero/sandcastle/sandboxes/sbx";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is required for the SBX Codex smoke test. " +
      "Codex subscription/OAuth auth can work interactively, but non-interactive `codex exec --json` needs an API key.",
  );
}

const name = `sandcastle-sbx-codex-smoke-${Date.now()}`;
const completionSignal = "<promise>COMPLETE</promise>";

const sandbox = await sandcastle.createSandbox({
  branch: name,
  sandbox: sbx({
    agent: "codex",
    name,
  }),
});

try {
  console.log("Worktree:", sandbox.worktreePath);

  const result = await sandbox.run({
    name: "SBX Codex smoke",
    agent: sandcastle.codex(
      process.env.SANDCASTLE_SBX_CODEX_MODEL ?? "gpt-5.4-mini",
      {
        env: {
          OPENAI_API_KEY: apiKey,
        },
      },
    ),
    logging: { type: "stdout" },
    completionSignal,
    prompt: [
      "This is a Sandcastle SBX Codex smoke test.",
      "Do not edit files and do not commit.",
      "Print:",
      "- pwd",
      "- whoami",
      "- command -v codex",
      "- codex --version",
      "- git status --short --branch",
      `Then print ${completionSignal}.`,
    ].join("\n"),
  });

  console.log("commits:", result.commits);

  if (result.completionSignal !== completionSignal) {
    throw new Error(
      `Expected completion signal ${completionSignal}, got ${String(
        result.completionSignal,
      )}`,
    );
  }

  if (result.commits.length > 0) {
    throw new Error("Expected smoke test to make no commits.");
  }
} finally {
  const closeResult = await sandbox.close();
  console.log("close:", closeResult);
}
