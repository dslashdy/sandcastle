// Adversarial Best-of-N — resolve issues with a deterministic gate that holds the gavel
//
// ──────────────────────────────────────────────────────────────────────────
// ASYMMETRIC AUTHORITY (read this first)
//
//   The DETERMINISTIC GATE decides — never an LLM. ruff/mypy/pytest, the
//   property suite, and the complexity/nesting/dependency preconditions are
//   the hard floor. No agent output can turn a red gate green, and no agent
//   ever declares "done."
//
//   The CRITIC has veto power only. It may flag a winner for human review; it
//   may NOT approve one. Approval is the gate's job, full stop.
//
//   This asymmetry is the whole point: generation is creative and fallible, so
//   the thing that ships an artifact must be mechanical, reproducible, and
//   blind to persuasion. Keep it that way when you edit this file.
// ──────────────────────────────────────────────────────────────────────────
//
// Pipeline, per issue (issues are processed sequentially):
//   1. Best-of-N generate   N parallel run()s, each on its own candidate branch.
//                           Cross-model lineup (Opus + one GPT) for real
//                           diversity. Generators see the issue body only —
//                           never the ranking metrics.
//   2. Deterministic gate   In a per-issue container, in order: ruff, mypy,
//                           pytest, property suite, then complexity/nesting/
//                           new-dependency preconditions. Discard every
//                           candidate that fails.
//   3. Dispersion check     If the metrics point at different candidates with
//                           no clear primary leader, the issue is
//                           underspecified → needs-human (do not regenerate).
//   4. Rank                 Lexicographic with tolerance bands (never a blend).
//   5. Select               Take the winning branch whole — no splicing.
//   6. One bounded repair   A critic writes review.json; if it flags a material
//                           defect, one revise applies only those fixes and we
//                           re-gate. A repair that breaches the ceiling is
//                           discarded in favour of the pre-repair winner.
//   7. Verdict              From the gate, never an LLM. Green → fast-forward
//                           merge to the issue branch, merge that branch into
//                           the local launch branch, then close the issue.
//                           Red/vetoed → needs-human, branch left unmerged.
//
// Each per-issue workflow runs entirely in containers: the generator/critic/
// reviser nodes each get their own sandbox via run(), and the deterministic
// gate runs the toolchain inside a dedicated per-issue container built from the
// sandbox image (the Dockerfile bundles ruff/mypy/pytest/hypothesis/complexipy).
// Nothing in the gate runs on the host except git ref plumbing.
//
// Invariants: every node is its own run() (iteration comes from THIS file, not
// maxIterations); all cross-node handoff goes through committed files read with
// `git show` (never agent stdout); models are pinned explicitly below.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Prerequisites (host): git, plus the container runtime (docker/podman). The
// sandbox image must be built first (`sandcastle docker build-image`) — it
// carries the gate toolchain, so the host needs no Python tools.

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of candidates generated per issue. */
const N = 3;

/** Git ref each issue branch is cut from. Pin to "main"/"origin/main" if you prefer. */
const BASE_REF = "HEAD";

/** Cognitive-complexity ceiling for the worst function in a candidate (precondition). */
const COMPLEXITY_CEILING = 15;

/** Maximum block-nesting depth allowed anywhere in a candidate (precondition). */
const NESTING_MAX = 4;

/** Tie-break band: candidates within this fraction of the primary leader compete on the next axis. */
const TOLERANCE = 0.15;

/** Selector for the hypothesis property suite (its own gate step). Adjust the marker/path to your project. */
const PROPERTY_TEST_ARGS = ["-m", "property"];

/** Idle timeouts (seconds) per agent node. */
const GENERATE_TIMEOUT = 1800;
const CRITIC_TIMEOUT = 900;
const REVISE_TIMEOUT = 900;

/** The repo root the orchestrator runs from (host-side git anchors here). */
const REPO = process.cwd();

loadSandcastleEnv();

/** Container runtime + image used to run the gate toolchain. Defaults match `sandcastle init`. */
const CONTAINER_CLI = process.env["SANDCASTLE_CONTAINER_CLI"] ?? "docker";
const IMAGE = process.env["SANDCASTLE_IMAGE"] ?? defaultImageName(REPO);

/** Mirror of sandcastle's default image name: `sandcastle:<sanitized-dir-name>`. */
function defaultImageName(repoDir: string): string {
  const dirName =
    repoDir
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "local";
  const sanitized = dirName.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  return `sandcastle:${sanitized || "local"}`;
}

/**
 * Load `.sandcastle/.env` for host-side orchestration commands such as
 * `gh issue list`. Sandcastle injects env vars into sandboxed agents, but this
 * file also does host-side git and issue plumbing before any sandbox starts.
 */
function loadSandcastleEnv(): void {
  const envPath = `${REPO}/.sandcastle/.env`;
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(equalsIndex + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
}

// Pinned models — every node names its model explicitly; nothing relies on a
// framework default. Reasoning effort maps the spec's wording to the provider
// option: Claude "extra" → effort "max" (top of low|medium|high|max); GPT
// "ext high" → effort "xhigh" (top of low|medium|high|xhigh).
//
// The lineup is intentionally heterogeneous (Opus generators + one GPT
// generator, Opus critic/reviser) so best-of-N explores genuinely different
// solution shapes rather than N samples of one model. `sandcastle init` may
// rewrite the agent family if you selected a non-Claude agent — keep the
// lineup diverse when you customize.
const CLAUDE_GENERATOR_MODEL = "claude-opus-4-8";
const GPT_GENERATOR_MODEL = "gpt-5.5";
const CRITIC_MODEL = "claude-opus-4-8";
const REVISE_MODEL = "claude-opus-4-8";

interface LabeledAgent {
  readonly provider: sandcastle.AgentProvider;
  readonly label: string;
}

const opusGenerator = (): LabeledAgent => ({
  provider: sandcastle.claudeCode(CLAUDE_GENERATOR_MODEL, { effort: "max" }),
  label: `claude-code:${CLAUDE_GENERATOR_MODEL} effort=max`,
});
const gptGenerator = (): LabeledAgent => ({
  provider: sandcastle.codex(GPT_GENERATOR_MODEL, { effort: "xhigh" }),
  label: `codex:${GPT_GENERATOR_MODEL} effort=xhigh`,
});
const CRITIC_AGENT: LabeledAgent = {
  provider: sandcastle.claudeCode(CRITIC_MODEL, { effort: "max" }),
  label: `claude-code:${CRITIC_MODEL} effort=max`,
};
const REVISE_AGENT: LabeledAgent = {
  provider: sandcastle.claudeCode(REVISE_MODEL, { effort: "max" }),
  label: `claude-code:${REVISE_MODEL} effort=max`,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

interface Metrics {
  /** Cognitive complexity of the worst function — the primary ranking axis (lower is better). */
  readonly worstComplexity: number;
  /** Deepest block nesting found in the candidate (precondition only). */
  readonly maxNesting: number;
  /** New public symbols + new parameters on existing signatures (first tie-break). */
  readonly interfaceSurface: number;
  /** Net lines added vs the issue base (final tie-break). */
  readonly netLinesAdded: number;
  /** Third-party dependencies added without a committed rationale (precondition only). */
  readonly newDependencies: readonly string[];
}

interface Candidate {
  readonly k: number;
  readonly branch: string;
  readonly metrics: Metrics;
}

interface GateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

interface ReviewItem {
  readonly severity: "blocker" | "material" | "minor";
  readonly file: string;
  readonly claim: string;
  readonly fix: string;
}

type Status = "clean" | "passed-after-repair" | "needs-human";

// ---------------------------------------------------------------------------
// Branch naming
//
// The issue branch is `agent/issue-<id>` (the ff-merge target). Candidates use
// a HYPHEN — `agent/issue-<id>-cand-<k>` — not `agent/issue-<id>/cand-<k>`:
// git cannot hold both `refs/heads/agent/issue-<id>` and a ref *under*
// `agent/issue-<id>/` (a directory/file conflict), so a slash here would fail
// the moment the first candidate branch is created.
// ---------------------------------------------------------------------------

const issueBranch = (issue: Issue): string => `agent/issue-${issue.id}`;
const candidateBranch = (issue: Issue, k: number): string =>
  `agent/issue-${issue.id}-cand-${k}`;

// ---------------------------------------------------------------------------
// Issue source
// ---------------------------------------------------------------------------

const LIST_TASKS_COMMAND = `{{LIST_TASKS_COMMAND}}`;
const CLOSE_TASK_COMMAND = `{{CLOSE_TASK_COMMAND}}`;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const textValue = (value: unknown): string | undefined => {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
};

const commentText = (value: unknown): string | undefined => {
  const direct = textValue(value);
  if (direct) return direct;

  const record = asRecord(value);
  if (!record) return undefined;

  return (
    textValue(record["body"]) ??
    textValue(record["text"]) ??
    textValue(record["content"])
  );
};

function normalizeIssue(raw: unknown, index: number): Issue | undefined {
  const task = asRecord(raw);
  if (!task) return undefined;

  const id = textValue(
    task["id"] ??
      task["number"] ??
      task["identifier"] ??
      task["key"] ??
      index + 1,
  );
  if (!id) return undefined;

  const title =
    textValue(task["title"] ?? task["summary"] ?? task["name"]) ?? `Task ${id}`;
  const body = textValue(
    task["body"] ?? task["description"] ?? task["content"],
  );

  const comments = Array.isArray(task["comments"])
    ? task["comments"]
        .map(commentText)
        .filter((comment): comment is string => comment !== undefined)
    : [];
  const commentSection =
    comments.length > 0
      ? "\n\nComments:\n\n" +
        comments
          .map(
            (comment, commentIndex) =>
              `Comment ${commentIndex + 1}:\n${comment}`,
          )
          .join("\n\n")
      : "";

  return {
    id,
    title,
    body: `${body ?? ""}${commentSection}`.trim(),
  };
}

async function fetchIssues(): Promise<Issue[]> {
  const result = spawnSync(LIST_TASKS_COMMAND, {
    cwd: REPO,
    encoding: "utf8",
    shell: true,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `issue list command failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`issue list command did not return JSON: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("issue list command must return a JSON array");
  }

  const issues: Issue[] = [];
  for (const [index, task] of parsed.entries()) {
    const issue = normalizeIssue(task, index);
    if (issue) issues.push(issue);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Host-side git helpers (ref plumbing only — no project toolchain on the host)
// ---------------------------------------------------------------------------

/** Run git from the repo root (or `cwd`) and return the raw result. */
function git(args: string[], cwd: string = REPO) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Run git and throw on failure — for operations whose success we depend on. */
function gitOut(args: string[], cwd: string = REPO): string {
  const r = git(args, cwd);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

const branchExists = (branch: string): boolean =>
  git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;

/** Create `branch` at `base` if it does not already exist (no checkout). */
function ensureBranch(branch: string, base: string): void {
  if (!branchExists(branch)) gitOut(["branch", branch, base]);
}

const tipSha = (ref: string): string => gitOut(["rev-parse", ref]).trim();

function currentBranch(): string {
  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (!branch || branch === "HEAD") {
    throw new Error(
      "adversarial-best-of-n requires a named launch branch; detached HEAD is not supported",
    );
  }
  return branch;
}

/** Move a branch ref without touching any working tree. */
const resetBranch = (branch: string, sha: string): void =>
  void gitOut(["branch", "-f", branch, sha]);

/** Fast-forward `target` to `source` via a self-fetch — succeeds only if it is a true ff. */
const ffMerge = (target: string, source: string): boolean =>
  git(["fetch", ".", `${source}:${target}`]).status === 0;

function commitsAhead(source: string, base: string): number {
  const result = git(["rev-list", `${base}..${source}`, "--count"]);
  if (result.status !== 0) return 0;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function commandError(result: ReturnType<typeof spawnSync>): string {
  return (
    String(result.stderr ?? "").trim() ||
    String(result.stdout ?? "").trim() ||
    `exit ${result.status ?? "unknown"}`
  );
}

function mergeIntoLaunchBranch(
  sourceBranch: string,
  launchBranch: string,
): { ok: true } | { ok: false; error: string } {
  const activeBranch = currentBranch();
  if (activeBranch !== launchBranch) {
    return {
      ok: false,
      error: `current branch changed from ${launchBranch} to ${activeBranch}`,
    };
  }

  const result = git(["merge", "--no-edit", sourceBranch]);
  if (result.status !== 0) {
    return { ok: false, error: commandError(result) };
  }
  return { ok: true };
}

function closeIssue(
  issue: Issue,
): { ok: true } | { ok: false; error: string } {
  const command = CLOSE_TASK_COMMAND.replaceAll("<ID>", shellQuote(issue.id));
  const result = spawnSync(command, {
    cwd: REPO,
    encoding: "utf8",
    shell: true,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return { ok: false, error: commandError(result) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-issue gate container (the toolchain lives in the image, not on the host)
// ---------------------------------------------------------------------------

const sanitizeRef = (ref: string): string =>
  ref.replace(/[^a-zA-Z0-9_.-]/g, "-");

/** Run the container CLI and return the raw result. */
function cli(args: string[]) {
  return spawnSync(CONTAINER_CLI, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Run the container CLI and throw on failure. */
function cliOut(args: string[]): string {
  const r = cli(args);
  if (r.status !== 0) {
    throw new Error(
      `${CONTAINER_CLI} ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

/** Run a shell script inside the issue container; returns exit code + output. */
function execIn(
  name: string,
  script: string,
): { code: number; stdout: string; stderr: string } {
  const r = cli(["exec", name, "sh", "-c", script]);
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Start one detached container per issue from the sandbox image (toolchain
 * baked in), with the repo mounted read-only, run `fn`, then tear it down.
 * Every deterministic check for the issue runs inside this single container.
 */
async function withIssueContainer<T>(
  issue: Issue,
  fn: (name: string) => Promise<T>,
): Promise<T> {
  const name = `sandcastle-gate-${sanitizeRef(issue.id)}`;
  cli(["rm", "-f", name]); // clear any stale container from a prior run
  cliOut([
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-v",
    `${REPO}:/host-repo:ro`,
    "--entrypoint",
    "sleep",
    IMAGE,
    "infinity",
  ]);
  try {
    return await fn(name);
  } finally {
    cli(["rm", "-f", name]);
  }
}

/**
 * Clone+checkout `branch` into an isolated working dir inside the container.
 * Returns the workdir path, or null if the checkout failed.
 */
function checkoutInContainer(name: string, branch: string): string | null {
  const dir = `/home/agent/gate/${sanitizeRef(branch)}`;
  const script = [
    `git config --global --add safe.directory '*'`,
    `rm -rf ${dir}`,
    `git clone -q -s /host-repo ${dir}`,
    `cd ${dir}`,
    `git checkout -q '${branch}' 2>/dev/null || git checkout -q -B '${branch}' 'origin/${branch}'`,
  ].join(" && ");
  return execIn(name, script).code === 0 ? dir : null;
}

/**
 * Cognitive-complexity + nesting report for a checkout inside the container
 * using complexipy plus a small Python AST nesting walker.
 */
function complexityReport(
  name: string,
  dir: string,
): { worstComplexity: number; maxNesting: number } {
  const reportPath = `/tmp/sandcastle-complexity-${sanitizeRef(dir)}.json`;
  const complexityScript = [
    `rm -f ${shellQuote(reportPath)}`,
    `cd ${shellQuote(dir)}`,
    `complexipy --output-format json --output ${shellQuote(reportPath)} --ignore-complexity . >/tmp/sandcastle-complexity.out 2>/tmp/sandcastle-complexity.err`,
    "code=$?",
    'if [ "$code" -ne 0 ]; then',
    "  cat /tmp/sandcastle-complexity.out /tmp/sandcastle-complexity.err >&2",
    '  exit "$code"',
    "fi",
    `cat ${shellQuote(reportPath)}`,
  ].join("\n");

  const complexity = execIn(name, complexityScript);
  if (complexity.code !== 0) {
    throw new Error(
      `complexipy failed in ${name} for ${dir}: ${complexity.stderr.trim()}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(complexity.stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`complexipy output was not JSON: ${message}`);
  }

  const worstComplexity = maxComplexity(parsed);
  const nesting = execIn(
    name,
    `python3 -c ${shellQuote(MAX_NESTING_SCRIPT)} ${shellQuote(dir)}`,
  );
  if (nesting.code !== 0) {
    throw new Error(
      `nesting analysis failed in ${name} for ${dir}: ${nesting.stderr.trim()}`,
    );
  }

  const maxNesting = Number.parseInt(nesting.stdout.trim(), 10);
  return {
    worstComplexity,
    maxNesting: Number.isFinite(maxNesting) ? maxNesting : 0,
  };
}

function maxComplexity(value: unknown): number {
  let max = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = asRecord(node);
    if (!record) return;

    if (typeof record["complexity"] === "number") {
      max = Math.max(max, record["complexity"]);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return max;
}

const MAX_NESTING_SCRIPT = String.raw`
import ast
import os
import sys

root = sys.argv[1]
block_nodes = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.With,
    ast.AsyncWith,
    ast.Try,
)
if hasattr(ast, "Match"):
    block_nodes = block_nodes + (ast.Match,)

max_depth = 0


class Visitor(ast.NodeVisitor):
    def __init__(self):
        self.depth = 0

    def generic_visit(self, node):
        global max_depth
        is_block = isinstance(node, block_nodes)
        if is_block:
            self.depth += 1
            max_depth = max(max_depth, self.depth)
        super().generic_visit(node)
        if is_block:
            self.depth -= 1


for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [
        name
        for name in dirnames
        if name not in {".git", ".mypy_cache", ".pytest_cache", "__pycache__", "node_modules"}
    ]
    for filename in filenames:
        if not filename.endswith(".py"):
            continue
        path = os.path.join(dirpath, filename)
        try:
            with open(path, "r", encoding="utf8") as handle:
                tree = ast.parse(handle.read(), filename=path)
        except SyntaxError:
            continue
        Visitor().visit(tree)

print(max_depth)
`;

/** Diff-derived metrics vs the issue base. Excludes `.sandcastle/` orchestration artifacts. */
function diffMetrics(
  branch: string,
  base: string,
): { interfaceSurface: number; netLinesAdded: number } {
  const range = `${base}...${branch}`;
  const pathspec = [".", ":(exclude).sandcastle"];

  let added = 0;
  let deleted = 0;
  for (const line of gitOut([
    "diff",
    "--numstat",
    range,
    "--",
    ...pathspec,
  ]).split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    if (m[1] && m[1] !== "-") added += Number(m[1]);
    if (m[2] && m[2] !== "-") deleted += Number(m[2]);
  }

  // Interface-surface heuristic: count newly added public defs/classes plus the
  // parameters introduced on added def signatures (self/cls and *args excluded).
  let surface = 0;
  for (const line of gitOut(["diff", range, "--", ...pathspec]).split("\n")) {
    const cls = line.match(/^\+\s*class\s+([A-Za-z_]\w*)/);
    if (cls && cls[1] && !cls[1].startsWith("_")) surface += 1;

    const def = line.match(
      /^\+\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)/,
    );
    if (def && def[1] && !def[1].startsWith("_")) {
      surface += 1;
      const params = (def[2] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && p !== "self" && p !== "cls" && !p.startsWith("*"));
      surface += params.length;
    }
  }

  return { interfaceSurface: surface, netLinesAdded: added - deleted };
}

/** Third-party deps added on `branch` (vs `base`) that lack a committed rationale. */
function newDependencies(branch: string, base: string): string[] {
  const read = (ref: string): string => {
    const r = git(["show", `${ref}:requirements.txt`]);
    return r.status === 0 ? r.stdout : "";
  };
  const names = (txt: string): Set<string> =>
    new Set(
      txt
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/[<>=!~ ;\[]/)[0]?.toLowerCase() ?? "")
        .filter(Boolean),
    );

  const baseNames = names(read(base));
  const branchNames = names(read(branch));
  const addedDeps = [...branchNames].filter((n) => !baseNames.has(n));

  // A dependency is "explained" if it is named in a committed rationale file.
  const rat = git(["show", `${branch}:.sandcastle/deps-rationale.md`]);
  const rationale = rat.status === 0 ? rat.stdout.toLowerCase() : "";
  return addedDeps.filter((n) => !rationale.includes(n));
}

// ---------------------------------------------------------------------------
// Deterministic gate + metrics (the gate holds the gavel; toolchain in-container)
// ---------------------------------------------------------------------------

/** The hard floor. Runs the tool suite in order, then the hard preconditions — all in-container. */
async function gate(
  name: string,
  branch: string,
  base: string,
): Promise<GateResult> {
  const dir = checkoutInContainer(name, branch);
  if (!dir) {
    return {
      passed: false,
      failures: [`checkout of ${branch} failed in container`],
    };
  }

  const failures: string[] = [];

  // Tool suite, in order. pytest exit 5 == "no tests collected": a hard fail
  // for the main suite, but tolerated for the property suite (may not exist yet).
  const steps: { name: string; script: string; pass: number[] }[] = [
    { name: "ruff", script: `cd ${dir} && ruff check .`, pass: [0] },
    { name: "mypy", script: `cd ${dir} && mypy .`, pass: [0] },
    { name: "pytest", script: `cd ${dir} && pytest -q`, pass: [0] },
    {
      name: "property suite",
      script: `cd ${dir} && pytest -q ${PROPERTY_TEST_ARGS.join(" ")}`,
      pass: [0, 5],
    },
  ];
  for (const s of steps) {
    const code = execIn(name, s.script).code;
    if (!s.pass.includes(code)) {
      failures.push(`${s.name} (exit ${code})`);
      break; // in order: stop at the first failed step
    }
  }

  // Hard preconditions (also fail a candidate).
  if (failures.length === 0) {
    const { worstComplexity, maxNesting } = complexityReport(name, dir);
    if (worstComplexity > COMPLEXITY_CEILING) {
      failures.push(
        `cognitive complexity ${worstComplexity} > ceiling ${COMPLEXITY_CEILING}`,
      );
    }
    if (maxNesting > NESTING_MAX) {
      failures.push(`nesting depth ${maxNesting} > max ${NESTING_MAX}`);
    }
    const unexplained = newDependencies(branch, base);
    if (unexplained.length > 0) {
      failures.push(
        `new dependency without stated reason: ${unexplained.join(", ")}`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}

/** Full ranking metrics for a survivor. */
async function metrics(
  name: string,
  branch: string,
  base: string,
): Promise<Metrics> {
  const dir = checkoutInContainer(name, branch);
  if (!dir)
    throw new Error(`checkout of ${branch} failed in container (metrics)`);
  const { worstComplexity, maxNesting } = complexityReport(name, dir);
  const { interfaceSurface, netLinesAdded } = diffMetrics(branch, base);
  return {
    worstComplexity,
    maxNesting,
    interfaceSurface,
    netLinesAdded,
    newDependencies: newDependencies(branch, base),
  };
}

// ---------------------------------------------------------------------------
// Ranking + dispersion (pure functions over the survivors' metrics)
// ---------------------------------------------------------------------------

const primaryLeader = (survivors: Candidate[]): number =>
  Math.min(...survivors.map((c) => c.metrics.worstComplexity));

const toleranceBand = (survivors: Candidate[]): Candidate[] => {
  const leader = primaryLeader(survivors);
  return survivors.filter(
    (c) => c.metrics.worstComplexity <= leader * (1 + TOLERANCE),
  );
};

const minBy = (
  survivors: Candidate[],
  key: (m: Metrics) => number,
): Candidate =>
  survivors.reduce((best, c) =>
    key(c.metrics) < key(best.metrics) ? c : best,
  );

/**
 * Rank lexicographically with tolerance bands — never a weighted blend.
 * Primary: worst-function cognitive complexity (lower is better). Among
 * candidates within TOLERANCE of the leader: interface surface, then net lines.
 */
function rank(survivors: Candidate[]): Candidate {
  const band = toleranceBand(survivors);
  const sorted = [...band].sort(
    (a, b) =>
      a.metrics.interfaceSurface - b.metrics.interfaceSurface ||
      a.metrics.netLinesAdded - b.metrics.netLinesAdded ||
      a.metrics.worstComplexity - b.metrics.worstComplexity,
  );
  return sorted[0]!;
}

/**
 * True when the metrics disagree about who should win: no clear leader on the
 * primary axis (the tolerance band holds more than one candidate) AND the two
 * secondary axes point at different candidates. That is the signature of an
 * underspecified issue — escalate rather than guess (and do not regenerate).
 */
function dispersion(survivors: Candidate[]): boolean {
  if (survivors.length <= 1) return false;
  if (toleranceBand(survivors).length === 1) return false; // a clear primary leader
  const byInterface = minBy(survivors, (m) => m.interfaceSurface);
  const byLines = minBy(survivors, (m) => m.netLinesAdded);
  return byInterface.branch !== byLines.branch;
}

// ---------------------------------------------------------------------------
// Agent nodes (each its own run(); iteration comes from the orchestrator)
// ---------------------------------------------------------------------------

function generatorLineup(n: number): LabeledAgent[] {
  // Last slot is a different model family so best-of-N has genuine diversity;
  // guarantees ≥1 GPT generator whenever n >= 2.
  return Array.from({ length: n }, (_unused, i) =>
    n >= 2 && i === n - 1 ? gptGenerator() : opusGenerator(),
  );
}

/** One generation node on its own candidate branch. Returns the branch + commit count. */
async function generate(
  issue: Issue,
  k: number,
  agent: LabeledAgent,
): Promise<{ branch: string; commits: number }> {
  const branch = candidateBranch(issue, k);
  const result = await sandcastle.run({
    name: `generate-${issue.id}-${k}`,
    sandbox: docker(),
    agent: agent.provider,
    maxIterations: 1,
    promptFile: ".sandcastle/generate.md",
    // Issue body only — generators must never see the ranking metrics.
    promptArgs: {
      ISSUE_ID: issue.id,
      ISSUE_TITLE: issue.title,
      ISSUE_BODY: issue.body,
    },
    branchStrategy: { type: "branch", branch, baseBranch: issueBranch(issue) },
    idleTimeoutSeconds: GENERATE_TIMEOUT,
  });
  return { branch, commits: result.commits.length };
}

/** Critic node — writes & commits `.sandcastle/review.json` on the winner branch. May veto, never approves. */
async function critique(winner: string): Promise<void> {
  console.log(`  critic model: ${CRITIC_AGENT.label}`);
  await sandcastle.run({
    name: "critique",
    sandbox: docker(),
    agent: CRITIC_AGENT.provider,
    maxIterations: 1,
    promptFile: ".sandcastle/critique.md",
    branchStrategy: { type: "branch", branch: winner },
    idleTimeoutSeconds: CRITIC_TIMEOUT,
  });
}

/** Read the critic's verdict host-side from the committed file — never from stdout. */
function readReview(winner: string): ReviewItem[] {
  const r = git(["show", `${winner}:.sandcastle/review.json`]);
  if (r.status !== 0) return [];
  try {
    const parsed: unknown = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? (parsed as ReviewItem[]) : [];
  } catch {
    return [];
  }
}

/** Revise node — applies ONLY the listed fixes on the winner branch. */
async function revise(winner: string, items: ReviewItem[]): Promise<void> {
  console.log(`  revise model: ${REVISE_AGENT.label}`);
  await sandcastle.run({
    name: "revise",
    sandbox: docker(),
    agent: REVISE_AGENT.provider,
    maxIterations: 1,
    promptFile: ".sandcastle/revise.md",
    promptArgs: { REVIEW_JSON: JSON.stringify(items, null, 2) },
    branchStrategy: { type: "branch", branch: winner },
    idleTimeoutSeconds: REVISE_TIMEOUT,
  });
}

// ---------------------------------------------------------------------------
// Per-issue orchestration
// ---------------------------------------------------------------------------

/** Log the single mandated final line and return the verdict. */
function finish(
  branch: string,
  status: Status,
  reason: string,
): { status: Status; branch: string } {
  console.log(`RESULT  ${status.padEnd(20)} ${branch}  (${reason})`);
  return { status, branch };
}

function mergeAndCloseIssue(
  issue: Issue,
  issueBranchName: string,
  launchBranch: string,
  status: Status,
  successReason: string,
): { status: Status; branch: string } {
  const merge = mergeIntoLaunchBranch(issueBranchName, launchBranch);
  if (!merge.ok) {
    return finish(
      launchBranch,
      "needs-human",
      `local merge of ${issueBranchName} failed: ${merge.error}`,
    );
  }
  console.log(`  ✓ merged ${issueBranchName} into ${launchBranch}`);

  const close = closeIssue(issue);
  if (!close.ok) {
    return finish(
      launchBranch,
      "needs-human",
      `merged ${issueBranchName} into ${launchBranch}, but close failed: ${close.error}`,
    );
  }
  console.log(`  ✓ closed issue ${issue.id}`);

  return finish(launchBranch, status, successReason);
}

async function processIssue(
  issue: Issue,
  launchBranch: string,
): Promise<{ status: Status; branch: string }> {
  const target = issueBranch(issue);
  ensureBranch(target, BASE_REF);

  if (commitsAhead(target, launchBranch) > 0) {
    console.log(
      `  existing ${target} has commits not in ${launchBranch}; merging before generating candidates`,
    );
    return mergeAndCloseIssue(
      issue,
      target,
      launchBranch,
      "clean",
      `merged existing ${target} and closed issue`,
    );
  }

  // 1. Best-of-N generate (parallel; one failing generator must not sink the rest).
  const lineup = generatorLineup(N);
  for (const [i, agent] of lineup.entries()) {
    console.log(`  cand-${i + 1} generator model: ${agent.label}`);
  }
  const settled = await Promise.allSettled(
    lineup.map((agent, i) => generate(issue, i + 1, agent)),
  );
  const candidateBranches: string[] = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(`  ✗ cand-${i + 1} generation failed: ${outcome.reason}`);
    } else if (outcome.value.commits === 0) {
      console.log(`  ✗ cand-${i + 1} produced no commits`);
    } else {
      candidateBranches.push(outcome.value.branch);
    }
  }
  if (candidateBranches.length === 0) {
    return finish(target, "needs-human", "no candidate produced commits");
  }

  // Steps 2-7 run their deterministic checks inside a single per-issue container.
  return withIssueContainer(issue, async (container) => {
    // 2. Deterministic gate, per candidate, in order.
    const survivors: Candidate[] = [];
    for (const [i, branch] of candidateBranches.entries()) {
      const result = await gate(container, branch, target);
      if (result.passed) {
        survivors.push({
          k: i + 1,
          branch,
          metrics: await metrics(container, branch, target),
        });
        console.log(`  ✓ ${branch} passed the gate`);
      } else {
        console.log(`  ✗ ${branch} failed gate: ${result.failures.join("; ")}`);
      }
    }
    if (survivors.length === 0) {
      return finish(target, "needs-human", "no candidate passed the gate");
    }

    // 3. Dispersion check on survivors (do not regenerate).
    if (dispersion(survivors)) {
      return finish(
        target,
        "needs-human",
        "metrics dispersed — issue underspecified",
      );
    }

    // 4 + 5. Rank and select the whole winner.
    const winnerCand = rank(survivors);
    const winner = winnerCand.branch;
    console.log(
      `  → winner ${winner} (complexity ${winnerCand.metrics.worstComplexity}, ` +
        `surface ${winnerCand.metrics.interfaceSurface}, ` +
        `+${winnerCand.metrics.netLinesAdded} lines)`,
    );

    // 6. One bounded repair, at most.
    await critique(winner);
    const review = readReview(winner);
    if (review.some((r) => r.severity === "blocker")) {
      return finish(target, "needs-human", "critic vetoed the winner");
    }

    let status: Status = "clean";
    const material = review.filter((r) => r.severity === "material");
    if (material.length > 0) {
      const preRepair = tipSha(winner);
      await revise(winner, material);

      // The repair must not push any function back over the ceiling.
      const post = await metrics(container, winner, target);
      if (post.worstComplexity > COMPLEXITY_CEILING) {
        resetBranch(winner, preRepair);
        console.log(
          `  repair breached the ceiling (${post.worstComplexity}) — discarded, ` +
            `keeping pre-repair winner`,
        );
      } else {
        const reGate = await gate(container, winner, target);
        if (!reGate.passed) {
          return finish(
            target,
            "needs-human",
            `gate red after repair: ${reGate.failures.join("; ")}`,
          );
        }
        status = "passed-after-repair";
      }
    }

    // 7. Verdict from the gate: fast-forward merge the winner to the issue
    // branch, merge that local issue branch into the launch branch, then close.
    if (!ffMerge(target, winner)) {
      return finish(
        target,
        "needs-human",
        `fast-forward merge into ${target} failed`,
      );
    }
    return mergeAndCloseIssue(
      issue,
      target,
      launchBranch,
      status,
      status === "passed-after-repair"
        ? `merged ${target} after one repair and closed issue`
        : `merged ${target} clean and closed issue`,
    );
  });
}

// ---------------------------------------------------------------------------
// Sequential main loop
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const issues = await fetchIssues();
  if (issues.length === 0) {
    console.log("No ready-to-work issues.");
    return;
  }
  const launchBranch = currentBranch();
  for (const issue of issues) {
    console.log(`\n=== Issue ${issue.id}: ${issue.title} ===`);
    try {
      await processIssue(issue, launchBranch);
    } catch (err) {
      // A node or a host check threw — the gate never went green for this
      // issue, so it is needs-human. Log the mandated line and keep going.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  errored: ${message}`);
      finish(issueBranch(issue), "needs-human", "orchestrator error");
    }
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
