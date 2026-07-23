# JProgrammer Weekly Manual Acceptance Test Plan

Use this gate before large weekly manual testing. For every case, compare Schedule View, database counts and PDFs where relevant. Manager status means:

- `Excellent`: all requested slots are assigned and hard validation is clean.
- `Understaffed`: at least one slot is unfilled, but all assignments obey hard rules.
- `Invalid`: duplicate/corrupt data or any hard validation issue exists.

| Test ID | Area | Setup | Actions | Expected result | Actual result | Pass / Fail | Notes | Screenshot reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W-001 | Fresh setup | Reset local data. | Complete setup manually with a cafe-style business. | Setup saves, schema starts clean, Profile opens, no old phase/TODO text appears. UI values match stored business settings. |  |  |  |  |
| W-002 | No employees | Create roles, shifts and requirements, but no employees. | Generate a weekly program. | Generation completes without crash. Snapshot is `Understaffed`, assigned slots are 0, unfilled equals total slots, hard issues are 0. UI and manager PDF counts agree. |  |  |  |  |
| W-003 | No requirements | Keep employees/roles but remove active requirements. | Generate a weekly program. | No normal slots are created. Manager-facing warning explains no staffing requirements. UI/database/PDF all show 0 slots. |  |  |  |  |
| W-004 | Fully feasible week | Use enough employees with matching roles, availability and limits. | Generate a normal week. | Status is `Excellent`, coverage is 100%, hard issues are 0, CP-SAT proof is shown only if actually proven. Team and manager PDFs match UI counts/hours. |  |  |  |  |
| W-005 | Understaffed week | Reduce available employees or role capacity. | Generate a weekly program. | Status is `Understaffed`, hard issues are 0, shortages are explained by date/shift/role. UI/database/PDF assigned and unfilled counts agree. |  |  |  |  |
| W-006 | Impossible individual slot | Require one role with no eligible employee. | Generate. | Slot stays unfilled, no invalid assignment is created, recommendation mentions adding role/capacity. Snapshot remains `Understaffed`. |  |  |  |  |
| W-007 | Overnight shift | Add shift `16:00-01:00` inside continuous opening hours. | Generate and export PDFs. | Slot duration is correct, display shows next-day marker, daily hours belong to start date, UI/PDF time labels agree. |  |  |  |  |
| W-008 | Adjacent split shifts | Same employee can cover `08:00-12:00` and `16:00-20:00`. | Generate or manually assign both. | Both non-overlapping shifts are allowed if daily hours and weekly shifts permit. |  |  |  |  |
| W-009 | Overlapping split shifts | Same employee is eligible for overlapping same-day slots. | Try manual assignment or generate. | Overlap is blocked. Service layer rejects hard violation. Original assignment state remains unchanged after failed manual save. |  |  |  |  |
| W-010 | Weekend restriction | Employee has `can_work_weekends = false`. | Generate a week with weekend slots. | Employee is not assigned Saturday/Sunday. Validation hard issues remain 0. |  |  |  |  |
| W-011 | Max daily hours | Employee has low `max_hours_per_day`. | Try assigning multiple same-day shifts above the limit. | UI blocks and service rejects the assignment. No partial write occurs. |  |  |  |  |
| W-012 | Max weekly shifts | Employee reaches `max_shifts_per_week`. | Generate or manually assign another slot. | Additional assignment is blocked unless a future explicit hard override path is implemented. |  |  |  |  |
| W-013 | Experience minimum | Slot requires prior experience. | Use only no-experience employees. | Slot remains unfilled or candidate is rejected. No invalid assignment is persisted. |  |  |  |  |
| W-014 | Experienced-required group composition | Coverage group requires at least one prior-experience assignment. | Generate group of 2+ slots. | Group has required prior-experience composition or remains short; validator flags invalid composition if corrupt data violates it. |  |  |  |  |
| W-015 | Employee time off | Add approved time off for an employee. | Generate matching dates. | Employee is not assigned during time off. Warnings explain shortage if caused by absence. |  |  |  |  |
| W-016 | Cannot-work day | Add day-level `cannot_work`. | Generate. | Employee is never assigned on that weekday. Manual assignment is blocked by UI and service. |  |  |  |  |
| W-017 | Time-window restriction | Add time-window unavailability. | Generate overlapping and adjacent shifts. | Overlapping shift is blocked; adjacent non-overlap is allowed. |  |  |  |  |
| W-018 | Lock assignment | Open Schedule View. | Lock one automatic assignment. | Lock indicator appears. Source remains its original origin. Database `is_locked` becomes 1. |  |  |  |  |
| W-019 | Unlock assignment | Use a locked assignment. | Unlock it. | Lock indicator disappears. Source remains unchanged. Database `is_locked` becomes 0. |  |  |  |  |
| W-020 | Rerun unchanged rules | Lock one assignment, keep rules unchanged. | Rerun from Schedule View. | New linked run is created, old run remains available, valid lock is preserved, unlocked assignments may be hints only. |  |  |  |  |
| W-021 | Rerun changed requirements | Change one requirement or shift time after original run. | Rerun. | Slots are regenerated from current config. New run metadata includes rerun source, preserved lock count, hint counts, engine, solver status, validation status and generated time. |  |  |  |  |
| W-022 | Unmappable lock | Lock assignment, then change config so the slot no longer semantically maps. | Rerun. | Rerun is blocked before persistence. No new run graph is created. User remains on old run with clear reason. |  |  |  |  |
| W-023 | CP-SAT unavailable | Run without solver IPC/OR-Tools. | Generate. | Heuristic fallback may persist a valid best-effort schedule. Engine shows `heuristic_fallback`; no optimality proof is claimed. |  |  |  |  |
| W-024 | Heuristic fallback after CP-SAT attempt | Force CP-SAT UNKNOWN/error in a test build. | Generate. | Final engine is heuristic fallback, but CP-SAT attempt status/runtime/hints are preserved in metadata and visible diagnostics. |  |  |  |  |
| W-025 | Manual assignment | Click an unfilled slot. | Assign a valid candidate. | Save succeeds, slot becomes filled, source is `manual`, validation remains passed. UI/database/PDF counts agree. |  |  |  |  |
| W-026 | Manual reassignment | Click an assigned slot. | Replace employee with another valid candidate. | Assignment, slot status and warnings update atomically. Failure restores original state. |  |  |  |  |
| W-027 | Manual removal | Click an assigned slot. | Remove employee after confirmation. | Slot becomes unfilled, warning count updates, removal is atomic. |  |  |  |  |
| W-028 | Delete run | Select a generated run. | Delete, cancel first, then confirm. | Cancel keeps data. Confirm deletes run, slots, assignments and warnings atomically. |  |  |  |  |
| W-029 | Parent run with rerun descendant | Create original run and rerun. | Delete parent or descendant. | Relationships are handled safely. No orphaned schedule graph remains. |  |  |  |  |
| W-030 | Team PDF | Use valid `Excellent` or `Understaffed` snapshot. | Export team PDF. | PDF is clean employee schedule. Total assignments and employee hours match Schedule View snapshot. |  |  |  |  |
| W-031 | Manager PDF | Use `Understaffed` snapshot. | Export manager PDF. | PDF includes status, engine, solver result, validation, coverage, proof, locked/manual counts, issues and recommendations. Counts match UI/database. |  |  |  |  |
| W-032 | Duplicate/corrupt legacy assignment | Inject two active assignments for one slot in a test database. | Open Schedule View and export manager PDF. | Schedule View does not crash. Snapshot is `Invalid`, duplicate is shown explicitly, team PDF is blocked or marked invalid. |  |  |  |  |
| W-033 | Malformed legacy slot time | Inject malformed slot time such as `24:00` or `12:60`. | Open Schedule View and export manager PDF. | UI/PDF do not crash. Snapshot is `Invalid`; controlled validation message appears. |  |  |  |  |
| W-034 | Demo Cafe exact acceptance | Reset local data and load current Demo Cafe. | Generate week `2026-05-18` to `2026-05-24`. | Current deterministic baseline: 40 requested slots, 28 unique assigned, 12 unfilled, 0 hard violations, status `Understaffed`, engine `heuristic_fallback`, solver status `HEURISTIC_FALLBACK`, coverage proof false, coverage ceiling 28, Saturday unfilled slots 12. UI/database/PDF must agree. |  |  |  |  |

## Required Automated Commands

Run all commands before manual acceptance:

```powershell
npm.cmd run test:solver
npm.cmd run test:scheduler
npm.cmd run test:demo-cafe
npm.cmd run test:migrations
npm.cmd run test:time-model
npm.cmd run test:randomized
npm.cmd run audit:scheduler
npm.cmd run benchmark:scheduler
npm.cmd run benchmark:scheduler:stress
npm.cmd run build
git diff --check
git status --short
git diff --stat
git ls-files .venv-solver
git ls-files | Select-String -Pattern '(__pycache__|\.py[co]$)'
```
