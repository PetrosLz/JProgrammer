import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type AuditCheck = {
  name: string;
  run: () => void;
};

const checks: AuditCheck[] = [
  {
    name: "fresh schema exposes explicit opening-hours 24-hour mode",
    run: () => {
      const initSql = readText("src/main/migrations/init.sql");
      assertIncludes(initSql, "is_24_hours", "opening_hours.is_24_hours missing");
      assertNotIncludes(initSql, "break_minutes", "fresh schema still contains break_minutes");
      assertNotIncludes(initSql, "priority TEXT", "fresh schema still contains staffing priority");
    }
  },
  {
    name: "active scheduler source does not use deprecated weekly/consecutive rules",
    run: () => {
      const files = listFiles("src/renderer/services/scheduler", [".ts", ".tsx"]);
      assertNoMatches(files, [
        "break_minutes",
        "min_hours_between_shifts",
        "max_consecutive_days",
        "min_hours_per_week",
        "max_hours_per_week",
        "target_hours_per_week",
        "preferred_hours_per_week",
        "min_days_per_week",
        "max_days_per_week",
        "target_days_per_week"
      ]);
    }
  },
  {
    name: "manual overnight controls are not shown in setup/profile/shift-template UI",
    run: () => {
      assertNoMatches(
        [
          "src/renderer/src/pages/ProfilePage.tsx",
          "src/renderer/src/pages/SetupWizard.tsx",
          "src/renderer/src/pages/ShiftTemplatesPage.tsx"
        ],
        ["label=\"Overnight\"", ">Overnight<", "Περνάει τα μεσάνυχτα"]
      );
    }
  },
  {
    name: "role criticality is not inferred from hard-coded role names in active scheduler",
    run: () => {
      const files = listFiles("src/renderer/services/scheduler", [".ts", ".tsx"]);
      assertNoMatches(files, [
        "\"Cashier\"",
        "\"Kitchen\"",
        "\"Manager\"",
        "'Cashier'",
        "'Kitchen'",
        "'Manager'"
      ]);
    }
  },
  {
    name: "Demo Cafe business data changed only for 24-hour schema compatibility",
    run: () => {
      const headDemoData = execFileSync(
        "git",
        ["show", "HEAD:src/renderer/services/demoData.ts"],
        { encoding: "utf8" }
      );
      const currentDemoData = readText("src/renderer/services/demoData.ts");
      const expected = normalizeDemoDataFor24HourAudit(headDemoData);
      const actual = normalizeDemoDataFor24HourAudit(currentDemoData);

      if (expected !== actual) {
        throw new Error(
          "Demo Cafe data changed beyond allowed is_24_hours/derived overnight compatibility edits."
        );
      }
    }
  }
];

let passed = 0;

for (const check of checks) {
  try {
    check.run();
    passed += 1;
    console.log(`ok ${passed} - ${check.name}`);
  } catch (error) {
    console.error(`not ok - ${check.name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`\n${passed}/${checks.length} scheduler audit checks passed.`);
}

process.exit(process.exitCode ?? 0);

function assertNoMatches(files: string[], forbiddenPatterns: string[]): void {
  const failures: string[] = [];

  for (const file of files) {
    const content = readText(file);
    for (const pattern of forbiddenPatterns) {
      if (content.includes(pattern)) {
        failures.push(`${file}: ${pattern}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Forbidden active code patterns found:\n${failures.join("\n")}`);
  }
}

function assertIncludes(content: string, expected: string, message: string): void {
  if (!content.includes(expected)) {
    throw new Error(message);
  }
}

function assertNotIncludes(content: string, forbidden: string, message: string): void {
  if (content.includes(forbidden)) {
    throw new Error(message);
  }
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function normalizeDemoDataFor24HourAudit(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(
      (line) =>
        !line.includes("is_24_hours: false") &&
        !line.includes("isOvernight: boolean;") &&
        !line.trim().startsWith("isOvernight:")
    )
    .map((line) =>
      line
        .replace(/,\s*isOvernight:\s*(true|false)/g, "")
        .replace(
          "is_overnight: row.closeTime < row.openTime",
          "is_overnight: row.isOvernight"
        )
        .replace(
          "is_overnight: row.endTime < row.startTime",
          "is_overnight: row.isOvernight"
        )
    )
    .join("\n");
}

function listFiles(relativeDir: string, extensions: string[]): string[] {
  const root = path.join(process.cwd(), relativeDir);
  const result: string[] = [];

  walk(root, result, extensions);
  return result.map((file) => path.relative(process.cwd(), file).replace(/\\/g, "/"));
}

function walk(dir: string, result: string[], extensions: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, result, extensions);
      continue;
    }

    if (extensions.includes(path.extname(entry.name))) {
      result.push(fullPath);
    }
  }
}
