from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple


VALID_STATUSES = {
    "OPTIMAL",
    "FEASIBLE",
    "INFEASIBLE",
    "MODEL_INVALID",
    "UNKNOWN",
}


def build_result(
    *,
    request_id: str,
    assignments: List[Dict[str, str]],
    status: str,
    covered_slots: int,
    total_slots: int,
    runtime_ms: int,
    message: str | None,
) -> Dict[str, Any]:
    coverage_rate = 0 if total_slots == 0 else covered_slots / total_slots
    return {
        "requestId": request_id,
        "assignments": assignments,
        "status": status if status in VALID_STATUSES else "UNKNOWN",
        "objectiveValues": {
            "coveredSlots": covered_slots,
            "totalSlots": total_slots,
            "coverageRate": coverage_rate,
        },
        "runtimeMs": runtime_ms,
        "message": message,
    }


def get_request_id(payload: Any) -> str:
    if isinstance(payload, dict) and isinstance(payload.get("requestId"), str):
        return payload["requestId"]
    return "unknown"


def validate_request(payload: Any) -> Tuple[str, List[str]]:
    errors: List[str] = []
    request_id = get_request_id(payload)

    if not isinstance(payload, dict):
        return request_id, ["Request must be a JSON object."]

    for key in [
        "requestId",
        "schedule",
        "employees",
        "employeeRoles",
        "slots",
        "eligibility",
        "existingAssignments",
        "timeoutSeconds",
    ]:
        if key not in payload:
            errors.append(f"Missing required field: {key}.")

    if not isinstance(payload.get("requestId"), str):
        errors.append("requestId must be a string.")
    if not isinstance(payload.get("schedule"), dict):
        errors.append("schedule must be an object.")
    for key in ["employees", "employeeRoles", "slots", "eligibility", "existingAssignments"]:
        if not isinstance(payload.get(key), list):
            errors.append(f"{key} must be an array.")
    if not isinstance(payload.get("timeoutSeconds"), (int, float)):
        errors.append("timeoutSeconds must be numeric.")

    if errors:
        return request_id, errors

    employees = payload["employees"]
    slots = payload["slots"]
    employee_ids = set()
    slot_ids = set()

    for employee in employees:
        if not isinstance(employee, dict) or not isinstance(employee.get("id"), str):
            errors.append("Every employee must have an id.")
            continue
        employee_ids.add(employee["id"])
        if not isinstance(employee.get("maxShiftsPerWeek"), int):
            errors.append(f"Employee {employee['id']} must have maxShiftsPerWeek.")
        if not isinstance(employee.get("maxHoursPerDayMinutes"), int):
            errors.append(f"Employee {employee['id']} must have maxHoursPerDayMinutes.")

    for slot in slots:
        if not isinstance(slot, dict) or not isinstance(slot.get("id"), str):
            errors.append("Every slot must have an id.")
            continue
        slot_ids.add(slot["id"])
        for key in ["durationMinutes", "absoluteStartMinute", "absoluteEndMinute", "experiencedRequiredCount"]:
            if not isinstance(slot.get(key), int):
                errors.append(f"Slot {slot['id']} must have numeric {key}.")

    eligibility_pairs = set()
    for pair in payload["eligibility"]:
        if not isinstance(pair, dict):
            errors.append("Eligibility entries must be objects.")
            continue
        employee_id = pair.get("employeeId")
        slot_id = pair.get("slotId")
        if employee_id not in employee_ids:
            errors.append(f"Eligibility references unknown employee {employee_id}.")
        if slot_id not in slot_ids:
            errors.append(f"Eligibility references unknown slot {slot_id}.")
        if isinstance(employee_id, str) and isinstance(slot_id, str):
            eligibility_pairs.add((employee_id, slot_id))

    locked_by_slot: Dict[str, str] = {}
    for assignment in payload["existingAssignments"]:
        if not isinstance(assignment, dict):
            errors.append("Existing assignments must be objects.")
            continue
        employee_id = assignment.get("employeeId")
        slot_id = assignment.get("slotId")
        if employee_id not in employee_ids:
            errors.append(f"Existing assignment references unknown employee {employee_id}.")
        if slot_id not in slot_ids:
            errors.append(f"Existing assignment references unknown slot {slot_id}.")
        if assignment.get("locked") is True and isinstance(slot_id, str):
            previous_employee = locked_by_slot.get(slot_id)
            if previous_employee and previous_employee != employee_id:
                errors.append(f"Contradictory locked assignments for slot {slot_id}.")
            if isinstance(employee_id, str):
                locked_by_slot[slot_id] = employee_id
                if (employee_id, slot_id) not in eligibility_pairs:
                    errors.append(
                        f"Locked assignment {employee_id}/{slot_id} is not eligible."
                    )

    return request_id, errors


def sort_key_pair(pair: Iterable[str]) -> Tuple[str, str]:
    left, right = list(pair)
    return left, right
