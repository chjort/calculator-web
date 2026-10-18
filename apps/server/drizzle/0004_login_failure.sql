CREATE TABLE login_failure (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email citext NOT NULL,
  ip inet NULL,
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX login_failure_email_at_idx ON login_failure (email, at DESC);
