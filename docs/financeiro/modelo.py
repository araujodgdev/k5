"""Modelo financeiro do Lume, out/2026 a jan/2027, com projecao ate dez/2027.

Uso: python docs/financeiro/modelo.py
Escreve docs/financeiro/resultado.json com premissas e resultados mensais.

Todas as quantias sao hipoteses, nao metricas observadas.
"""
import json
from pathlib import Path

MESES = ["out/26", "nov/26", "dez/26", "jan/27", "fev/27", "mar/27", "abr/27", "mai/27", "jun/27", "jul/27", "ago/27", "set/27", "out/27", "nov/27", "dez/27"]

PRECO_SOLO = 199
PRECO_EQUIPE = 349

CENARIOS = {
    "meta": {
        "nome": "Meta",
        "novas": [10, 12, 14, 10, 12, 14, 16, 16, 16, 16, 16, 16, 16, 16, 16],
        "mix_solo": 2 / 3,
        "churn": 0.03,
        "custo_variavel": 0.25,
        "cac_caixa": 300,
        "custo_fixo": 4000,
    },
    "central": {
        "nome": "Central",
        "novas": [4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 10, 10, 10, 10, 10],
        "mix_solo": 0.75,
        "churn": 0.05,
        "custo_variavel": 0.30,
        "cac_caixa": 500,
        "custo_fixo": 4000,
    },
}

# Conta vendida no mes paga metade da mensalidade nesse mes (teste de 7 dias e entrada ao longo do mes).
FRACAO_PRIMEIRO_MES = 0.5


def arpa(mix_solo):
    return mix_solo * PRECO_SOLO + (1 - mix_solo) * PRECO_EQUIPE


def simular(c):
    a = arpa(c["mix_solo"])
    ativas = 0.0
    caixa = 0.0
    linhas = []
    for mes, novas in zip(MESES, c["novas"]):
        base = ativas * (1 - c["churn"])
        ativas = base + novas
        receita = (base + novas * FRACAO_PRIMEIRO_MES) * a
        variavel = receita * c["custo_variavel"]
        aquisicao = novas * c["cac_caixa"]
        fixo = c["custo_fixo"]
        resultado = receita - variavel - aquisicao - fixo
        caixa += resultado
        linhas.append({
            "mes": mes,
            "novas": novas,
            "ativas": round(ativas, 1),
            "mrr_cheio": round(ativas * a),
            "receita": round(receita),
            "custo_variavel": round(variavel),
            "aquisicao": round(aquisicao),
            "custo_fixo": fixo,
            "resultado": round(resultado),
            "caixa_acumulado": round(caixa),
        })
    return {"arpa": round(a, 2), "linhas": linhas}


def contas_para_equilibrio(c, custo_fixo):
    a = arpa(c["mix_solo"])
    return custo_fixo / (a * (1 - c["custo_variavel"]))


if __name__ == "__main__":
    saida = {"premissas": CENARIOS, "precos": {"solo": PRECO_SOLO, "equipe": PRECO_EQUIPE}, "resultados": {}}
    for chave, c in CENARIOS.items():
        r = simular(c)
        saida["resultados"][chave] = r
        print(f"\n{c['nome']}  ARPA R${r['arpa']}")
        print(f"{'mes':7}{'novas':>6}{'ativas':>8}{'receita':>9}{'var':>7}{'aquis':>7}{'fixo':>7}{'result':>8}{'caixa':>8}")
        for l in r["linhas"]:
            print(f"{l['mes']:7}{l['novas']:>6}{l['ativas']:>8}{l['receita']:>9}{l['custo_variavel']:>7}{l['aquisicao']:>7}{l['custo_fixo']:>7}{l['resultado']:>8}{l['caixa_acumulado']:>8}")
        pior = min(l["caixa_acumulado"] for l in r["linhas"])
        print("pior caixa acumulado:", pior)
        for f in (3000, 4000, 5000, 6000, 8000):
            print(f"  custo fixo R${f}: {contas_para_equilibrio(c, f):.1f} contas ativas para empatar (sem aquisicao)")
    Path(__file__).with_name("resultado.json").write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8")


