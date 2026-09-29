ALTER TABLE crm_client DROP CONSTRAINT crm_client_legal_areas_check;

ALTER TABLE crm_client ADD CONSTRAINT crm_client_legal_areas_check
  CHECK (legal_areas <@ ARRAY[
    'administrativo',
    'agrario',
    'ambiental',
    'bancario',
    'civel',
    'constitucional',
    'consumidor',
    'contratual',
    'criminal',
    'digital',
    'eleitoral',
    'empresarial',
    'esportivo',
    'familia',
    'imobiliario',
    'internacional',
    'maritimo',
    'medico',
    'militar',
    'previdenciario',
    'propriedade_intelectual',
    'recuperacao_judicial',
    'securitario',
    'societario',
    'sucessorio',
    'trabalhista',
    'tributario',
    'urbanistico'
  ]::TEXT[]);
