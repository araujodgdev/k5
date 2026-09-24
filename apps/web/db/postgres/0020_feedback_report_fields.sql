-- The feedback dialog asks the person what kind of report it is and where it happened. Those
-- answers are kept apart from the triage fields: the model and the admin may reclassify, but
-- what the person said stays on record.
ALTER TABLE feedback_ticket ADD COLUMN reported_kind TEXT CHECK (reported_kind IN ('problem','suggestion'));
ALTER TABLE feedback_ticket ADD COLUMN reported_module TEXT;
-- How much a suggestion would improve the office's work (0–3); problems keep using severity.
ALTER TABLE feedback_ticket ADD COLUMN value_score DOUBLE PRECISION CHECK (value_score IS NULL OR value_score BETWEEN 0 AND 3);

-- E-mails and Integrações became modules after the first list was written.
ALTER TABLE feedback_ticket DROP CONSTRAINT feedback_ticket_module_check;
ALTER TABLE feedback_ticket ADD CONSTRAINT feedback_ticket_module_check
  CHECK (module IN ('lume','cofre','agenda','pesquisa','documentos','email','integracoes','notificacoes','conta','instalacao','nao_identificado'));
ALTER TABLE feedback_ticket ADD CONSTRAINT feedback_ticket_reported_module_check
  CHECK (reported_module IN ('lume','cofre','agenda','pesquisa','documentos','email','integracoes','notificacoes','conta','instalacao','nao_identificado'));

-- Chat documents may be up to 25 MB; images keep a lower limit in the application.
ALTER TABLE ai_chat_attachment DROP CONSTRAINT ai_chat_attachment_byte_size_check;
ALTER TABLE ai_chat_attachment ADD CONSTRAINT ai_chat_attachment_byte_size_check CHECK (byte_size > 0 AND byte_size <= 26214400);
