import type { Capability } from './contracts';
import * as contract from '@/lib/honorarios/contracts';
import * as charges from '@/lib/honorarios/charges-contract';
import { z } from 'zod';
import * as pricing from '@/lib/honorarios/pricing';

const policy = { module: 'honorarios', publish: ['agent', 'webmcp'] } as const;
export const honorariosCapabilities = {
  k5_honorarios_quote_list: { ...policy, effect: 'read', description: 'Lista até 100 propostas privadas de honorários, referências OAB PE/RS e componentes de contratação.', input: z.object({}), output: pricing.feeQuoteListDto },
  k5_honorarios_quote_get: { ...policy, effect: 'read', description: 'Consulta uma versão da proposta privada; a versão atual inclui os componentes já convertidos em parcelas.', input: pricing.getFeeQuoteInput, output: pricing.feeQuoteDto },
  k5_honorarios_quote_save: { ...policy, effect: 'write', description: 'Salva proposta ou nova revisão de honorários, com escopo, condições, referência OAB e componentes fixos, por hora, mensais ou percentuais. Êxito continua estimado até confirmação.', input: pricing.saveFeeQuoteInput, output: pricing.feeQuoteDto },
  k5_honorarios_quote_bill: { ...policy, publish: ['webmcp'], effect: 'write', description: 'Gera parcelas de um componente aprovado da proposta. Registra evidência da contratação ou êxito e base efetiva. Cada componente só pode gerar parcelas uma vez.', input: pricing.billFeeQuoteInput, output: pricing.feeQuoteDto },
  k5_honorarios_charge_get: { ...policy, effect: 'read', description: 'Consulta a cobrança própria de uma parcela, saldo atual, mensagem para enviar e link do PDF. Não envia mensagens ao cliente.', input: charges.getChargeInput, output: charges.chargeDto },
  k5_honorarios_charge_prepare: { ...policy, effect: 'write', description: 'Prepara cobrança da parcela com chave PIX, instruções ou boleto já emitido no Cofre. Solicite os dados bancários se faltarem. Version deve ser a versão consultada, inicialmente zero. Retorna mensagem e PDF; o dinheiro é pago diretamente ao advogado. Não emite boleto bancário nem envia mensagens.', input: charges.prepareChargeInput, output: charges.chargeDto },
  k5_honorarios_charge_sent: { ...policy, effect: 'write', description: 'Registra no histórico que a pessoa já enviou a cobrança, com canal e versão consultada. Só use quando a pessoa confirmar o envio; esta operação não envia a mensagem.', input: charges.sentChargeInput, output: charges.chargeDto },
  k5_honorarios_list: { ...policy, effect: 'read', description: 'Busca honorários pelo nome do cliente ou título (query). Retorna parcelas numeradas, installmentId em id, agreementId, saldo em centavos e canManage. Use para pedidos de receber, dar baixa ou marcar uma parcela como recebida; honorários não são tarefas nem campos do cliente.', input: contract.listHonorariosInput, output: contract.honorariosListDto },
  k5_honorarios_get: { ...policy, effect: 'read', description: 'Consulta honorário, parcelas e histórico de recebimentos.', input: contract.getHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_options: { ...policy, effect: 'read', description: 'Busca clientes e casos próprios para um honorário.', input: contract.honorariosOptionsInput, output: contract.honorariosOptionsDto },
  k5_honorarios_create: { ...policy, effect: 'write', description: 'Cadastra honorário e parcelas.', input: contract.createHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_receive: { ...policy, effect: 'write', description: 'Registra recebimento manual da parcela consultada. Para quitação integral use pendingCents como amountCents. Exige data e meio de recebimento informados pela pessoa; pergunte se faltarem. Use o id da parcela, nunca clientId ou agreementId. Não movimenta dinheiro nem emite cobrança.', input: contract.receiveHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_reverse: { ...policy, effect: 'write', description: 'Estorna registro de recebimento com motivo.', input: contract.reverseHonorarioInput, output: contract.honorarioDetailDto },
  k5_honorarios_cancel: { ...policy, effect: 'write', description: 'Cancela honorário sem recebimentos líquidos.', input: contract.cancelHonorarioInput, output: contract.honorarioDetailDto },
} as const satisfies Record<string, Capability>;
