import { calculationInput, calculationResult, type CalculationInput, type CalculationResult, type Observation, type Series } from './contracts';
import { D, cents, daysBetween, monthOf, monthParts, monthRange, nextMonth } from './math';

export const ENGINE_VERSION = '2026.10.1';
const row = (label: string, totalCents: number, formula: string, day = '') => ({ label, date: day, principalCents: totalCents, correctionCents: 0, interestCents: 0, penaltyCents: 0, paidCents: 0, totalCents, formula });
const taxSource = 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/pagamento-em-atraso';
const cdcSource = 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm';

export function requiredObservations(input: CalculationInput): { series: Series; month: string }[] {
  const needs = new Map<string, { series: Series; month: string }>();
  const add = (series: Series, month: string) => needs.set(`${series}:${month}`, { series, month });
  if (input.kind === 'tax') {
    monthRange(nextMonth(monthOf(input.originOn)), monthOf(input.asOf)).filter(month => month < monthOf(input.asOf)).forEach(month => add('selic', month));
  } else if ('entries' in input) {
    for (const entry of input.entries) {
      if (input.index !== 'none') monthRange(nextMonth(monthOf(entry.dueOn)), monthOf(input.asOf)).filter(month => month < monthOf(input.asOf)).forEach(month => add(input.index === 'inpc' ? 'inpc' : 'ipca', month));
      if (input.interest.kind === 'legal') monthParts(entry.interestFrom ?? entry.dueOn, input.asOf).forEach(part => add('legal', part.month));
    }
  }
  return [...needs.values()];
}

export function calculate(raw: CalculationInput, observations: Observation[] = []): CalculationResult {
  const input = calculationInput.parse(raw);
  const used: Observation[] = [];
  for (const need of requiredObservations(input)) {
    const matches = observations.filter(item => item.series === need.series && item.month === need.month);
    if (matches.length !== 1) throw new Error(`Índice ${need.series.toUpperCase()} ausente ou duplicado em ${need.month}. Não foi concluído o cálculo.`);
    const observation = matches[0];
    if (!new D(observation.value).isFinite() || new D(observation.value).lte(-100)) throw new Error('Índice inválido.');
    used.push(observation);
  }
  function indexValue(series: Series, month: string) {
    const found = used.find(value => value.series === series && value.month === month);
    if (!found) throw new Error(`Índice ${series} ausente em ${month}.`);
    return new D(found.value);
  }
  const result: CalculationResult = { engineVersion: ENGINE_VERSION, totalCents: 0, rows: [], notes: [], sources: [], observations: used };

  if (input.kind === 'tax') {
    const months = used.filter(item => item.series === 'selic');
    const laterMonth = monthOf(input.asOf) > monthOf(input.originOn);
    const rate = months.reduce((sum, item) => sum.plus(item.value), new D(laterMonth ? 1 : 0));
    const lateDays = input.asOf >= input.moraStart && input.asOf > input.originOn ? daysBetween(input.moraStart, input.asOf) + 1 : 0;
    const penaltyRate = input.operation === 'debt' ? D.min(new D(lateDays).times('0.33'), 20) : new D(0);
    const interest = cents(new D(input.principalCents).times(rate).div(100));
    const penalty = cents(new D(input.principalCents).times(penaltyRate).div(100));
    result.rows.push({ ...row(input.operation === 'debt' ? 'Débito federal atualizado' : 'Crédito federal atualizado', input.principalCents, `SELIC somada ${rate.toString().replace('.', ',')}% × principal; multa ${penaltyRate.toString().replace('.', ',')}% (${lateDays} dias).`, input.asOf), interestCents: interest, penaltyCents: penalty, totalCents: input.principalCents + interest + penalty });
    result.notes.push(input.legalBasis, 'SELIC do mês seguinte à origem até o anterior à data-base, acrescida de 1% no mês final. Sem juros se origem e data-base estiverem no mesmo mês.', 'Regime federal informado. Não abrange ICMS, ISS, IPTU, multas de ofício, parcelamentos ou regimes especiais. Confira vencimento legal e primeiro dia útil da mora no calendário aplicável.');
    result.sources.push(taxSource, 'https://www.planalto.gov.br/ccivil_03/leis/l9430.htm', 'https://www.planalto.gov.br/ccivil_03/leis/l9250.htm');
  } else if (input.kind === 'labor') {
    const salary = new D(input.salaryCents);
    const noticeMultiplier = input.termination === 'agreement' ? '0.5' : '1';
    const fine = input.termination === 'dismissal' ? 40 : input.termination === 'agreement' ? 20 : 0;
    result.rows.push(row('Saldo de salário', cents(salary.times(input.salaryDays).div(30)), `Salário ÷ 30 × ${input.salaryDays} dias`),
      row('13º proporcional', cents(salary.times(input.thirteenthMonths).div(12)), `Salário × ${input.thirteenthMonths}/12`),
      row('Férias proporcionais + 1/3', cents(salary.times(input.vacationMonths).div(12).times(4).div(3)), `Salário × ${input.vacationMonths}/12 × 4/3`),
      row('Férias integrais simples + 1/3', cents(salary.times(input.vacationPeriods).times(4).div(3)), `Salário × ${input.vacationPeriods} períodos × 4/3`),
      row('Aviso indenizado', cents(salary.times(input.noticeDays).div(30).times(noticeMultiplier)), `Salário ÷ 30 × ${input.noticeDays} dias × ${noticeMultiplier}`),
      row('Indenização sobre FGTS', cents(new D(input.fgtsBaseCents).times(fine).div(100)), `Base rescisória informada × ${fine}%`),
      row('Deduções informadas', -input.deductionsCents, 'Deduções conferidas pelo responsável'));
    result.notes.push(input.basis, 'Estimativa assistida para mensalista CLT. Avos devem incluir a projeção do aviso quando aplicável. Férias integrais são simples, sem dobra. A base do FGTS deve ser a base rescisória, não apenas o saldo disponível.', 'Não calcula automaticamente INSS, IRRF, horas extras, adicionais, reflexos, multas dos arts. 467/477 ou depósitos faltantes de FGTS. O total inclui a indenização de FGTS em rubrica separada.');
    result.sources.push('https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm', 'https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm');
  } else if (input.kind === 'revision') {
    const schedule = (percent: string) => {
      const monthly = new D(percent).div(100); const principal = new D(input.principalCents); const n = input.installments;
      const fixed = monthly.isZero() ? principal.div(n) : principal.times(monthly).div(new D(1).minus(new D(1).plus(monthly).pow(-n)));
      let balance = principal;
      return Array.from({ length: n }, (_, index) => {
        const interest = new D(cents(balance.times(monthly)));
        const amortization = index === n - 1 ? balance : D.min(balance, new D(cents(input.system === 'sac' ? principal.div(n) : fixed.minus(interest))));
        balance = balance.minus(amortization);
        return { payment: cents(amortization.plus(interest)), balance: cents(balance) };
      });
    };
    const contracted = schedule(input.contractualMonthlyPercent); const alternative = schedule(input.alternativeMonthlyPercent);
    for (const [index, current] of contracted.entries()) {
      const alternate = alternative[index];
      result.rows.push(row(`Parcela ${index + 1}${index < input.paidInstallments ? ' · paga' : ''}`, current.payment - alternate.payment, `Contratada R$ ${(current.payment / 100).toFixed(2).replace('.', ',')}; alternativa R$ ${(alternate.payment / 100).toFixed(2).replace('.', ',')}; saldos R$ ${(current.balance / 100).toFixed(2).replace('.', ',')} / R$ ${(alternate.balance / 100).toFixed(2).replace('.', ',')}`));
    }
    result.notes.push(input.rateSource, `Sistema ${input.system.toUpperCase()}; taxas mensais de ${input.contractualMonthlyPercent.replace('.', ',')}% e ${input.alternativeMonthlyPercent.replace('.', ',')}%. Total representa a diferença nominal de todas as prestações.`, `Diferença nas ${input.paidInstallments} parcelas pagas: R$ ${(result.rows.slice(0, input.paidInstallments).reduce((sum, item) => sum + item.totalCents, 0) / 100).toFixed(2).replace('.', ',')}.`, 'Simulação de prestações mensais regulares, sem carência, indexação, tarifas, seguros ou atraso. Não é apuração de CET nem conclusão de abusividade. Taxa alternativa e modalidade devem ser conferidas.');
    result.sources.push('https://www.bcb.gov.br/estatisticas/txjuros', 'https://processo.stj.jus.br/jurisprudencia/externo/informativo/?livre=%40CNOT%3D021259');
  } else {
    result.notes.push('Correção por competências completas: do mês seguinte ao vencimento até o mês anterior à data-base. Cada índice é aplicado na abertura do mês seguinte à competência. Juros simples, dias decorridos excluindo o dia final, proporcionais aos dias corridos de cada mês.', 'Pagamentos são imputados primeiro a juros, depois à multa e ao principal corrigido. Juros acumulam sem arredondamento intermediário e são atualizados pelo mesmo índice do principal, sem capitalização. A multa incide uma vez ao iniciar o atraso. Valores exibidos são arredondados em centavos; pode haver diferença de um centavo entre a soma das linhas exibidas e o saldo final.');
    if (input.kind === 'consumer') { result.notes.push(input.legalBasis, `Restituição ${input.restitution === 'double' ? 'em dobro' : 'simples'} sobre valores pagos indevidamente. Pagamentos nesta memória significam restituições já recebidas. A hipótese jurídica é informada pelo responsável.`); result.sources.push(cdcSource); }
    if (input.kind === 'pension') result.notes.push(input.basis, 'Os valores de cada competência devem refletir o título e suas alterações. Não se presume percentual de renda ou incidência sobre 13º.');
    if (input.kind === 'rent') result.notes.push(input.contractBasis, `Reajuste de ${input.annualAdjustmentPercent.replace('.', ',')}% a cada aniversário desde ${input.anniversary}. Cada valor informado é o aluguel-base anterior ao primeiro aniversário.`);
    for (const [position, entry] of input.entries.entries()) {
      let principal = new D(entry.amountCents);
      if (input.kind === 'consumer' && input.restitution === 'double') principal = principal.times(2);
      if (input.kind === 'rent') {
        let anniversaries = 0;
        for (let year = Number(input.anniversary.slice(0, 4)); year <= Number(entry.dueOn.slice(0, 4)); year++) if (`${year}${input.anniversary.slice(4)}` <= entry.dueOn) anniversaries++;
        principal = new D(cents(principal.times(new D(1).plus(new D(input.annualAdjustmentPercent).div(100)).pow(anniversaries))));
      }
      let interest = new D(0); let penalty = new D(0); let lastDate = entry.dueOn;
      const payments = input.payments.filter(item => item.installment === position + 1);
      const events = new Set([input.asOf, ...payments.map(item => item.paidOn), ...monthRange(nextMonth(monthOf(entry.dueOn)), monthOf(input.asOf)).map(month => `${month}-01`)]);
      let penaltyApplied = false;
      result.rows.push(row(`${position + 1}. ${entry.description} · principal`, cents(principal), input.kind === 'consumer' ? `Valor indevido × ${input.restitution === 'double' ? 2 : 1}` : 'Base da parcela', entry.dueOn));
      for (const eventDate of [...events].filter(day => day >= entry.dueOn && day <= input.asOf).sort()) {
        const startPrincipal = principal; let increment = new D(0); let correction = new D(0); let newPenalty = new D(0);
        if (eventDate > lastDate && principal.gt(0)) {
          if (!penaltyApplied) { newPenalty = new D(cents(principal.times(input.penaltyPercent).div(100))); penalty = penalty.plus(newPenalty); penaltyApplied = true; }
          const interestStart = entry.interestFrom && entry.interestFrom > lastDate ? entry.interestFrom : lastDate;
          for (const part of monthParts(interestStart, eventDate)) {
            const percent = input.interest.kind === 'none' ? new D(0) : input.interest.kind === 'legal' ? indexValue('legal', part.month) : new D(input.interest.percent);
            increment = increment.plus(principal.times(percent).div(100).times(part.days).div(part.monthDays));
          }
        }
        if (input.index !== 'none' && eventDate.endsWith('-01')) {
          const preceding = new Date(`${eventDate}T00:00:00Z`); preceding.setUTCDate(0);
          const competence = preceding.toISOString().slice(0, 7);
          if (competence > monthOf(entry.dueOn)) {
            const factor = indexValue(input.index, competence).div(100);
            const principalCorrection = new D(cents(principal.times(factor)));
            const interestCorrection = interest.plus(increment).times(factor);
            correction = principalCorrection.plus(interestCorrection);
            principal = principal.plus(principalCorrection);
            interest = interest.plus(interestCorrection);
          }
        }
        interest = interest.plus(increment);
        const paid = payments.filter(item => item.paidOn === eventDate).reduce((sum, payment) => sum.plus(payment.amountCents), new D(0));
        if (paid.gt(0)) interest = new D(cents(interest));
        if (paid.gt(principal.plus(interest).plus(penalty))) throw new Error(`O pagamento da parcela ${position + 1} excede o saldo em ${eventDate}.`);
        let remaining = paid;
        const paidInterest = D.min(remaining, interest); interest = interest.minus(paidInterest); remaining = remaining.minus(paidInterest);
        const paidPenalty = D.min(remaining, penalty); penalty = penalty.minus(paidPenalty); remaining = remaining.minus(paidPenalty);
        principal = principal.minus(remaining);
        if (eventDate > lastDate || paid.gt(0)) result.rows.push({ label: `${position + 1}. ${entry.description}`, date: eventDate, principalCents: cents(startPrincipal), correctionCents: cents(correction), interestCents: cents(increment), penaltyCents: cents(newPenalty), paidCents: cents(paid), totalCents: cents(principal.plus(interest).plus(penalty)), formula: `Saldo anterior + correção + juros simples de ${lastDate} a ${eventDate} + multa − pagamentos` });
        lastDate = eventDate;
      }
      result.totalCents += cents(principal.plus(interest).plus(penalty));
    }
    if (input.interest.kind === 'legal') result.sources.push('https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=5171&tipo=resolu%C3%A7%C3%A3o+cmn');
  }
  if (!('entries' in input)) result.totalCents = result.rows.reduce((sum, item) => sum + item.totalCents, 0);
  result.sources.push(...new Set(used.map(item => item.source)));
  return calculationResult.parse(result);
}
