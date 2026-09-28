import type { Capability } from './contracts';
import * as contract from '@/lib/honorarios/contracts';

const policy = { module: 'honorarios', roles: ['administrator', 'lawyer', 'reviewer'], publish: [] } as const;
const writePolicy = { ...policy, roles: ['administrator', 'lawyer'] } as const;
export const honorariosCapabilities = {
  k5_honorarios_list: { ...policy, effect: 'read', description: 'Consulta parcelas e totais de honorários.', input: contract.listHonorariosInput, output: contract.honorariosListDto },
  k5_honorarios_get: { ...policy, effect: 'read', description: 'Consulta honorário, parcelas e histórico de recebimentos.', input: contract.getHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_options: { ...policy, effect: 'read', description: 'Busca clientes e casos próprios para um honorário.', input: contract.honorariosOptionsInput, output: contract.honorariosOptionsDto },
  k5_honorarios_create: { ...writePolicy, effect: 'write', description: 'Cadastra honorário e parcelas.', input: contract.createHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_receive: { ...writePolicy, effect: 'write', description: 'Registra recebimento manual de uma parcela.', input: contract.receiveHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_reverse: { ...writePolicy, effect: 'write', description: 'Estorna registro de recebimento com motivo.', input: contract.reverseHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_cancel: { ...writePolicy, effect: 'write', description: 'Cancela honorário sem recebimentos líquidos.', input: contract.cancelHonorarioInput, output: contract.honorarioDetailDto },
} as const satisfies Record<string, Capability>;
