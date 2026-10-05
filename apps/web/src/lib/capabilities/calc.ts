import type { Capability } from './contracts';
import * as c from '@/lib/calc/contracts';

const policy = { module: 'calc', publish: ['agent', 'webmcp'] } as const;
export const calcCapabilities = {
  k5_calc_preview: { ...policy, effect: 'read', description: 'Calcula memória jurídica determinística: correção, pensão, aluguel, consumidor, tributário federal, rescisão assistida ou revisão Price/SAC. Solicite premissas jurídicas, não invente índices nem bases.', input: c.calculateInput, output: c.calculationResult },
  k5_calc_save: { ...policy, effect: 'write', description: 'Salva cálculo privado ou nova versão imutável. Exige título, entradas completas e chave idempotente. Não cria cobrança nem compartilha com o cliente.', input: c.saveCalculationInput, output: c.savedCalculation },
  k5_calc_get: { ...policy, effect: 'read', description: 'Consulta versão de cálculo próprio, entradas, memória e fontes.', input: c.getCalculationInput, output: c.savedCalculation },
  k5_calc_list: { ...policy, effect: 'read', description: 'Lista cálculos jurídicos privados do escritório pessoal.', input: c.listCalculationsInput, output: c.calculationsList },
} as const satisfies Record<string, Capability>;
