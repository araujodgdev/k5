-- Membership is no longer a one-office-per-person relationship.
ALTER TABLE office_member DROP CONSTRAINT office_member_user_id_key;
CREATE INDEX office_member_user ON office_member(user_id, created_at, id);

CREATE TABLE office_associate (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, user_id)
);

CREATE TABLE case_participant (
  office_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('viewer', 'editor')),
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (case_id, user_id),
  FOREIGN KEY (office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE CASCADE
);
CREATE INDEX case_participant_user ON case_participant(user_id, office_id) WHERE revoked_at IS NULL;

CREATE TABLE collaboration_invitation (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'associate', 'case')),
  case_id TEXT,
  email TEXT NOT NULL,
  recipient_user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES "user"(id),
  role TEXT NOT NULL CHECK (role IN ('administrator', 'lawyer', 'reviewer', 'viewer', 'editor')),
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMPTZ,
  FOREIGN KEY (office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'case') = (case_id IS NOT NULL)),
  CHECK ((kind = 'team' AND role IN ('administrator','lawyer','reviewer')) OR
         (kind = 'associate' AND role = 'viewer' AND NOT can_invite) OR
         (kind = 'case' AND role IN ('viewer','editor')))
);
CREATE UNIQUE INDEX collaboration_invitation_pending ON collaboration_invitation(office_id, kind, COALESCE(case_id,''), email) WHERE status='pending';
CREATE INDEX collaboration_invitation_inbox ON collaboration_invitation(recipient_user_id, status, expires_at);

CREATE TABLE collaboration_audit (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT,
  actor_user_id TEXT NOT NULL REFERENCES "user"(id),
  target_user_id TEXT REFERENCES "user"(id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (office_id, case_id) REFERENCES vault_case(office_id, id) ON DELETE CASCADE
);
CREATE INDEX collaboration_audit_scope ON collaboration_audit(office_id, case_id, created_at DESC);
