# Feedback humano como base para treinamento

Pesquisa de fontes primárias consultadas em 21/09/2026. Recomendações de desenho do dataset; não representa treinamento executado nem conclusão jurídica sobre contratos particulares.

## O que podemos aproveitar

Preferências entre respostas ao mesmo contexto geram exemplos `prompt`, `chosen`, `rejected`, úteis para reward modeling e DPO. SFT usa demonstrações de resposta desejada, em formato de conversa ou prompt/completion. Um voto expressa preferência relativa: não demonstra sozinho que a resposta vencedora esteja correta. Para SFT, recomendamos revisão especializada e, quando necessário, edição da resposta antes de aprová-la. [Formatos oficiais do TRL](https://huggingface.co/docs/trl/dataset_formats).

Reward modeling aprende uma função que atribui maior recompensa à resposta preferida. A documentação do TRL exemplifica remover empates antes de formar pares. Notas por dimensão e comentários podem apoiar auditoria e adjudicação; não devem ser transformados automaticamente em verdades objetivas. [RewardTrainer](https://huggingface.co/docs/trl/reward_trainer).

DPO usa pares de preferência para ajustar a política sem exigir um reward model separado. Coletar feedback prepara dados para esses métodos; ainda não constitui uma execução de RLHF. [Artigo original de DPO](https://arxiv.org/abs/2305.18290).

## Restrições de origem: avaliação e treino têm elegibilidades distintas

| Provedor | Evidência pública consultada | Regra operacional recomendada |
| --- | --- | --- |
| DeepSeek API | Os termos Open Platform, §4.2, incluem expressamente treinamento de outros modelos e destilação entre os usos permitidos, condicionado ao restante dos termos e direitos sobre entradas/saídas. | `pending_review` até revisar documentos, privacidade e destino; há permissão pública explícita para esse tipo de uso. |
| Meta Model API | §10(ix) restringe treinamento, fine-tuning, destilação e coleta sistemática de outputs para datasets destinados a modelos/serviços concorrentes sem autorização escrita. A mesma cláusula exclui avaliação/benchmark/qualidade dos próprios sistemas dessa proibição. §10(xi) também restringe divulgação pública de benchmarks para promover concorrentes. | `evaluation_only` por padrão; não exportar outputs Meta como exemplos de treino nem coletá-los com essa finalidade enquanto a elegibilidade não for resolvida. |
| Inception | A seção de restrições veda uso que concorra direta ou indiretamente com a Inception ou seus serviços. A autorização de uso de outputs é subordinada às demais restrições. Não localizamos autorização explícita equivalente à do DeepSeek para treinar outros modelos. | `evaluation_only` por padrão; revisar termos aplicáveis à conta e possível autorização antes de exportar para treino. |

Fontes da tabela: [DeepSeek Open Platform §4.2](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), [Meta Model API §10](https://dev.meta.ai/legal/terms-of-service), [Inception Terms of Use](https://www.inceptionlabs.ai/docs/terms-of-use).

Esses estados são proposta conservadora de implementação, não declaração de que todo treinamento seria proibido. O enquadramento como concorrente e eventuais contratos específicos permanecem desconhecidos. Um output restrito continua restrito quando ocupa o campo `rejected`; corrigir ou extrair seu texto não elimina automaticamente sua origem. Revisar também pares e dados derivados, sem assumir que rótulos humanos neutralizam as condições do conteúdo avaliado.

Os termos da Meta diferenciam Standard (conteúdo não usado para treinar modelos Meta) e Discounted (pode ser usado para treinamento; não admite conteúdo sensível, confidencial ou pessoal). Registrar a modalidade realmente usada. Uma licença de pesos abertos não substitui os termos da API. [Meta §§1, 5–6](https://dev.meta.ai/legal/terms-of-service).

O repositório Harvey LAB publica licença MIT, com preservação de avisos. Registrar commit e licença; verificar também a origem de cada documento e quaisquer avisos específicos. A licença do harness não deve ser tratada como prova automática dos direitos sobre todo material posteriormente anexado pelo escritório. [Licença Harvey LAB](https://raw.githubusercontent.com/harveyai/harvey-labs/main/LICENSE).

## Campos mínimos recomendados

Campos abaixo são proposta para Lume, não descrição garantida do schema atual:

| Entidade | Conteúdo |
| --- | --- |
| Tarefa e contexto | `task_id`, versão, prompt completo, mensagens de sistema, referência e hash do conjunto documental, idioma, domínio e grupo de origem. |
| Execução | `run_id`, provedor, ID solicitado e retornado do modelo, modalidade da API, parâmetros, ferramentas disponíveis, versão/commit do harness, horário, estado final, erros, tokens e latência. |
| Artefatos | Arquivo original, hash, MIME, extração textual/estruturada versionada, trilha de geração; evitar usar apenas o “arquivo criado” da última mensagem como resposta de treino. |
| Avaliação | Avaliador pseudonimizado, escritório na camada de acesso, candidatos realmente vistos, ordem A/B/C, preferência/empate/nenhuma, notas com rubrica versionada, comentário, horário e instante da revelação dos modelos. |
| Curadoria | Estado de revisão, resposta corrigida separada da original, revisor, motivo, evidências documentais e confiança. |
| Governança | Fonte/licença/versão dos termos, finalidade informada, autorização/base aplicável, revisão de dados pessoais/sigilosos, elegibilidade por finalidade, motivo e evidência da liberação/revogação. |
| Exportação | Versão do dataset, IDs/hash de origem, regras/filtros, split e motivos de exclusão; identidades e credenciais fora do arquivo de treino. |

Com três candidatos, selecionar A como melhor sustenta A>B e A>C apenas se os três tiverem sido efetivamente avaliados. Não inferir B>C. Preservar “empate”, “nenhuma adequada” e “não avaliei”; manter o voto original para evitar contagem artificial de evidência independente.

## Portas de entrada para um dataset utilizável

1. **Direitos e finalidade:** elegibilidade resolvida para prompt, fontes e todos os outputs do exemplo; aplicar o mesmo filtro aos dois lados de um par. Conteúdo `evaluation_only` não entra no dataset de treino.
2. **Integridade:** contexto e respostas completos, hash conferido, execução identificável, modelo sem revelação prévia quando se declarar avaliação cega. Mudança do conjunto de candidatos deve criar nova versão, preservando votos anteriores.
3. **Qualidade:** revisão de afirmações/citações para SFT; preferências e desacordos preservados para RM/DPO. Não escolher um vencedor artificial para empate ou ausência de resposta adequada.
4. **Privacidade:** excluir credenciais, restringir informações do escritório e aplicar a política de autorização, retenção e exclusão também aos exports. Pseudonimização não torna automaticamente os dados anônimos.
5. **Separação:** agrupar tarefa, versões e documentos relacionados antes de dividir treino/validação/teste. Não dividir aleatoriamente votos do mesmo exemplo entre splits.

A recomendação de split aplica a orientação de validação por grupos: grupos presentes na validação devem estar ausentes do treino. Para Lume, propomos grupos por tarefa e família documental, com deduplicação de variantes e verificação de sobreposição. [Validação por grupos do scikit-learn](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-iterators-for-grouped-data).

Um piloto com uma tarefa permite validar o fluxo de coleta; não oferece grupos independentes suficientes para medir generalização. Para treinar, ampliar tarefas e fontes, reservar casos inéditos e separar o benchmark de avaliação final. Milhares de votos sobre os mesmos três artefatos aumentam evidência de preferência local, não a diversidade de tarefas.
