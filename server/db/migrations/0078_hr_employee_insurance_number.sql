ALTER TABLE hr_employees
  ADD COLUMN insurance_number TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX hr_employees_insurance_number_unique
  ON hr_employees (insurance_number)
  WHERE insurance_number <> '' AND is_active;
