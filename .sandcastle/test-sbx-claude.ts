import * as sandcastle from "@ai-hero/sandcastle";
import { sbx } from "@ai-hero/sandcastle/sandboxes/sbx";

const name = `sandcastle-sbx-claude-smoke-${Date.now()}`;
const completionSignal = "<promise>COMPLETE</promise>";

const sandbox = await sandcastle.createSandbox({
  branch: name,
  sandbox: sbx({
    agent: "claude",
    name,
  }),
});

try {
  console.log("Worktree:", sandbox.worktreePath);

  const result = await sandbox.run({
    name: "SBX Claude smoke",
    agent: sandcastle.claudeCode(
      process.env.SANDCASTLE_SBX_CLAUDE_MODEL ?? "claude-sonnet-4-6",
      {
        captureSessions: false,
      },
    ),
    logging: { type: "stdout" },
    completionSignal,
    prompt: [
      "This is a Sandcastle SBX Claude smoke test.",
      "Do not edit files and do not commit.",
      "Print:",
      "- pwd",
      "- whoami",
      "- command -v claude",
      "- claude --version",
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
