CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  end_reason text NULL CHECK (end_reason IN ('logout', 'timeout', 'expired', 'profile_switch')),
  FOREIGN KEY (profile_id, account_id) REFERENCES profile (id, account_id) ON DELETE CASCADE,
  CHECK (expires_at > started_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  UNIQUE (id, profile_id)
);
--> statement-breakpoint
CREATE INDEX session_account_last_seen_idx ON session (account_id, last_seen_at DESC);
--> statement-breakpoint
CREATE INDEX session_open_last_seen_idx ON session (last_seen_at) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX session_open_expires_idx ON session (expires_at) WHERE ended_at IS NULL;
