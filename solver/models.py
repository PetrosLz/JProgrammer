from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SolverPair:
    employee_id: str
    slot_id: str
