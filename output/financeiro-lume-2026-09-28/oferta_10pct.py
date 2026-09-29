"""Oferta alternativa: R$10 mil por 10%, com uma conta Solo sem mensalidade."""
import json
from pathlib import Path
from calcular import SCENARIOS, simulate, INVESTMENT, SETUP

ROOT = Path(__file__).resolve().parent
results = []
for scenario in SCENARIOS:
    base = simulate(scenario, equity=.1)
    token = base['summary']['token_per_active_user']
    # Um usuario ativo; tokens reembolsados ao custo, sem markup.
    # A empresa absorve auxiliares, infra e provisao sobre o reembolso recebido.
    subsidy = scenario['auxiliary'] + 3 + token*.12
    cumulative = -SETUP
    distributed = 0
    rows = []
    for original in base['months']:
        result = original['result'] - subsidy
        cumulative += result
        target = .5 * max(0, cumulative-original['required_reserve'])
        payout = max(0, target-distributed)
        distributed += payout
        row = dict(month=original['month'], result=result, subsidy=subsidy,
                   cumulative=cumulative, distribution=payout,
                   investor_month=payout*.1, investor_total=distributed*.1,
                   cash_without_extra_funding=INVESTMENT+cumulative-distributed,
                   saving_month=199-token, saving_total=(199-token)*original['month'])
        row['cash_roi_percent'] = (row['investor_total']/INVESTMENT-1)*100
        rows.append(row)
    def first(predicate):
        return next((r['month'] for r in rows if predicate(r)),None)
    payback=first(lambda r:r['investor_total']>=INVESTMENT)
    if payback:
        assert rows[payback-1]['investor_total']>=INVESTMENT
        assert rows[payback-2]['investor_total']<INVESTMENT
    assert abs(sum(r['investor_month'] for r in rows)-rows[-1]['investor_total'])<1e-7
    summary=dict(scenario=scenario['name'],equity=.1,pre_money=90000,post_money=100000,
                 free_scope='1 escritorio, 1 usuario ativo, equivalente Solo de R$199',
                 token_reimbursement_estimate=token,non_token_subsidy=subsidy,
                 investor_payback_month=payback,
                 first_distribution=first(lambda r:r['distribution']>0),
                 minimum_capital_year1=max(SETUP,-min(r['cumulative'] for r in rows[:12])),
                 capital_gap_year1=max(0,-min(r['cumulative'] for r in rows[:12])-INVESTMENT),
                 cash_exhaustion=first(lambda r:r['cash_without_extra_funding']<0),
                 snapshots={str(m):rows[m-1] for m in [12,24,36,60]})
    results.append(dict(summary=summary,months=rows))
    print(json.dumps(summary,ensure_ascii=False))
(ROOT/'oferta-10pct.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
