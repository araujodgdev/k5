CREATE OR REPLACE FUNCTION vault_folder_visible(p_folder TEXT,p_user TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id,parent_id,case_id,office_id,visibility,created_by,deleted_at,ARRAY[id] AS path,false AS cycle FROM vault_folder WHERE id=p_folder
    UNION ALL SELECT f.id,f.parent_id,f.case_id,f.office_id,f.visibility,f.created_by,f.deleted_at,c.path||f.id,f.id=ANY(c.path)
      FROM vault_folder f JOIN chain c ON f.id=c.parent_id WHERE NOT c.cycle AND cardinality(c.path)<64
  ) SELECT p_user IS NOT NULL AND (p_folder IS NULL OR (
    EXISTS(SELECT 1 FROM chain WHERE parent_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM chain WHERE cycle OR deleted_at IS NOT NULL
      OR case_id<>(SELECT case_id FROM vault_folder WHERE id=p_folder)
      OR office_id<>(SELECT office_id FROM vault_folder WHERE id=p_folder)
      OR NOT(visibility='public' OR created_by=p_user OR visibility='restricted' AND EXISTS(SELECT 1 FROM vault_folder_member m WHERE m.folder_id=chain.id AND m.user_id=p_user)))
  ))
$$;
