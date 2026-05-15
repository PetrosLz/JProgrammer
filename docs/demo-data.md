# Demo Data

Use **Load Demo Data** to replace the current local SQLite data with a complete
sample business named **Demo Cafe**.

The demo includes:

- Opening hours for Monday through Sunday.
- Roles: Bar, Waiter, Kitchen, Cashier, Manager.
- Shift templates: Morning, Evening, Saturday Evening.
- Eight employees with mixed role assignments.
- Work rules, day constraints, preferences, and time off.
- Shift-level availability examples such as morning-only, weekday-evening
  preference, and Saturday-evening restrictions.
- Role-specific skill levels, lead-role flags, and preferred roles for team
  balance testing.
- Staffing requirements with heavier Saturday demand.

To test scheduling quickly:

1. Click **Load Demo Data** from the first-run setup screen or Dashboard.
2. Confirm that existing local data can be replaced.
3. Open **Generate Program**.
4. Select a date in the week of `2026-05-11` to `2026-05-17`.
5. Click **Generate Program**.

Expected result: the app should create a mostly filled proposed program for Demo
Cafe, with Saturday covered much better than a simple date-order assignment. The
demo still includes time off, cannot-work constraints, high Saturday demand, and
limited Manager coverage, so a small number of warnings or unfilled shifts can
still appear for realistic testing.
