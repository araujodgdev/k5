"""Calendario e comparacao comercial. Nao gera contrato nem altera a oferta anterior."""
import calendar
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
base = json.loads((ROOT/'projecoes.json').read_text(encoding='utf-8'))
equity = json.loads((ROOT/'oferta-10pct.json').read_text(encoding='utf-8'))
schedule=[]
for i in range(20):
    year=2027+i//12
    month=i%12+1
    schedule.append(dict(installment=i+1,date=f'{year}-{month:02}-{calendar.monthrange(year,month)[1]}',
                         payment=500,paid=(i+1)*500,balance=10000-(i+1)*500))
assert sum(r['payment'] for r in schedule)==10000
assert schedule[-1]['date']=='2028-08-31'
assert schedule[-1]['balance']==0
comparison=[]
for scenario in equity:
    s=scenario['summary']
    row=dict(scenario=s['scenario'],first_distribution_month=s['first_distribution'],
             recovery_month=s['investor_payback_month'],
             received_12=s['snapshots']['12']['investor_total'],
             received_24=s['snapshots']['24']['investor_total'],
             received_36=s['snapshots']['36']['investor_total'])
    for prefix,number in [('recovery_date',row['recovery_month']),('first_distribution_date',row['first_distribution_month'])]:
        if number is not None:
            offset=9+number-1
            row[prefix]=f'{2026+offset//12}-{offset%12+1:02}'
    comparison.append(row)
triggers=[]
for scenario in base['scenarios']:
    rev=[r['revenue'] for r in scenario['months'][:3]]
    triggers.append(dict(scenario=scenario['assumptions']['name'],october=rev[0],november=rev[1],december=rev[2],
                         refund_triggered=not(rev[1]>rev[0] and rev[2]>rev[1])))
assert all(not r['refund_triggered'] for r in triggers)
central=base['scenarios'][1]['summary']
subsidy=equity[1]['summary']['non_token_subsidy']
operating=3*central['contribution_per_account']-central['fixed_base']-subsidy
output=dict(assumed_start='2026-10',assessment='2026-12-31',first_installment='2027-01-31',
            equity_status='Confirmado pelo fundador: devolucao substitui os 10%; transferencia e direitos durante parcelamento a formalizar',
            no_interest_or_indexation=True,scheduled_repayments=schedule,
            refunded_principal_month12=4500,refunded_principal_month24=10000,
            nominal_cash_roi_when_fully_repaid=0,
            refunds_are_cash_financing_outflows_not_operating_expenses=True,
            equity_comparison=comparison,growth_triggers=triggers,
            stagnant_example=dict(paying_accounts=3,ticket=249,monthly_acquisition_spending=0,
                                  operating_result=operating,cash_after_500_payment=operating-500))
(ROOT/'comparacao-modalidades.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(output,ensure_ascii=False,indent=2))
