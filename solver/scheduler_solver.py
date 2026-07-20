from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from typing import Any, Dict, List, Tuple

from protocol import build_result, validate_request


def main() -> int:
    started_at = time.monotonic()
    raw_request = sys.stdin.read()

    try:
        payload = json.loads(raw_request)
    except Exception as error:
        result = build_result(
            request_id="unknown",
            assignments=[],
            status="MODEL_INVALID",
            covered_slots=0,
            total_slots=0,
            runtime_ms=elapsed_ms(started_at),
            message=f"Malformed JSON request: {error}",
        )
        print(json.dumps(result, separators=(",", ":")), flush=True)
        return 0

    request_id, validation_errors = validate_request(payload)
    if validation_errors:
        result = build_result(
            request_id=request_id,
            assignments=[],
            status="MODEL_INVALID",
            covered_slots=0,
            total_slots=len(payload.get("slots", [])) if isinstance(payload, dict) else 0,
            runtime_ms=elapsed_ms(started_at),
            message=" ".join(validation_errors),
        )
        print(json.dumps(result, separators=(",", ":")), flush=True)
        return 0

    try:
        result = solve(payload, started_at)
    except ImportError as error:
        result = build_result(
            request_id=request_id,
            assignments=[],
            status="UNKNOWN",
            covered_slots=0,
            total_slots=len(payload["slots"]),
            runtime_ms=elapsed_ms(started_at),
            message=f"OR-Tools is unavailable: {error}",
        )
    except Exception as error:
        print(f"CP-SAT solver failure: {error}", file=sys.stderr, flush=True)
        result = build_result(
            request_id=request_id,
            assignments=[],
            status="UNKNOWN",
            covered_slots=0,
            total_slots=len(payload["slots"]),
            runtime_ms=elapsed_ms(started_at),
            message=f"CP-SAT solver failed: {error}",
        )

    print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0


def solve(payload: Dict[str, Any], started_at: float) -> Dict[str, Any]:
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    employees = sorted(payload["employees"], key=lambda item: item["id"])
    slots = sorted(payload["slots"], key=lambda item: item["id"])
    employee_by_id = {employee["id"]: employee for employee in employees}
    slot_by_id = {slot["id"]: slot for slot in slots}
    role_experience_rank = build_role_experience_rank(payload["employeeRoles"])
    eligibility_pairs = sorted(
        {
            (pair["employeeId"], pair["slotId"])
            for pair in payload["eligibility"]
            if employee_by_id[pair["employeeId"]]["isActive"] is True
        }
    )
    variables: Dict[Tuple[str, str], Any] = {}

    for employee_id, slot_id in eligibility_pairs:
        variables[(employee_id, slot_id)] = model.NewBoolVar(
            safe_var_name(f"x_{employee_id}_{slot_id}")
        )

    add_slot_capacity_constraints(model, variables, slots, employees)
    add_locked_assignment_constraints(model, variables, payload["existingAssignments"], slots, employees)
    add_overlap_constraints(model, variables, slots, employees, slot_by_id)
    add_daily_hour_constraints(model, variables, slots, employees, employee_by_id, slot_by_id)
    add_weekly_shift_constraints(model, variables, employees)
    add_group_experience_constraints(
        model,
        variables,
        slots,
        role_experience_rank,
        slot_by_id,
    )

    objective_terms = [variables[key] for key in sorted(variables)]
    model.Maximize(sum(objective_terms) if objective_terms else 0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.1, float(payload["timeoutSeconds"]))
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0

    status = solver.Solve(model)
    mapped_status = map_solver_status(status, cp_model)
    assignments: List[Dict[str, str]] = []

    if mapped_status in {"OPTIMAL", "FEASIBLE"}:
        for employee_id, slot_id in sorted(variables):
            if solver.BooleanValue(variables[(employee_id, slot_id)]):
                assignments.append(
                    {
                        "scheduleSlotId": slot_id,
                        "employeeId": employee_id,
                    }
                )

    return build_result(
        request_id=payload["requestId"],
        assignments=assignments,
        status=mapped_status,
        covered_slots=len(assignments),
        total_slots=len(slots),
        runtime_ms=elapsed_ms(started_at),
        message=None if mapped_status in {"OPTIMAL", "FEASIBLE"} else f"CP-SAT status: {mapped_status}",
    )


def build_role_experience_rank(employee_roles: List[Dict[str, Any]]) -> Dict[Tuple[str, str], int]:
    ranks: Dict[Tuple[str, str], int] = {}
    for role in employee_roles:
        level = role.get("experienceLevel")
        ranks[(role["employeeId"], role["roleId"])] = 1 if level == "no_experience" else 2
    return ranks


def add_slot_capacity_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]]) -> None:
    for slot in slots:
        terms = [
            variables[(employee["id"], slot["id"])]
            for employee in employees
            if (employee["id"], slot["id"]) in variables
        ]
        if terms:
            model.Add(sum(terms) <= 1)


def add_locked_assignment_constraints(model: Any, variables: Dict[Tuple[str, str], Any], existing_assignments: List[Dict[str, Any]], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]]) -> None:
    employee_ids = [employee["id"] for employee in employees]
    slot_ids = {slot["id"] for slot in slots}

    for assignment in existing_assignments:
        if assignment.get("locked") is not True:
            continue

        employee_id = assignment["employeeId"]
        slot_id = assignment["slotId"]
        if slot_id not in slot_ids:
            continue

        model.Add(variables[(employee_id, slot_id)] == 1)
        for other_employee_id in employee_ids:
            if other_employee_id != employee_id and (other_employee_id, slot_id) in variables:
                model.Add(variables[(other_employee_id, slot_id)] == 0)


def add_overlap_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]], slot_by_id: Dict[str, Dict[str, Any]]) -> None:
    for employee in employees:
        employee_slots = [
            slot
            for slot in slots
            if (employee["id"], slot["id"]) in variables
        ]
        for index, left in enumerate(employee_slots):
            for right in employee_slots[index + 1:]:
                if intervals_overlap(left, right):
                    model.Add(
                        variables[(employee["id"], left["id"])]
                        + variables[(employee["id"], right["id"])]
                        <= 1
                    )


def add_daily_hour_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]], employee_by_id: Dict[str, Dict[str, Any]], slot_by_id: Dict[str, Dict[str, Any]]) -> None:
    dates = sorted({slot["date"] for slot in slots})

    for employee in employees:
        for date in dates:
            terms = [
                slot_by_id[slot_id]["durationMinutes"] * variables[(employee["id"], slot_id)]
                for employee_id, slot_id in sorted(variables)
                if employee_id == employee["id"] and slot_by_id[slot_id]["date"] == date
            ]
            if terms:
                model.Add(sum(terms) <= employee["maxHoursPerDayMinutes"])


def add_weekly_shift_constraints(model: Any, variables: Dict[Tuple[str, str], Any], employees: List[Dict[str, Any]]) -> None:
    for employee in employees:
        terms = [
            variable
            for (employee_id, _slot_id), variable in sorted(variables.items())
            if employee_id == employee["id"]
        ]
        if terms:
            model.Add(sum(terms) <= employee["maxShiftsPerWeek"])


def add_group_experience_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], role_experience_rank: Dict[Tuple[str, str], int], slot_by_id: Dict[str, Dict[str, Any]]) -> None:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for slot in slots:
        groups[slot["requirementGroupId"]].append(slot)

    for group_id, group_slots in sorted(groups.items()):
        required = max(int(slot["experiencedRequiredCount"]) for slot in group_slots)
        if required <= 0:
            continue

        group_slot_ids = {slot["id"] for slot in group_slots}
        assigned_terms = [
            variable
            for (_employee_id, slot_id), variable in sorted(variables.items())
            if slot_id in group_slot_ids
        ]
        experienced_terms = [
            variable
            for (employee_id, slot_id), variable in sorted(variables.items())
            if slot_id in group_slot_ids
            and role_experience_rank.get((employee_id, slot_by_id[slot_id]["roleId"]), 1) >= 2
        ]

        if not assigned_terms:
            continue

        assigned_count = sum(assigned_terms)
        experienced_count = sum(experienced_terms) if experienced_terms else 0
        threshold_count = min(required, len(group_slots))
        threshold_bools = []

        for index in range(1, threshold_count + 1):
            active = model.NewBoolVar(safe_var_name(f"group_{group_id}_assigned_at_least_{index}"))
            model.Add(assigned_count >= index).OnlyEnforceIf(active)
            model.Add(assigned_count <= index - 1).OnlyEnforceIf(active.Not())
            threshold_bools.append(active)

        model.Add(experienced_count >= sum(threshold_bools))


def intervals_overlap(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    return (
        int(left["absoluteStartMinute"]) < int(right["absoluteEndMinute"])
        and int(right["absoluteStartMinute"]) < int(left["absoluteEndMinute"])
    )


def map_solver_status(status: int, cp_model: Any) -> str:
    if status == cp_model.OPTIMAL:
        return "OPTIMAL"
    if status == cp_model.FEASIBLE:
        return "FEASIBLE"
    if status == cp_model.INFEASIBLE:
        return "INFEASIBLE"
    if status == cp_model.MODEL_INVALID:
        return "MODEL_INVALID"
    return "UNKNOWN"


def safe_var_name(value: str) -> str:
    return "".join(char if char.isalnum() else "_" for char in value)


def elapsed_ms(started_at: float) -> int:
    return int(round((time.monotonic() - started_at) * 1000))


if __name__ == "__main__":
    raise SystemExit(main())
