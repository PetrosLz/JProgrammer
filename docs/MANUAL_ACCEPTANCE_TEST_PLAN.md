# JProgrammer Manual Acceptance Test Plan

Use this checklist before calling a weekly build manager-ready.

## Setup And Data

1. Start the app from a clean local database.
2. Complete setup manually with a cafe-style business, or load Demo Cafe.
3. Confirm the app opens without migration warnings except intentional legacy shift review badges.
4. Confirm the latest schema version is 6 after startup.

## Weekly Generation

1. Open Generate Program.
2. Select one normal operating week.
3. Generate a weekly program.
4. Confirm the UI stays responsive and generation completes within the bounded runtime.
5. Confirm no partial automatic result is shown if persistence fails during a forced test build.

Expected manager statuses:

- Excellent: every requested slot is assigned and hard validation is clean.
- Understaffed: one or more slots remain unfilled, but all assignments obey hard rules.
- Invalid: any hard validation issue exists.

Do not use CP-SAT status alone as the manager status.

## Demo Cafe Acceptance

1. Reset local data.
2. Load Demo Cafe.
3. Generate the week used by the manual test scenario.
4. Confirm requested slots are realistic for the staffing plan.
5. Confirm the result is Understaffed when the business lacks enough valid coverage.
6. Confirm hard violations are zero.
7. Confirm diagnostics explain the exact missing date, shift, role, requested count, assigned count, and likely reason.

## Manual Assignment Editing

1. Open Schedule View.
2. Edit an assigned slot.
3. Replace the employee with a valid candidate and save.
4. Try an employee without the required role and confirm save is blocked.
5. Try an overlapping shift and confirm save is blocked.
6. Try exceeding max daily hours or max weekly shifts and confirm save is blocked.
7. Remove an assignment and confirm the slot becomes unfilled.
8. Confirm manual writes use source `manual`.

## Assignment Lock Metadata

1. Confirm new databases have `schedule_assignments.is_locked`.
2. Confirm new databases have `schedule_assignments.source`.
3. Confirm legacy manual assignments migrate to source `manual`.
4. Confirm legacy automatic assignments migrate to source `automatic_heuristic`.
5. Confirm locks default to `0`.

Full rerun preservation of locked assignments is still a follow-up workflow unless the current UI build exposes a lock/rerun action.

## Diagnostics And Reports

1. Confirm Schedule View shows unfilled positions clearly.
2. Confirm manager PDF does not include raw scoring logs as normal content.
3. Confirm technical solver details, if shown, are separated from manager fixes.
4. Confirm corrupt legacy time ranges show controlled review text rather than crashing.

## Delete And Reset Safety

1. Delete a generated program and cancel first.
2. Confirm no records are deleted after cancel.
3. Delete again and confirm slots, assignments, and warnings for that run are removed.
4. Reset local data only after confirming the custom danger modal.
5. Confirm setup returns to first-launch state.

## Required Commands

Run these before manual acceptance:

```powershell
npm.cmd run test:solver
npm.cmd run test:scheduler
npm.cmd run test:migrations
npm.cmd run test:time-model
npm.cmd run test:randomized
npm.cmd run audit:scheduler
npm.cmd run benchmark:scheduler
npm.cmd run benchmark:scheduler:stress
npm.cmd run build
```
