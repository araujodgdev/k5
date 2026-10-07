-- Metadata without published materials retains the catalog source obligation.
CREATE OR REPLACE FUNCTION lume_policy_valid(p JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'format' IS DISTINCT FROM '1'
    OR jsonb_typeof(p->'eligible') IS DISTINCT FROM 'boolean'
    OR p->>'origin' IS NULL OR p->>'origin' NOT IN ('person','generated','legacy-human','uncertain')
    OR jsonb_typeof(p->'digest') IS DISTINCT FROM 'string' OR p->>'digest'=''
    OR jsonb_typeof(p->'receipt') IS DISTINCT FROM 'string' OR p->>'receipt'=''
    OR jsonb_typeof(p->'guards') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'owners') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p->'observed') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p->'guards')>2048 OR jsonb_array_length(p->'owners')>2048 OR jsonb_array_length(p->'observed')>2048 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p->'owners') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}'='' THEN RETURN false; END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(p->'guards') LOOP
    IF jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id'='' OR item->>'kind' IS NULL
      OR item->>'kind' NOT IN ('case','folder','page','document','research','research-material','research-judgment') THEN RETURN false; END IF;
    IF item->>'kind' IN ('folder','page','research') AND (jsonb_typeof(item->'caseId') IS DISTINCT FROM 'string' OR item->>'caseId'='') THEN RETURN false; END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(p->'observed') LOOP
    IF item->>'kind' IS NULL OR item->>'kind' NOT IN ('page','artifact','document','instruction','knowledge-note','attachment','research')
      OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id'=''
      OR jsonb_typeof(item->'version') IS DISTINCT FROM 'string' OR item->>'version'=''
      OR jsonb_typeof(item->'digest') IS DISTINCT FROM 'string' OR item->>'digest'='' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION lume_resource_visible(p_kind TEXT,p_id TEXT,p_case TEXT,p_user TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH resource AS (
    SELECT office_id,id AS case_id,NULL::text AS folder_id FROM vault_case WHERE p_kind='case' AND id=p_id AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,id FROM vault_folder WHERE p_kind='folder' AND id=p_id AND case_id=p_case AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,folder_id FROM vault_document WHERE p_kind='document' AND id=p_id AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,folder_id FROM case_page WHERE p_kind='page' AND id=p_id AND case_id=p_case
    UNION ALL SELECT office_id,case_id,NULL::text FROM research_case_reference WHERE p_kind='research' AND id=p_id AND case_id=p_case AND deleted_at IS NULL
  ) SELECT p_user IS NOT NULL AND ((p_kind='research-material' AND EXISTS(SELECT 1 FROM research_material_version v
      JOIN research_material m ON m.id=v.material_id JOIN research_judgment j ON j.id=m.judgment_id
      JOIN judicial_source_installation s ON s.id=j.installation_id
      WHERE v.id=p_id AND v.published_at IS NOT NULL AND m.status<>'restricted' AND j.status='active'
        AND s.purpose='jurisprudence' AND s.auth_kind='none' AND s.enabled=1 AND s.discovery_status<>'suspended'
        AND s.permission_query='permitido' AND s.permission_cache='permitido' AND s.permission_redistribution='permitido'
        AND s.permission_ai='permitido' AND (m.kind<>'full_text' OR s.permission_documents='permitido')))
    OR (p_kind='research-judgment' AND EXISTS(SELECT 1 FROM research_judgment j
      JOIN judicial_source_installation s ON s.id=j.installation_id
      WHERE j.id=p_id AND j.status='active' AND s.purpose='jurisprudence' AND s.auth_kind='none'
        AND s.enabled=1 AND s.discovery_status<>'suspended' AND s.permission_query='permitido'
        AND s.permission_cache='permitido' AND s.permission_redistribution='permitido' AND s.permission_ai='permitido'))
    OR EXISTS(SELECT 1 FROM resource r WHERE vault_folder_visible(r.folder_id,p_user)
    AND (r.folder_id IS NULL OR EXISTS(SELECT 1 FROM vault_folder f WHERE f.id=r.folder_id AND f.office_id=r.office_id AND f.case_id=r.case_id AND f.deleted_at IS NULL))
    AND ((r.case_id IS NULL AND EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=r.office_id AND m.user_id=p_user))
      OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=r.case_id AND c.office_id=r.office_id AND c.deleted_at IS NULL
        AND (EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=p_user)
          OR EXISTS(SELECT 1 FROM case_participant cp WHERE cp.case_id=c.id AND cp.office_id=c.office_id AND cp.user_id=p_user AND cp.revoked_at IS NULL)))))
  )
$$;

CREATE OR REPLACE FUNCTION lume_legacy_obligations(p_sources JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE pending JSONB:=p_sources; seen JSONB:='{}'; guards JSONB:='{}'; owners JSONB:='[]';
  item JSONB; inherited JSONB; row_data RECORD; source JSONB; idx INTEGER:=0; key TEXT; parent TEXT;
BEGIN
  IF jsonb_typeof(pending) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid source obligations'; END IF;
  WHILE idx<jsonb_array_length(pending) LOOP
    IF idx>32768 OR (SELECT count(*) FROM jsonb_object_keys(seen))>2048 THEN RAISE EXCEPTION 'Source obligation limit'; END IF;
    item:=pending->idx; idx:=idx+1; key:=item::text;
    IF seen ? key THEN CONTINUE; END IF;
    seen:=seen||jsonb_build_object(key,true); inherited:=NULL;
    IF item->>'kind'='artifact-version' THEN
      SELECT a.*,COALESCE(p.content_policy,CASE WHEN a.version=(item->>'version')::int THEN a.content_policy ELSE v.content_policy END) AS exact_policy,
        v.version AS historical_version INTO row_data FROM ai_artifact a
        LEFT JOIN ai_artifact_policy p ON p.artifact_id=a.id AND p.version=(item->>'version')::int
        LEFT JOIN ai_artifact_version v ON v.artifact_id=a.id AND v.version=(item->>'version')::int WHERE a.id=item->>'id';
      IF NOT FOUND OR (row_data.version<>(item->>'version')::int AND row_data.historical_version IS NULL AND row_data.exact_policy IS NULL)
        THEN RAISE EXCEPTION 'Missing artifact version'; END IF;
      inherited:=row_data.exact_policy;
      IF inherited IS NULL THEN
        IF row_data.created_by_agent OR row_data.run_id IS NOT NULL OR row_data.conversation_id IS NOT NULL OR row_data.source_refs::jsonb<>'[]'::jsonb
          THEN owners:=owners||jsonb_build_array(row_data.user_id); END IF;
        SELECT dependencies INTO source FROM ai_source_provenance WHERE resource_kind='artifact' AND resource_id=row_data.id AND user_id=row_data.user_id AND office_id=row_data.office_id;
        pending:=pending||COALESCE(source,'[]'::jsonb);
        FOR source IN SELECT * FROM jsonb_array_elements(row_data.source_refs::jsonb) LOOP
          IF source ? 'documentId' THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','document','id',source->>'documentId')); END IF;
          IF source ? 'materialVersionId' THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','research-material','id',source->>'materialVersionId')); END IF;
          IF source ? 'researchReferenceId' THEN
            pending:=pending||(SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','research','id',r.id,'caseId',r.case_id)),'[]'::jsonb) FROM research_case_reference r WHERE r.id=source->>'researchReferenceId');
            IF NOT EXISTS(SELECT 1 FROM research_case_reference WHERE id=source->>'researchReferenceId') THEN RAISE EXCEPTION 'Missing research reference'; END IF;
          END IF;
        END LOOP;
        IF row_data.run_id IS NOT NULL THEN
          SELECT input::jsonb INTO source FROM ai_run WHERE id=row_data.run_id AND user_id=row_data.user_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Missing run'; END IF;
          pending:=pending||(SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','document','id',value)),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(source->'documentIds','[]'::jsonb)));
          IF source->>'templateId' IS NOT NULL THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','document','id',source->>'templateId')); END IF;
        END IF;
      END IF;
    ELSE
      IF item->>'kind' NOT IN ('case','page','document','folder','research','research-material','research-judgment') OR item->>'id' IS NULL THEN RAISE EXCEPTION 'Invalid source'; END IF;
      guards:=guards||jsonb_build_object(key,item);
      IF item->>'kind'='page' THEN
        SELECT content_policy,source_dependencies,folder_id INTO row_data FROM case_page WHERE id=item->>'id' AND case_id=item->>'caseId';
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing page'; END IF;
        inherited:=row_data.content_policy;
        IF inherited IS NULL THEN pending:=pending||row_data.source_dependencies; END IF;
        IF row_data.folder_id IS NOT NULL THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','folder','id',row_data.folder_id,'caseId',item->>'caseId')); END IF;
      ELSIF item->>'kind'='document' THEN
        SELECT d.folder_id,d.case_id,v.content_policy,o.source_kind,o.source_id,o.source_version INTO row_data FROM vault_document d
          JOIN vault_document_version v ON v.document_id=d.id AND v.is_active=1 LEFT JOIN vault_agent_origin o ON o.document_id=d.id WHERE d.id=item->>'id' AND d.deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing document'; END IF;
        inherited:=row_data.content_policy;
        IF inherited IS NULL AND row_data.source_kind IN ('artifact_pdf','artifact_docx') THEN
          pending:=pending||jsonb_build_array(jsonb_build_object('kind','artifact-version','id',row_data.source_id,'version',row_data.source_version));
        END IF;
        IF row_data.folder_id IS NOT NULL THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','folder','id',row_data.folder_id,'caseId',row_data.case_id)); END IF;
      ELSIF item->>'kind'='folder' THEN
        SELECT parent_id INTO parent FROM vault_folder WHERE id=item->>'id' AND case_id=item->>'caseId' AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing folder'; END IF;
        IF parent IS NOT NULL THEN pending:=pending||jsonb_build_array(jsonb_build_object('kind','folder','id',parent,'caseId',item->>'caseId')); END IF;
      ELSIF item->>'kind'='research' THEN
        SELECT material_version_id INTO parent FROM research_case_reference WHERE id=item->>'id' AND case_id=item->>'caseId' AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing research reference'; END IF;
        pending:=pending||jsonb_build_array(jsonb_build_object('kind','research-material','id',parent));
      END IF;
    END IF;
    IF inherited IS NOT NULL THEN
      IF NOT lume_policy_valid(inherited) THEN RAISE EXCEPTION 'Invalid policy'; END IF;
      FOR source IN SELECT * FROM jsonb_array_elements(inherited->'guards') LOOP guards:=guards||jsonb_build_object(source::text,source); END LOOP;
      owners:=owners||inherited->'owners';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(guards))>2048 THEN RAISE EXCEPTION 'Source obligation limit'; END IF;
  RETURN jsonb_build_object('guards',(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_each(guards)),
    'owners',(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(owners)));
END
$$;
