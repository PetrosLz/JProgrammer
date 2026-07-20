from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from protocol import build_result, validate_request


@dataclass
class StageResult:
    value: int | None
    status: str
    proven_optimal: bool


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
    import ortools
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    employees = sorted(payload["employees"], key=lambda item: item["id"])
    slots = sorted(payload["slots"], key=lambda item: item["id"])
    employee_by_id = {employee["id"]: employee for employee in employees}
    slot_by_id = {slot["id"]: slot for slot in slots}
    role_experience_rank = build_role_experience_rank(payload["employeeRoles"])
    preference_scores = {
        (pair["employeeId"], pair["slotId"]): int(pair.get("preferenceScore", 0))
        for pair in payload["eligibility"]
    }
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
    add_locked_assignment_constraints(
        model, variables, payload["existingAssignments"], slots, employees
    )
    add_overlap_constraints(model, variables, slots, employees)
    add_daily_hour_constraints(model, variables, slots, employees, slot_by_id)
    add_weekly_shift_constraints(model, variables, employees)
    add_group_experience_constraints(
        model,
        variables,
        slots,
        role_experience_rank,
        slot_by_id,
    )

    hint_diagnostics = apply_hints(model, variables, payload)
    expressions = build_objective_expressions(
        model=model,
        variables=variables,
        employees=employees,
        slots=slots,
        slot_by_id=slot_by_id,
        preference_scores=preference_scores,
        hint_pairs=hint_diagnostics["acceptedPairs"],
    )
    del hint_diagnostics["acceptedPairs"]

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    deadline = started_at + max(0.1, float(payload["timeoutSeconds"]))
    objective_stages: Dict[str, StageResult] = {}
    best_assignments: List[Dict[str, str]] = []
    has_feasible_solution = False
    final_status = "UNKNOWN"

    for stage in build_stage_sequence(expressions):
        remaining_seconds = deadline - time.monotonic()
        if remaining_seconds <= 0:
            final_status = "FEASIBLE" if has_feasible_solution else "UNKNOWN"
            break

        if stage["sense"] == "maximize":
            model.Maximize(stage["expression"])
        else:
            model.Minimize(stage["expression"])

        solver.parameters.max_time_in_seconds = max(0.05, remaining_seconds)
        mapped_status = map_solver_status(solver.Solve(model), cp_model)

        if mapped_status in {"OPTIMAL", "FEASIBLE"}:
            best_assignments = extract_assignments(solver, variables)
            has_feasible_solution = True
            value = int(round(solver.Value(stage["expression"])))
            objective_stages[stage["name"]] = StageResult(
                value=value,
                status=mapped_status,
                proven_optimal=mapped_status == "OPTIMAL",
            )

            if mapped_status != "OPTIMAL":
                final_status = "FEASIBLE"
                break

            if stage["sense"] == "maximize":
                model.Add(stage["expression"] == value)
            else:
                model.Add(stage["expression"] == value)
            final_status = "OPTIMAL"
            continue

        if mapped_status in {"INFEASIBLE", "MODEL_INVALID"} and not has_feasible_solution:
            final_status = mapped_status
            objective_stages[stage["name"]] = StageResult(
                value=0,
                status=mapped_status,
                proven_optimal=False,
            )
            break

        final_status = "FEASIBLE" if has_feasible_solution else mapped_status
        objective_stages[stage["name"]] = StageResult(
            value=None,
            status=mapped_status,
            proven_optimal=False,
        )
        break

    if "coverage" not in objective_stages:
        objective_stages["coverage"] = StageResult(
            value=len(best_assignments),
            status=final_status,
            proven_optimal=False,
        )

    coverage_stage = objective_stages["coverage"]
    requested_stages = [stage["name"] for stage in build_stage_sequence(expressions)]
    full_lexicographic_optimality = (
        final_status == "OPTIMAL"
        and all(
            objective_stages.get(stage_name, StageResult(0, "UNKNOWN", False)).proven_optimal
            for stage_name in requested_stages
        )
    )

    return build_result(
        request_id=payload["requestId"],
        assignments=best_assignments,
        status=final_status,
        covered_slots=len(best_assignments),
        total_slots=len(slots),
        runtime_ms=elapsed_ms(started_at),
        message=None
        if final_status in {"OPTIMAL", "FEASIBLE"}
        else f"CP-SAT status: {final_status}",
        coverage_proven_optimal=coverage_stage.proven_optimal,
        full_lexicographic_optimality=full_lexicographic_optimality,
        objective_stages={
            name: {
                "value": stage.value,
                "status": stage.status,
                "provenOptimal": stage.proven_optimal,
            }
            for name, stage in objective_stages.items()
        },
        hint_diagnostics=hint_diagnostics,
        python_version=sys.version.split()[0],
        ortools_version=ortools.__version__,
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


def add_overlap_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]]) -> None:
    for employee in employees:
        employee_slots = [
            slot for slot in slots if (employee["id"], slot["id"]) in variables
        ]
        for index, left in enumerate(employee_slots):
            for right in employee_slots[index + 1:]:
                if intervals_overlap(left, right):
                    model.Add(
                        variables[(employee["id"], left["id"])]
                        + variables[(employee["id"], right["id"])]
                        <= 1
                    )


def add_daily_hour_constraints(model: Any, variables: Dict[Tuple[str, str], Any], slots: List[Dict[str, Any]], employees: List[Dict[str, Any]], slot_by_id: Dict[str, Dict[str, Any]]) -> None:
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


def build_objective_expressions(
    *,
    model: Any,
    variables: Dict[Tuple[str, str], Any],
    employees: List[Dict[str, Any]],
    slots: List[Dict[str, Any]],
    slot_by_id: Dict[str, Dict[str, Any]],
    preference_scores: Dict[Tuple[str, str], int],
    hint_pairs: List[Tuple[str, str]],
) -> Dict[str, Any]:
    coverage = sum(variables[key] for key in sorted(variables)) if variables else 0
    dates = sorted({slot["date"] for slot in slots})
    fairness_employee_ids = sorted(
        {
            employee_id
            for employee_id, _slot_id in variables
        }
    )

    target_deviations = []
    for employee in employees:
        target_minutes = employee.get("targetHoursPerDayMinutes")
        if target_minutes is None:
            continue

        for date in dates:
            date_vars = [
                (slot_by_id[slot_id]["durationMinutes"], variables[(employee["id"], slot_id)])
                for employee_id, slot_id in sorted(variables)
                if employee_id == employee["id"] and slot_by_id[slot_id]["date"] == date
            ]
            if not date_vars:
                continue

            worked_minutes = model.NewIntVar(0, 24 * 60, safe_var_name(f"minutes_{employee['id']}_{date}"))
            worked_day = model.NewBoolVar(safe_var_name(f"worked_{employee['id']}_{date}"))
            deviation = model.NewIntVar(0, 24 * 60, safe_var_name(f"target_dev_{employee['id']}_{date}"))
            model.Add(worked_minutes == sum(duration * variable for duration, variable in date_vars))
            model.Add(worked_minutes >= 1).OnlyEnforceIf(worked_day)
            model.Add(worked_minutes == 0).OnlyEnforceIf(worked_day.Not())
            model.AddAbsEquality(deviation, worked_minutes - int(target_minutes) * worked_day)
            target_deviations.append(deviation)

    weekly_shift_counts = {}
    weekly_minutes = {}
    for employee_id in fairness_employee_ids:
        employee_vars = [
            variable
            for (candidate_employee_id, _slot_id), variable in sorted(variables.items())
            if candidate_employee_id == employee_id
        ]
        minute_terms = [
            slot_by_id[slot_id]["durationMinutes"] * variable
            for (candidate_employee_id, slot_id), variable in sorted(variables.items())
            if candidate_employee_id == employee_id
        ]
        weekly_shift_counts[employee_id] = model.NewIntVar(
            0, len(slots), safe_var_name(f"weekly_shift_count_{employee_id}")
        )
        weekly_minutes[employee_id] = model.NewIntVar(
            0, sum(slot["durationMinutes"] for slot in slots), safe_var_name(f"weekly_minutes_{employee_id}")
        )
        model.Add(weekly_shift_counts[employee_id] == sum(employee_vars))
        model.Add(weekly_minutes[employee_id] == sum(minute_terms))

    shift_fairness = 0
    minute_fairness = 0
    if fairness_employee_ids:
        max_shift = model.NewIntVar(0, len(slots), "max_weekly_shift_count")
        min_shift = model.NewIntVar(0, len(slots), "min_weekly_shift_count")
        model.AddMaxEquality(max_shift, [weekly_shift_counts[item] for item in fairness_employee_ids])
        model.AddMinEquality(min_shift, [weekly_shift_counts[item] for item in fairness_employee_ids])
        shift_fairness = max_shift - min_shift

        max_minutes = model.NewIntVar(0, sum(slot["durationMinutes"] for slot in slots), "max_weekly_minutes")
        min_minutes = model.NewIntVar(0, sum(slot["durationMinutes"] for slot in slots), "min_weekly_minutes")
        model.AddMaxEquality(max_minutes, [weekly_minutes[item] for item in fairness_employee_ids])
        model.AddMinEquality(min_minutes, [weekly_minutes[item] for item in fairness_employee_ids])
        minute_fairness = max_minutes - min_minutes

    positive_preference_terms = [
        preference_scores.get(key, 0) * variables[key]
        for key in sorted(variables)
        if preference_scores.get(key, 0) > 0
    ]
    preferences = sum(positive_preference_terms) if positive_preference_terms else None
    stability = sum(variables[pair] for pair in hint_pairs if pair in variables)

    return {
        "coverage": coverage,
        "targetHours": sum(target_deviations) if target_deviations else None,
        "shiftFairness": shift_fairness if fairness_employee_ids else None,
        "minuteFairness": minute_fairness if fairness_employee_ids else None,
        "preferences": preferences,
        "stability": stability if hint_pairs else None,
    }


def build_stage_sequence(expressions: Dict[str, Any]) -> List[Dict[str, Any]]:
    stage_specs = [
        ("coverage", "maximize"),
        ("targetHours", "minimize"),
        ("shiftFairness", "minimize"),
        ("minuteFairness", "minimize"),
        ("preferences", "maximize"),
        ("stability", "maximize"),
    ]
    return [
        {"name": name, "sense": sense, "expression": expressions[name]}
        for name, sense in stage_specs
        if expressions.get(name) is not None
    ]


def apply_hints(model: Any, variables: Dict[Tuple[str, str], Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    locked_slots = {
        assignment["slotId"]: assignment["employeeId"]
        for assignment in payload["existingAssignments"]
        if assignment.get("locked") is True
    }
    accepted_pairs: List[Tuple[str, str]] = []
    received = len(payload.get("hints", []))

    for hint in payload.get("hints", []):
        employee_id = hint.get("employeeId")
        slot_id = hint.get("slotId")
        pair = (employee_id, slot_id)
        if (
            not isinstance(employee_id, str)
            or not isinstance(slot_id, str)
            or pair not in variables
            or (slot_id in locked_slots and locked_slots[slot_id] != employee_id)
        ):
            continue

        model.AddHint(variables[pair], 1)
        accepted_pairs.append(pair)

    return {
        "received": received,
        "accepted": len(accepted_pairs),
        "ignored": received - len(accepted_pairs),
        "acceptedPairs": accepted_pairs,
    }


def extract_assignments(solver: Any, variables: Dict[Tuple[str, str], Any]) -> List[Dict[str, str]]:
    assignments: List[Dict[str, str]] = []
    for employee_id, slot_id in sorted(variables):
        if solver.BooleanValue(variables[(employee_id, slot_id)]):
            assignments.append(
                {
                    "scheduleSlotId": slot_id,
                    "employeeId": employee_id,
                }
            )
    return assignments


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
