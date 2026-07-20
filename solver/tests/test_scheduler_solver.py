from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOLVER = ROOT / "scheduler_solver.py"


def run_solver(request: dict) -> dict:
    process = subprocess.run(
        [sys.executable, str(SOLVER)],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert process.returncode == 0, process.stderr
    return json.loads(process.stdout.strip().splitlines()[-1])


def base_request() -> dict:
    return {
        "requestId": "test-request",
        "schedule": {"runId": "run-1", "weekStartsOn": 1},
        "employees": [
            {
                "id": "emp-1",
                "isActive": True,
                "maxShiftsPerWeek": 5,
                "maxHoursPerDayMinutes": 480,
                "canWorkWeekends": True,
            }
        ],
        "employeeRoles": [
            {
                "employeeId": "emp-1",
                "roleId": "role-service",
                "experienceLevel": "some_experience",
            }
        ],
        "slots": [
            {
                "id": "slot-1",
                "requirementGroupId": "group-1",
                "date": "2026-05-18",
                "roleId": "role-service",
                "startTime": "08:00",
                "endTime": "12:00",
                "durationMinutes": 240,
                "absoluteStartMinute": 1000,
                "absoluteEndMinute": 1240,
                "minimumExperienceLevel": "no_experience",
                "experiencedRequiredCount": 0,
            }
        ],
        "eligibility": [{"employeeId": "emp-1", "slotId": "slot-1"}],
        "existingAssignments": [],
        "timeoutSeconds": 5,
    }


class SchedulerSolverProtocolTests(unittest.TestCase):
    def test_malformed_json_returns_model_invalid(self) -> None:
        process = subprocess.run(
            [sys.executable, str(SOLVER)],
            input="{",
            text=True,
            capture_output=True,
            check=False,
            timeout=10,
        )
        self.assertEqual(process.returncode, 0)
        result = json.loads(process.stdout.strip().splitlines()[-1])
        self.assertEqual(result["status"], "MODEL_INVALID")


@unittest.skipUnless(
    importlib.util.find_spec("ortools") is not None,
    "OR-Tools is not installed",
)
class SchedulerSolverModelTests(unittest.TestCase):
    def test_easy_case_reaches_full_coverage(self) -> None:
        result = run_solver(base_request())
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual(result["objectiveValues"]["coveredSlots"], 1)

    def test_overlapping_slots_cannot_both_be_assigned(self) -> None:
        request = base_request()
        request["slots"].append(
            {
                **request["slots"][0],
                "id": "slot-2",
                "requirementGroupId": "group-2",
                "startTime": "10:00",
                "endTime": "14:00",
                "absoluteStartMinute": 1120,
                "absoluteEndMinute": 1360,
            }
        )
        request["eligibility"].append({"employeeId": "emp-1", "slotId": "slot-2"})
        result = run_solver(request)
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual(result["objectiveValues"]["coveredSlots"], 1)

    def test_adjacent_split_shifts_are_allowed_with_daily_limit(self) -> None:
        request = base_request()
        request["slots"].append(
            {
                **request["slots"][0],
                "id": "slot-2",
                "requirementGroupId": "group-2",
                "startTime": "16:00",
                "endTime": "20:00",
                "absoluteStartMinute": 1480,
                "absoluteEndMinute": 1720,
            }
        )
        request["eligibility"].append({"employeeId": "emp-1", "slotId": "slot-2"})
        result = run_solver(request)
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual(result["objectiveValues"]["coveredSlots"], 2)

    def test_group_experience_is_hard(self) -> None:
        request = base_request()
        request["employees"].append(
            {
                "id": "emp-2",
                "isActive": True,
                "maxShiftsPerWeek": 5,
                "maxHoursPerDayMinutes": 480,
                "canWorkWeekends": True,
            }
        )
        request["employeeRoles"].append(
            {
                "employeeId": "emp-2",
                "roleId": "role-service",
                "experienceLevel": "no_experience",
            }
        )
        request["slots"][0]["experiencedRequiredCount"] = 1
        request["eligibility"].append({"employeeId": "emp-2", "slotId": "slot-1"})
        result = run_solver(request)
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual(result["assignments"], [{"scheduleSlotId": "slot-1", "employeeId": "emp-1"}])

    def test_zero_available_workers_is_feasible_zero_coverage(self) -> None:
        request = base_request()
        request["eligibility"] = []
        result = run_solver(request)
        self.assertEqual(result["status"], "OPTIMAL")
        self.assertEqual(result["objectiveValues"]["coveredSlots"], 0)


if __name__ == "__main__":
    unittest.main()
