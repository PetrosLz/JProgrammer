import fs from "node:fs";
import path from "node:path";

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
    name: "Demo Cafe semantic business snapshot is unchanged",
    run: () => {
      assertDemoCafeSemanticSnapshot(readText("src/renderer/services/demoData.ts"));
    }
  },
  {
    name: "CI installs solver runtime and runs scheduler verification suites",
    run: () => {
      assertCiSchedulerRuntimeConfiguration(readText(".github/workflows/ci.yml"));
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

function assertDemoCafeSemanticSnapshot(content: string): void {
  assertIncludes(content, 'business_name: "Demo Cafe"', "Demo business name changed");
  assertIncludes(content, 'business_type: "Cafe / bar"', "Demo business type changed");
  assertIncludes(content, 'timezone: "Europe/Athens"', "Demo timezone changed");

  assertArrayEqual(
    extractNamedRows(extractSection(content, "async function createRoles", "async function createShiftTemplates")),
    [
      "bar:Bar",
      "waiter:Waiter",
      "kitchen:Kitchen",
      "cashier:Cashier",
      "manager:Manager"
    ],
    "Demo role names changed"
  );
  assertArrayEqual(
    extractShiftRows(extractSection(content, "async function createShiftTemplates", "async function createEmployees")),
    [
      "morning:Morning:08:00-16:00",
      "evening:Evening:16:00-22:00",
      "saturdayEvening:Saturday Evening:16:00-00:00"
    ],
    "Demo shift templates changed"
  );
  assertArrayEqual(
    extractEmployeeRows(extractSection(content, "async function createEmployees", "async function createEmployeeRoles")),
    [
      "maria:Maria Papadopoulou",
      "giorgos:Giorgos Antoniou",
      "eleni:Eleni Nikolaou",
      "nikos:Nikos Stavrou",
      "sofia:Sofia Markaki",
      "kostas:Kostas Markou",
      "anna:Anna Georgiou",
      "dimitris:Dimitris Ioannou"
    ],
    "Demo employees changed"
  );
  assertArrayEqual(
    extractEmployeeRoleRows(extractSection(content, "async function createEmployeeRoles", "async function createEmployeeWorkRules")),
    [
      "maria:cashier:some_experience",
      "maria:bar:some_experience",
      "giorgos:bar:some_experience",
      "eleni:waiter:some_experience",
      "nikos:kitchen:some_experience",
      "anna:bar:some_experience",
      "anna:manager:some_experience",
      "kostas:kitchen:some_experience",
      "kostas:waiter:no_experience",
      "dimitris:waiter:some_experience",
      "dimitris:cashier:some_experience",
      "sofia:waiter:some_experience"
    ],
    "Demo employee-role combinations changed"
  );
  assertArrayEqual(
    extractWorkRuleRows(extractSection(content, "async function createEmployeeWorkRules", "async function createEmployeeConstraints")),
    [
      "maria:5:8:8:true",
      "giorgos:5:8:8:false",
      "eleni:5:6:6:true",
      "nikos:5:8:8:true",
      "anna:5:6:6:true",
      "kostas:8:8:8:true",
      "dimitris:4:8:8:false",
      "sofia:4:6:6:true"
    ],
    "Demo work rules changed"
  );
  assertArrayEqual(
    extractOpeningRows(content),
    [
      "1:08:00-22:00",
      "2:08:00-22:00",
      "3:08:00-22:00",
      "4:08:00-22:00",
      "5:08:00-22:00",
      "6:08:00-00:00",
      "0:10:00-20:00"
    ],
    "Demo opening hours changed"
  );
  assertArrayEqual(
    extractConstraintRows(extractSection(content, "async function createEmployeeConstraints", "async function createEmployeeShiftAvailability")),
    [
      "giorgos:0:cannot_work",
      "dimitris:0:cannot_work"
    ],
    "Demo day constraints changed"
  );
  assertArrayEqual(
    extractAvailabilityRows(extractSection(content, "async function createEmployeeShiftAvailability", "async function createTimeOff")),
    [
      "eleni:1,2,3,4,5:morning:cannot_work",
      "eleni:1,2,3,4,5:evening:prefers_to_work",
      "eleni:6:saturdayEvening:available",
      "sofia:1,2,3,4,5:morning:prefers_to_work",
      "sofia:1,2,3,4,5:evening:cannot_work",
      "sofia:0:morning:available",
      "anna:6:saturdayEvening:prefers_to_work"
    ],
    "Demo shift availability changed"
  );
  assertArrayEqual(
    extractRequirementRows(extractSection(content, "async function createStaffingRequirements", "function shiftTime")),
    [
      "dayOfWeek:morning:bar:1:no_experience:0",
      "dayOfWeek:morning:waiter:1:no_experience:0",
      "dayOfWeek:morning:kitchen:1:some_experience:0",
      "dayOfWeek:evening:bar:1:no_experience:0",
      "dayOfWeek:evening:waiter:1:no_experience:0",
      "6:morning:bar:2:no_experience:1",
      "6:morning:waiter:2:no_experience:1",
      "6:morning:kitchen:1:some_experience:0",
      "6:morning:cashier:1:some_experience:0",
      "6:saturdayEvening:bar:2:no_experience:1",
      "6:saturdayEvening:waiter:3:no_experience:1",
      "6:saturdayEvening:kitchen:2:some_experience:1",
      "6:saturdayEvening:cashier:1:some_experience:0",
      "6:saturdayEvening:manager:1:some_experience:0",
      "0:morning:bar:1:no_experience:0",
      "0:morning:waiter:1:no_experience:0",
      "0:morning:kitchen:1:some_experience:0",
      "0:evening:waiter:1:no_experience:0"
    ],
    "Demo staffing requirements changed"
  );
}

function assertCiSchedulerRuntimeConfiguration(content: string): void {
  for (const expected of [
    "actions/setup-python@v5",
    'python-version: "3.12"',
    "python -m pip install -r solver/requirements.txt",
    "npm run test:solver",
    "npm run test:scheduler",
    "npm run test:migrations",
    "npm run test:time-model",
    "npm run test:randomized",
    "npm run audit:scheduler",
    "npm run benchmark:scheduler",
    "npm run benchmark:scheduler:stress",
    "JPROGRAMMER_STRESS_TIERS: small,medium"
  ]) {
    assertIncludes(content, expected, `CI scheduler/runtime configuration missing: ${expected}`);
  }
}

function extractSection(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not extract section ${startMarker}`);
  }
  return content.slice(start, end);
}

function extractNamedRows(section: string): string[] {
  return [...section.matchAll(/\{\s*key:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g)].map(
    (match) => `${match[1]}:${match[2]}`
  );
}

function extractShiftRows(section: string): string[] {
  return [...section.matchAll(/key:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*startTime:\s*"([^"]+)",\s*endTime:\s*"([^"]+)"/gs)].map(
    (match) => `${match[1]}:${match[2]}:${match[3]}-${match[4]}`
  );
}

function extractEmployeeRows(section: string): string[] {
  return [...section.matchAll(/key:\s*"([^"]+)",\s*firstName:\s*"([^"]+)",\s*lastName:\s*"([^"]+)"/gs)].map(
    (match) => `${match[1]}:${match[2]} ${match[3]}`
  );
}

function extractEmployeeRoleRows(section: string): string[] {
  const rows: string[] = [];
  for (const block of section.matchAll(/employee:\s*"([^"]+)",\s*roles:\s*\[([\s\S]*?)\]\s*\}/g)) {
    for (const role of block[2].matchAll(/role:\s*"([^"]+)",\s*experienceLevel:\s*"([^"]+)"/g)) {
      rows.push(`${block[1]}:${role[1]}:${role[2]}`);
    }
  }
  return rows;
}

function extractWorkRuleRows(section: string): string[] {
  return [...section.matchAll(/\{\s*employee:\s*"([^"]+)",\s*maxShiftsPerWeek:\s*(\d+),\s*maxHoursPerDay:\s*(\d+),\s*targetHoursPerDay:\s*(\d+),\s*canWorkWeekends:\s*(true|false)\s*\}/g)].map(
    (match) => `${match[1]}:${match[2]}:${match[3]}:${match[4]}:${match[5]}`
  );
}

function extractOpeningRows(content: string): string[] {
  return [...extractSection(content, "async function createOpeningHours", "async function createRoles").matchAll(/\{\s*dayOfWeek:\s*(\d),\s*openTime:\s*"([^"]+)",\s*closeTime:\s*"([^"]+)"/g)].map(
    (match) => `${match[1]}:${match[2]}-${match[3]}`
  );
}

function extractConstraintRows(section: string): string[] {
  return [...section.matchAll(/\{\s*employee:\s*"([^"]+)",\s*dayOfWeek:\s*(\d),\s*type:\s*"([^"]+)"/g)].map(
    (match) => `${match[1]}:${match[2]}:${match[3]}`
  );
}

function extractAvailabilityRows(section: string): string[] {
  return [...section.matchAll(/employee:\s*"([^"]+)",\s*days:\s*\[([^\]]+)\],\s*shifts:\s*\[([^\]]+)\],\s*type:\s*"([^"]+)"/gs)].map(
    (match) =>
      `${match[1]}:${match[2].replace(/\s/g, "")}:${match[3].replace(/\s|"/g, "")}:${match[4]}`
  );
}

function extractRequirementRows(section: string): string[] {
  const rows: string[] = [];

  for (const line of section.split(/\r?\n/)) {
    if (!line.includes("addRequirement({")) {
      continue;
    }

    const dayOfWeek =
      line.match(/dayOfWeek:\s*([^,\s}]+)/)?.[1] ??
      (/\{\s*dayOfWeek\s*,/.test(line) ? "dayOfWeek" : null);
    const shift = line.match(/shift:\s*"([^"]+)"/)?.[1];
    const role = line.match(/role:\s*"([^"]+)"/)?.[1];
    const requiredCount = line.match(/requiredCount:\s*(\d+)/)?.[1];

    if (!dayOfWeek || !shift || !role || !requiredCount) {
      continue;
    }

    const minimumExperience =
      line.match(/minimumExperienceLevel:\s*"([^"]+)"/)?.[1] ?? "no_experience";
    const experiencedRequired =
      line.match(/experiencedRequiredCount:\s*(\d+)/)?.[1] ?? "0";
    rows.push(
      `${dayOfWeek}:${shift}:${role}:${requiredCount}:${minimumExperience}:${experiencedRequired}`
    );
  }

  return rows;
}

function assertArrayEqual(actual: string[], expected: string[], message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}:\nexpected ${expectedJson}\nactual   ${actualJson}`);
  }
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
