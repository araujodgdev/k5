-- One lawyer, one workspace. Office roles are gone: the single member owns the office, and other
-- lawyers take part in a case as associates instead of joining the office team.
ALTER TABLE office_member DROP COLUMN role;
ALTER TABLE office_member ADD CONSTRAINT office_member_user_unique UNIQUE (user_id);
ALTER TABLE office_member ADD CONSTRAINT office_member_office_unique UNIQUE (office_id);

-- Association is mutual. A row (office_id, user_id) reads "user_id is an associate of the lawyer
-- who owns office_id", so each accepted association is stored in both directions.
INSERT INTO office_associate(office_id, user_id, created_by)
SELECT theirs.office_id, mine.user_id, a.created_by
FROM office_associate a
JOIN office_member mine ON mine.office_id = a.office_id
JOIN office_member theirs ON theirs.user_id = a.user_id
ON CONFLICT DO NOTHING;

-- Everyone already sharing a case becomes an associate of its owner, both ways.
INSERT INTO office_associate(office_id, user_id, created_by)
SELECT p.office_id, p.user_id, p.invited_by FROM case_participant p WHERE p.revoked_at IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO office_associate(office_id, user_id, created_by)
SELECT theirs.office_id, owner.user_id, p.invited_by
FROM case_participant p
JOIN office_member owner ON owner.office_id = p.office_id
JOIN office_member theirs ON theirs.user_id = p.user_id
WHERE p.revoked_at IS NULL
ON CONFLICT DO NOTHING;
CREATE INDEX office_associate_user ON office_associate(user_id);

-- Participants of a case share it equally; only the owner manages who takes part.
ALTER TABLE case_participant DROP COLUMN permission;
ALTER TABLE case_participant DROP COLUMN can_invite;

-- Team and case invitations no longer exist: a case participant is picked from the associates.
UPDATE collaboration_invitation SET status = 'revoked', responded_at = CURRENT_TIMESTAMP
WHERE kind <> 'associate' AND status = 'pending';
-- Dropping these columns also drops the checks that read them.
ALTER TABLE collaboration_invitation DROP COLUMN role;
ALTER TABLE collaboration_invitation DROP COLUMN can_invite;
ALTER TABLE collaboration_invitation ADD CONSTRAINT collaboration_invitation_associate_only
  CHECK (kind = 'associate' OR status <> 'pending');

-- Folder access inside a case. The case root is shared by every participant; a folder is public
-- to them, private to whoever created it, or restricted to the creator plus a chosen list.
ALTER TABLE vault_folder ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private', 'restricted'));

CREATE TABLE vault_folder_member (
  folder_id TEXT NOT NULL REFERENCES vault_folder(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (folder_id, user_id)
);
CREATE INDEX vault_folder_member_user ON vault_folder_member(user_id);

-- Names are unique per creator, so a name clash cannot reveal someone else's private folder.
DROP INDEX vault_folder_root_idx;
DROP INDEX vault_folder_sibling_idx;
CREATE UNIQUE INDEX vault_folder_root_idx ON vault_folder(case_id, created_by, name) WHERE deleted_at IS NULL AND parent_id IS NULL;
CREATE UNIQUE INDEX vault_folder_sibling_idx ON vault_folder(case_id, parent_id, created_by, name) WHERE deleted_at IS NULL AND parent_id IS NOT NULL;

-- A folder is visible when every folder on its path admits the person. NULL (the case root or the
-- library) is always visible here; case membership is checked separately. Depth is bounded so a
-- cycle cannot loop the query.
CREATE FUNCTION vault_folder_visible(p_folder TEXT, p_user TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent_id, visibility, created_by, depth) AS (
    SELECT id, parent_id, visibility, created_by, 0 FROM vault_folder WHERE id = p_folder
    UNION ALL
    SELECT f.id, f.parent_id, f.visibility, f.created_by, c.depth + 1
    FROM vault_folder f JOIN chain c ON f.id = c.parent_id WHERE c.depth < 16
  )
  SELECT p_folder IS NULL OR NOT EXISTS (
    SELECT 1 FROM chain c
    WHERE NOT (c.visibility = 'public' OR c.created_by = p_user
      OR (c.visibility = 'restricted' AND EXISTS (SELECT 1 FROM vault_folder_member m WHERE m.folder_id = c.id AND m.user_id = p_user)))
  )
$$;
