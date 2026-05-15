# Scheduler Notes

The current scheduler uses a practical hybrid approach:

- hard constraints block invalid automatic assignments
- scarce and difficult slots are scheduled before easy slots
- candidate scoring balances preferences, targets, fairness and future scarcity
- role-specific skill levels and lead flags help balance employees inside the
  same role/shift group
- a one-level repair pass can move an employee from an easier assignment to a harder unfilled slot when another employee can safely cover the easier slot

Future advanced version:
The scheduler can later be replaced or upgraded with CP-SAT / constraint optimization for stronger global optimality.
