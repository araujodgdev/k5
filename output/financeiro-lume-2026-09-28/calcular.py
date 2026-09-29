"""Projecao nominal do Lume. Executar: python calcular.py. Sem dependencias externas."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FX = 5.50  # Cambio orcamentario efetivo, nao cotacao spot.
INVESTMENT = 10000
NEGOTIATED_PRE_MONEY = 250000
EQUITY = INVESTMENT / (NEGOTIATED_PRE_MONEY + INVESTMENT)
SETUP = 2000
MONTHS = 60
SCENARIOS = [
    dict(name="Menos favoravel", ticket=199, users=1, new=[3,3,3,3,3], churn=.05,
         input_m=8, output_m=.5, premium=.3, auxiliary=10, cash_cac=400,
         pro_labore=3000, cloudflare=300, postgres=120, tools=350, accounting=500, other=150, multiple=1),
    dict(name="Central", ticket=249, users=1.4, new=[8,15,30,30,30], churn=.03,
         input_m=5, output_m=.3, premium=.2, auxiliary=6, cash_cac=250,
         pro_labore=3000, cloudflare=150, postgres=80, tools=250, accounting=400, other=150, multiple=2),
    dict(name="Mais favoravel", ticket=299, users=1.8, new=[15,25,40,40,40], churn=.02,
         input_m=3, output_m=.2, premium=.1, auxiliary=4, cash_cac=180,
         pro_labore=6000, cloudflare=250, postgres=180, tools=400, accounting=600, other=200, multiple=3),
]


def simulate(s, equity=EQUITY, pro_labore_override=None, payout_ratio=.5, growth=True):
    payroll = s['pro_labore'] if pro_labore_override is None else pro_labore_override
    fixed_base = payroll * 1.2 + sum(s[k] for k in ['cloudflare','postgres','tools','accounting','other']) + 5*FX
    input_rate = .20 * (1-s['premium']) + 3*s['premium']
    output_rate = .75 * (1-s['premium']) + 15*s['premium']
    token = (s['input_m']*input_rate + s['output_m']*output_rate) * FX * 1.2
    ai_user = token + s['auxiliary']
    variable_account = ai_user*s['users'] + 3
    contribution = s['ticket']*.88 - variable_account
    accounts = 0
    cumulative = -SETUP
    distributed = 0
    rows = []
    for month in range(1, MONTHS+1):
        year_index = (month-1)//12
        acquired = s['new'][year_index] if growth else s['new'][0]
        accounts = accounts*(1-s['churn']) + acquired
        scale_blocks = max(0, math.ceil(accounts/100)-1)
        escalation = 1.05**year_index
        support = scale_blocks*2500*escalation
        infra_scale = scale_blocks*150*escalation
        fixed = fixed_base*escalation + support + infra_scale
        revenue = accounts*s['ticket']
        inference = accounts*s['users']*token
        auxiliary = accounts*s['users']*s['auxiliary']
        infra_variable = accounts*3
        taxes_and_fees = revenue*.12
        acquisition = acquired*s['cash_cac']
        costs = fixed+inference+auxiliary+infra_variable+taxes_and_fees+acquisition
        result = revenue-costs
        cumulative += result
        # 50% do lucro acumulado acima de 2 meses de fixos. Nunca redistribui o mesmo lucro.
        reserve = 2*fixed
        target = payout_ratio*max(0,cumulative-reserve)
        payout = max(0,target-distributed)
        distributed += payout
        row = dict(month=month, acquired=acquired, accounts=accounts, active_users=accounts*s['users'],
                   revenue=revenue, fixed=fixed, inference=inference, auxiliary=auxiliary,
                   infra_variable=infra_variable, taxes_and_fees=taxes_and_fees, acquisition=acquisition,
                   total_costs=costs, result=result, cumulative_before_distributions=cumulative,
                   required_reserve=reserve, distribution=payout, distributed=distributed,
                   investor_received_month=payout*equity, investor_received_total=distributed*equity,
                   cash_without_extra_funding=INVESTMENT+cumulative-distributed)
        assert abs(revenue-costs-result)<1e-7
        assert abs(row['cash_without_extra_funding']-(INVESTMENT+cumulative-distributed))<1e-7
        rows.append(row)
    def first(predicate):
        return next((r['month'] for r in rows if predicate(r)), None)
    peak_need = max(SETUP, -min(r['cumulative_before_distributions'] for r in rows))
    m12 = rows[11]
    arr = m12['revenue']*12
    valuation = arr*s['multiple']*.5
    summary = dict(fixed_base=fixed_base, token_per_active_user=token, ai_per_active_user=ai_user,
                   input_usd_per_million=input_rate, output_usd_per_million=output_rate,
                   contribution_per_account=contribution, contribution_margin=contribution/s['ticket'],
                   first_year_break_even_accounts=math.ceil((fixed_base+s['new'][0]*s['cash_cac'])/contribution),
                   monthly_break_even=first(lambda r:r['result']>=0),
                   cumulative_break_even=first(lambda r:r['cumulative_before_distributions']>=0),
                   business_generated_10k=first(lambda r:r['cumulative_before_distributions']>=INVESTMENT),
                   investor_payback=first(lambda r:r['investor_received_total']>=INVESTMENT),
                   cash_exhaustion_without_extra_funding=first(lambda r:r['cash_without_extra_funding']<0),
                   minimum_capital_60m=peak_need, funding_gap=max(0,peak_need-INVESTMENT),
                   capital_for_year1=max(SETUP,-min(r['cumulative_before_distributions'] for r in rows[:12])),
                   indicative_pre_money=valuation, indicative_post_money=valuation+INVESTMENT,
                   equity_at_indicative_valuation=INVESTMENT/(valuation+INVESTMENT),
                   revenue_year1=sum(r['revenue'] for r in rows[:12]),
                   result_year1=sum(r['result'] for r in rows[:12]),
                   snapshots={str(m):rows[m-1] for m in [1,3,6,12,24,36,60]})
    return dict(assumptions=s, summary=summary, months=rows)


def main():
    results = [simulate(s) for s in SCENARIOS]
    sensitivity = {}
    central = SCENARIOS[1]
    for label,kwargs in [('prolabore_2000',dict(pro_labore_override=2000)),
                         ('prolabore_4000',dict(pro_labore_override=4000)),
                         ('vendas_sem_aceleracao',dict(growth=False)),
                         ('distribuicao_25pct',dict(payout_ratio=.25)),
                         ('distribuicao_100pct',dict(payout_ratio=1))]:
        sensitivity[label] = simulate(central,**kwargs)['summary']
    for item in results:
        s=item['assumptions']; r=item['summary']
        hypothetical_equity = r['equity_at_indicative_valuation']
        r['investor_payback_at_scenario_valuation']=simulate(s,equity=hypothetical_equity)['summary']['investor_payback']
        expected = s['new'][0]*(1-(1-s['churn'])**12)/s['churn']
        assert abs(expected-r['snapshots']['12']['accounts'])<1e-9
        first=r['investor_payback']
        if first:
            assert item['months'][first-1]['investor_received_total']>=INVESTMENT
            assert first==1 or item['months'][first-2]['investor_received_total']<INVESTMENT
    output=dict(date='2026-09-28',currency='BRL',fx=FX,investment=INVESTMENT,
                assumed_negotiated_pre_money=NEGOTIATED_PRE_MONEY,investor_equity=EQUITY,
                setup=SETUP,months=MONTHS,scenarios=results,sensitivity=sensitivity)
    (ROOT/'projecoes.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    for r in results:
        concise={k:v for k,v in r['summary'].items() if k!='snapshots'}
        concise['month12']=r['summary']['snapshots']['12']
        print(r['assumptions']['name'],json.dumps(concise,ensure_ascii=False))
    print('SENSITIVITY', json.dumps({k:{f:v[f] for f in ['investor_payback','minimum_capital_60m','monthly_break_even']} for k,v in sensitivity.items()}))


if __name__=='__main__':
    main()
