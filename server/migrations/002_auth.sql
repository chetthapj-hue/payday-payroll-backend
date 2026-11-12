BEGIN;
CREATE TABLE IF NOT EXISTS public.auth_accounts (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 role text NOT NULL CHECK (role IN ('admin','employee')),
 username text UNIQUE,
 employee_id integer UNIQUE REFERENCES public.employees(id),
 password_hash text NOT NULL,
 must_change_password boolean NOT NULL DEFAULT true,
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((role='admin' AND username IS NOT NULL AND employee_id IS NULL)
     OR (role='employee' AND username IS NULL AND employee_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.auth_sessions (
 token_hash text PRIMARY KEY,
 account_id integer NOT NULL REFERENCES public.auth_accounts(id) ON DELETE CASCADE,
 csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON public.auth_sessions(account_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON public.auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
 attempt_key text PRIMARY KEY,
 attempts integer NOT NULL,
 expires_at timestamptz NOT NULL
);
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS published_at timestamptz;
COMMIT;
