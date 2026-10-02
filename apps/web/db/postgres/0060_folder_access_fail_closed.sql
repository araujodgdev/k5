-- A malformed or removed folder path must never turn a reserved document public.
CREATE OR REPLACE FUNCTION vault_folder_visible(p_folder TEXT, p_user TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent_id, office_id, case_id, visibility, created_by, deleted_at, depth, visited, cycle) AS (
    SELECT id, parent_id, office_id, case_id, visibility, created_by, deleted_at, 0, ARRAY[id], FALSE
    FROM vault_folder WHERE id = p_folder
    UNION ALL
    SELECT f.id, f.parent_id, f.office_id, f.case_id, f.visibility, f.created_by, f.deleted_at,
      c.depth + 1, c.visited || f.id, f.id = ANY(c.visited)
    FROM vault_folder f JOIN chain c ON f.id = c.parent_id
    WHERE c.depth < 16 AND NOT c.cycle
  )
  SELECT p_folder IS NULL OR (
    p_user IS NOT NULL
    AND EXISTS (SELECT 1 FROM chain WHERE parent_id IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM chain c JOIN chain root ON root.depth = 0
      WHERE c.deleted_at IS NOT NULL OR c.cycle
        OR c.office_id IS DISTINCT FROM root.office_id
        OR c.case_id IS DISTINCT FROM root.case_id
        OR (c.visibility = 'public' OR c.created_by = p_user
          OR (c.visibility = 'restricted' AND EXISTS (
            SELECT 1 FROM vault_folder_member m WHERE m.folder_id = c.id AND m.user_id = p_user
          ))) IS NOT TRUE
    )
  )
$$;
