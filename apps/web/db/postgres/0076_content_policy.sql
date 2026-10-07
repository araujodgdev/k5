ALTER TABLE ai_artifact ADD COLUMN content_policy JSONB;
ALTER TABLE ai_artifact_version ADD COLUMN content_policy JSONB;
CREATE TABLE ai_artifact_policy (
  artifact_id TEXT NOT NULL REFERENCES ai_artifact(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_policy JSONB NOT NULL,
  PRIMARY KEY(artifact_id,version)
);
ALTER TABLE case_page ADD COLUMN content_policy JSONB;
ALTER TABLE case_page_version ADD COLUMN content_policy JSONB;
ALTER TABLE vault_document_version ADD COLUMN content_policy JSONB;
ALTER TABLE agent_instruction ADD COLUMN content_policy JSONB;
ALTER TABLE agent_knowledge ADD COLUMN note_policy JSONB;
ALTER TABLE capability_approval ADD COLUMN origin_context JSONB;
ALTER TABLE capability_approval ADD COLUMN content_result JSONB;
ALTER TABLE capability_approval ADD COLUMN content_policy JSONB;
ALTER TABLE case_page_approval ADD COLUMN mutation JSONB;
ALTER TABLE case_page_approval ADD COLUMN content_policy JSONB;

CREATE TABLE content_submission (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  request_text TEXT NOT NULL,
  scope JSONB NOT NULL,
  inputs JSONB NOT NULL,
  content_policy JSONB NOT NULL,
  continuation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id,message_id)
);
CREATE TABLE content_generation_attempt (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES content_submission(id),
  generation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  target JSONB NOT NULL,
  input_digest TEXT NOT NULL,
  provider_input JSONB NOT NULL,
  lease_token TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('generating','ready','failed')),
  output JSONB,
  content_policy JSONB NOT NULL,
  approval_id TEXT REFERENCES capability_approval(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(submission_id,generation_id,operation)
);
CREATE TABLE content_seed (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  purpose TEXT NOT NULL,
  scope JSONB,
  digest TEXT NOT NULL,
  content_policy JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE client_portal_file ADD COLUMN content_policy JSONB;
ALTER TABLE whatsapp_send ADD COLUMN content_policy JSONB;

CREATE FUNCTION lume_resource_visible(p_kind TEXT,p_id TEXT,p_case TEXT,p_user TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH resource AS (
    SELECT office_id,id AS case_id,NULL::text AS folder_id FROM vault_case WHERE p_kind='case' AND id=p_id AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,id FROM vault_folder WHERE p_kind='folder' AND id=p_id AND case_id=p_case AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,folder_id FROM vault_document WHERE p_kind='document' AND id=p_id AND deleted_at IS NULL
    UNION ALL SELECT office_id,case_id,folder_id FROM case_page WHERE p_kind='page' AND id=p_id AND case_id=p_case
    UNION ALL SELECT office_id,case_id,NULL::text FROM research_case_reference WHERE p_kind='research' AND id=p_id AND case_id=p_case AND deleted_at IS NULL
  ) SELECT (p_kind='research-material' AND EXISTS(SELECT 1 FROM research_material_version v
      JOIN research_material m ON m.id=v.material_id JOIN research_judgment j ON j.id=m.judgment_id
      JOIN judicial_source_installation s ON s.id=j.installation_id
      WHERE v.id=p_id AND v.published_at IS NOT NULL AND m.status<>'restricted' AND j.status='active'
        AND s.purpose='jurisprudence' AND s.auth_kind='none' AND s.enabled=1 AND s.discovery_status<>'suspended'
        AND s.permission_query='permitido' AND s.permission_cache='permitido' AND s.permission_redistribution='permitido'
        AND s.permission_ai='permitido' AND (m.kind<>'full_text' OR s.permission_documents='permitido')))
    OR EXISTS(SELECT 1 FROM resource r WHERE vault_folder_visible(r.folder_id,p_user)
    AND (r.folder_id IS NULL OR EXISTS(SELECT 1 FROM vault_folder f WHERE f.id=r.folder_id AND f.office_id=r.office_id AND f.case_id=r.case_id AND f.deleted_at IS NULL))
    AND ((r.case_id IS NULL AND EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=r.office_id AND m.user_id=p_user))
      OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=r.case_id AND c.office_id=r.office_id AND c.deleted_at IS NULL
        AND (EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=p_user)
          OR EXISTS(SELECT 1 FROM case_participant cp WHERE cp.case_id=c.id AND cp.office_id=c.office_id AND cp.user_id=p_user AND cp.revoked_at IS NULL)))))
$$;

CREATE FUNCTION lume_policy_visible(p_policy JSONB,p_user TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE g JSONB;
BEGIN
  IF p_policy IS NULL OR p_policy->>'format' IS DISTINCT FROM '1' OR jsonb_typeof(p_policy->'guards') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_policy->'owners') IS DISTINCT FROM 'array' OR jsonb_array_length(p_policy->'guards')>2048 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_policy->'owners') o WHERE o<>p_user) THEN RETURN false; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(p_policy->'guards') LOOP
    IF NOT lume_resource_visible(g->>'kind',g->>'id',g->>'caseId',p_user) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$$;


CREATE FUNCTION lume_legacy_obligations(p_sources JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
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
      IF item->>'kind' NOT IN ('case','page','document','folder','research','research-material') OR item->>'id' IS NULL THEN RAISE EXCEPTION 'Invalid source'; END IF;
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
      IF inherited->>'format' IS DISTINCT FROM '1' OR jsonb_typeof(inherited->'guards') IS DISTINCT FROM 'array' OR jsonb_typeof(inherited->'owners') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid policy'; END IF;
      FOR source IN SELECT * FROM jsonb_array_elements(inherited->'guards') LOOP guards:=guards||jsonb_build_object(source::text,source); END LOOP;
      owners:=owners||inherited->'owners';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(guards))>2048 THEN RAISE EXCEPTION 'Source obligation limit'; END IF;
  RETURN jsonb_build_object('guards',(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_each(guards)),
    'owners',(SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) FROM jsonb_array_elements(owners)));
END
$$;

CREATE FUNCTION lume_vault_visible(p_document TEXT,p_user TEXT,p_version BIGINT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE v RECORD; a RECORD; policy JSONB;
BEGIN
  IF NOT lume_resource_visible('document',p_document,NULL,p_user) THEN RETURN false; END IF;
  SELECT ver.*,o.source_kind,o.source_id,o.source_version,o.user_id AS origin_user INTO v FROM vault_document_version ver
    LEFT JOIN vault_agent_origin o ON o.document_id=ver.document_id
    WHERE ver.document_id=p_document AND (p_version IS NULL AND ver.is_active=1 OR ver.version=p_version);
  IF NOT FOUND THEN RETURN false; END IF;
  IF v.content_policy IS NOT NULL THEN RETURN v.content_policy->>'digest'=v.sha256 AND lume_policy_visible(v.content_policy,p_user); END IF;
  IF v.source_kind IN ('artifact_pdf','artifact_docx') THEN
    SELECT ar.*,COALESCE(p.content_policy,CASE WHEN ar.version=v.source_version THEN ar.content_policy ELSE h.content_policy END) AS exact_policy INTO a FROM ai_artifact ar
      LEFT JOIN ai_artifact_version h ON h.artifact_id=ar.id AND h.version=v.source_version
      LEFT JOIN ai_artifact_policy p ON p.artifact_id=ar.id AND p.version=v.source_version
      WHERE ar.id=v.source_id AND ar.user_id=v.origin_user;
    IF NOT FOUND THEN RETURN false; END IF;
    IF a.exact_policy IS NOT NULL THEN RETURN lume_policy_visible(a.exact_policy,p_user); END IF;
    IF (a.created_by_agent OR a.run_id IS NOT NULL OR a.conversation_id IS NOT NULL OR a.source_refs<>'[]') AND p_user<>a.user_id THEN RETURN false; END IF;
    policy:=lume_legacy_obligations(jsonb_build_array(jsonb_build_object('kind','artifact-version','id',a.id,'version',v.source_version)));
    policy:=policy||jsonb_build_object('format',1);
    RETURN lume_policy_visible(policy,p_user);
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$$;

CREATE FUNCTION lume_content_acl_gate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('lume:content-acl:' || current_schema(),0));
  RETURN NULL;
END
$$;
CREATE TRIGGER content_acl_participant BEFORE INSERT OR UPDATE OR DELETE ON case_participant FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_association BEFORE INSERT OR UPDATE OR DELETE ON office_associate FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_member BEFORE INSERT OR UPDATE OR DELETE ON office_member FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_folder_member BEFORE INSERT OR UPDATE OR DELETE ON vault_folder_member FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_folder BEFORE UPDATE OR DELETE ON vault_folder FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_case BEFORE UPDATE OR DELETE ON vault_case FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_document BEFORE UPDATE OF office_id,case_id,folder_id,deleted_at OR DELETE ON vault_document FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_page BEFORE UPDATE OF office_id,case_id,folder_id OR DELETE ON case_page FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_research_reference BEFORE UPDATE OR DELETE ON research_case_reference FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_research_version BEFORE UPDATE OR DELETE ON research_material_version FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_research_material BEFORE UPDATE OR DELETE ON research_material FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_research_judgment BEFORE UPDATE OR DELETE ON research_judgment FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_research_installation BEFORE UPDATE OR DELETE ON judicial_source_installation FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();
CREATE TRIGGER content_acl_session BEFORE UPDATE OF "expiresAt" OR DELETE ON session FOR EACH STATEMENT EXECUTE FUNCTION lume_content_acl_gate();

CREATE OR REPLACE FUNCTION vault_folder_visible(p_folder TEXT,p_user TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id,parent_id,case_id,office_id,visibility,created_by,deleted_at,ARRAY[id] AS path,false AS cycle FROM vault_folder WHERE id=p_folder
    UNION ALL SELECT f.id,f.parent_id,f.case_id,f.office_id,f.visibility,f.created_by,f.deleted_at,c.path||f.id,f.id=ANY(c.path)
      FROM vault_folder f JOIN chain c ON f.id=c.parent_id WHERE NOT c.cycle AND cardinality(c.path)<64
  ) SELECT p_folder IS NULL OR (
    EXISTS(SELECT 1 FROM chain WHERE parent_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM chain WHERE cycle OR deleted_at IS NOT NULL
      OR case_id<>(SELECT case_id FROM vault_folder WHERE id=p_folder)
      OR office_id<>(SELECT office_id FROM vault_folder WHERE id=p_folder)
      OR NOT(visibility='public' OR created_by=p_user OR visibility='restricted' AND EXISTS(SELECT 1 FROM vault_folder_member m WHERE m.folder_id=chain.id AND m.user_id=p_user)))
  )
$$;
