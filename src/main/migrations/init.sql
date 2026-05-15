PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_settings (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT 'JProgrammer',
  timezone TEXT NOT NULL DEFAULT 'Europe/Athens',
  week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK (week_starts_on BETWEEN 0 AND 6),
  locale TEXT NOT NULL DEFAULT 'en',
  currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  open_time TEXT,
  close_time TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (day_of_week)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS shift_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  color TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS staffing_requirements (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  role_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  required_count INTEGER NOT NULL CHECK (required_count >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS special_days (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date)
);

CREATE TABLE IF NOT EXISTS special_day_staffing_requirements (
  id TEXT PRIMARY KEY,
  special_day_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  required_count INTEGER NOT NULL CHECK (required_count >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (special_day_id) REFERENCES special_days (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_roles (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  UNIQUE (employee_id, role_id)
);

CREATE TABLE IF NOT EXISTS employee_work_rules (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  max_hours_per_week REAL,
  max_shifts_per_week INTEGER,
  max_days_per_week INTEGER,
  min_hours_between_shifts REAL,
  preferred_hours_per_week REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  UNIQUE (employee_id)
);

CREATE TABLE IF NOT EXISTS employee_day_constraints (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  constraint_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_time_constraints (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  date TEXT,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  constraint_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  CHECK (date IS NOT NULL OR day_of_week IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS time_off (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  parameters_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY,
  schedule_run_id TEXT NOT NULL,
  date TEXT NOT NULL,
  role_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 1 CHECK (required_count >= 0),
  source_type TEXT,
  source_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedule_assignments (
  id TEXT PRIMARY KEY,
  schedule_run_id TEXT NOT NULL,
  schedule_slot_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_slot_id) REFERENCES schedule_slots (id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  UNIQUE (schedule_slot_id, employee_id)
);

CREATE TABLE IF NOT EXISTS schedule_warnings (
  id TEXT PRIMARY KEY,
  schedule_run_id TEXT NOT NULL,
  schedule_slot_id TEXT,
  schedule_assignment_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  warning_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_slot_id) REFERENCES schedule_slots (id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_assignment_id) REFERENCES schedule_assignments (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_role_id ON shift_templates (role_id);
CREATE INDEX IF NOT EXISTS idx_staffing_requirements_day_role ON staffing_requirements (day_of_week, role_id);
CREATE INDEX IF NOT EXISTS idx_special_day_staffing_special_day_id ON special_day_staffing_requirements (special_day_id);
CREATE INDEX IF NOT EXISTS idx_employee_roles_employee_id ON employee_roles (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_roles_role_id ON employee_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_employee_day_constraints_employee_id ON employee_day_constraints (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_time_constraints_employee_id ON employee_time_constraints (employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_employee_dates ON time_off (employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_run_date ON schedule_slots (schedule_run_id, date);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_run_id ON schedule_assignments (schedule_run_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_slot_id ON schedule_assignments (schedule_slot_id);
CREATE INDEX IF NOT EXISTS idx_schedule_warnings_run_id ON schedule_warnings (schedule_run_id);

INSERT INTO settings (key, value, updated_at)
VALUES ('schema_version', '1', datetime('now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');
