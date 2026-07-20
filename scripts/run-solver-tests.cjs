const { spawnSync } = require("node:child_process");

const candidates = [
  { command: "python", args: [] },
  { command: "py", args: ["-3"] },
  { command: "python3", args: [] }
];

const python = candidates.find((candidate) => {
  const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
});

if (!python) {
  console.log("Python solver tests skipped: Python runtime was not found.");
  process.exit(0);
}

const result = spawnSync(
  python.command,
  [...python.args, "-m", "unittest", "discover", "solver/tests"],
  {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  }
);

process.exit(result.status ?? 1);
