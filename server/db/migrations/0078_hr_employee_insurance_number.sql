ALTER TABLE hr_employees
  ADD COLUMN IF NOT EXISTS insurance_number TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_insurance_number_unique
  ON hr_employees (insurance_number)
  WHERE insurance_number <> '' AND is_active;
