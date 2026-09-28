CREATE INDEX honorario_agreement_owner ON honorario_agreement(office_id, created_by);
CREATE INDEX honorario_agreement_shared_case ON honorario_agreement(case_office_id, case_id) WHERE case_id IS NOT NULL;
