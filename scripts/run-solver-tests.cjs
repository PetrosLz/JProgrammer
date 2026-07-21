const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const candidates = [
  { command: process.env.JPROGRAMMER_TEST_PYTHON, args: [] },
  { command: process.env.JPROGRAMMER_PYTHON, args: [] },
  { command: path.join(root, ".venv-solver", "Scripts", "python.exe"), args: [] },
  { command: path.join(root, ".venv-solver", "bin", "python"), args: [] },
  { command: "py", args: ["-3.12"] },
  { command: "py", args: ["-3.11"] },
  { command: "python", args: [] },
  { command: "python3", args: [] }
].filter((candidate) => Boolean(candidate.command));

const python = candidates.find((candidate) => {
  const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
    encoding: "utf8",
    env: candidate.env ? { ...process.env, ...candidate.env } : process.env,
    windowsHide: true
  });
  if (result.status !== 0) {
    return false;
  }

  const ortools = spawnSync(
    candidate.command,
    [
      ...candidate.args,
      "-c",
      "import ortools; from ortools.sat.python import cp_model; print(ortools.__version__)"
    ],
    {
      encoding: "utf8",
      env: candidate.env ? { ...process.env, ...candidate.env } : process.env,
      windowsHide: true
    }
  );

  return ortools.status === 0;
});

if (!python) {
  console.error("Python solver tests failed: Python runtime with OR-Tools was not found.");
  process.exit(1);
}

const result = spawnSync(
  python.command,
  [...python.args, "-m", "unittest", "discover", "solver/tests"],
  {
    encoding: "utf8",
    stdio: "inherit",
    env: python.env ? { ...process.env, ...python.env } : process.env,
    windowsHide: true
  }
);

process.exit(result.status ?? 1);
