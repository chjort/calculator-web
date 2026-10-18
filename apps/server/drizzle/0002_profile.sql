CREATE TABLE profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account ON DELETE CASCADE,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 40),
  decimal_places smallint NULL CHECK (decimal_places BETWEEN 0 AND 12),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  ans text NULL CHECK (char_length(ans) <= 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_name_uq ON profile (account_id, lower(name));
--> statement-breakpoint
CREATE INDEX profile_account_created_idx ON profile (account_id, created_at);
