# ✗ seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px

`e2e/cliproxyapi.e2e.ts` · failed · 35.7s

**ASSERTION_FAILED**

```text
expected {"status":"unconfigured","message":"O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."} to equal {"status":"unconfigured","message":"Nenhuma conexão de IA ativa na plataforma."}
```

Look at: `e2e/cliproxyapi.e2e.ts:43`  
Failed the same way on both attempts: **ASSERTION_FAILED**.  

## Steps

1. ✓ `browser.setViewport` `` (0ms) — `e2e/cliproxyapi.e2e.ts:27`
2. ✓ `browser.setCookies` `` (4ms) — `e2e/support/sign-in.ts:38`
3. ✓ `app.open` `/app/command-center` (661ms) — `e2e/support/sign-in.ts:39`
4. ✓ `expect.toHaveURL` `/\/app\/command-center$/` (2ms) — `e2e/support/sign-in.ts:40`
5. ✓ `expect.toBeAttached` `locator("nav[aria-label=\"Abas do canvas\"] button").first()` (455ms) — `e2e/support/sign-in.ts:9`
6. ✓ `locator.waitFor` `getByRole("button", name: "Agora não") → visible` (47ms) — `e2e/support/sign-in.ts:11`
7. ✓ `locator.tap` `getByRole("button", name: "Agora não")` (314ms) — `e2e/support/sign-in.ts:12`
8. ✓ `expect.toBeHidden` `getByRole("button", name: "Agora não")` (153ms) — `e2e/support/sign-in.ts:13`
9. ✓ `app.open` `/app/admin/ai` (719ms) — `e2e/cliproxyapi.e2e.ts:30`
10. ✓ `locator.tap` `getByRole("button", name: "Nova conexão")` (494ms) — `e2e/cliproxyapi.e2e.ts:31`
11. ✓ `locator.fill` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByLabel("Nome")` (75ms) — `e2e/cliproxyapi.e2e.ts:33`
12. ✓ `locator.focus` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByRole("combobox", name: "Provider")` (103ms) — `e2e/cliproxyapi.e2e.ts:34`
13. ✓ `browser.keyboard.press` `Enter` (145ms) — `e2e/cliproxyapi.e2e.ts:35`
14. ✓ `locator.tap` `getByRole("option", name: "CLIProxyAPI (Lume)")` (222ms) — `e2e/cliproxyapi.e2e.ts:36`
15. ✓ `expect.toBeVisible` `getByText("O CLIProxyAPI responde pelo endereço fixo do Lume").first()` (46ms) — `e2e/cliproxyapi.e2e.ts:37`
16. ✓ `locator.fill` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByLabel("Chave da API")` (252ms) — `e2e/cliproxyapi.e2e.ts:38`
17. ✓ `locator.tap` `getByRole("button", name: "Criar conexão")` (209ms) — `e2e/cliproxyapi.e2e.ts:39`
18. ✓ `expect.toBeVisible` `getByRole("heading", name: "Proxy de teste 1280 1791393300477")` (416ms) — `e2e/cliproxyapi.e2e.ts:40`

## Screen at failure

URL: `http://localhost:3000/app/admin/ai`  

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
# Screen at failure
url: http://localhost:3000/app/admin/ai
revision: b1
viewport: 1280x844
nodes: 215

#root document "IA · Administração | Lume"
 #n13 link "Ir para o canvas" href="/app/admin/ai#…"
 #n14 complementary "Lume"
  #n15 text="Lume"
  #n16 button "Ampliar conversa"
  #n17 button "Recolher o Lume"
  #n18 button "Mostrar conversas"
  #n19 heading "Conversa privada"
  #n20 button "Nova conversa"
  #n21 link "Personalizar Lume" href="/app/agents/settings"
  #n22 button "Artefatos"
  #n23 text="quarta-feira, 7 de outubro"
  #n24 heading "Boa tarde, Proxy."
  #n25 text="Por onde começamos? Selecione um caso ou documentos no canvas, ou me conte o que precisa."
  #n26 text="Esta conversa e sua memória são pessoais."
  #n27 button "Organizar minhas tarefas e próximos prazos"
  #n28 button "Resumir os documentos que eu selecionar"
  #n29 button "Consultar honorários pendentes"
  #n30 button "Pesquisar jurisprudência para uma questão"
  #n31 textbox "Pergunte ao Lume"
  #n32 button "Arquivo para anexar"
  #n33 button "Anexar arquivos"
  #n34 button "Gravar áudio" [disabled]
  #n35 button "Enviar mensagem" [disabled]
  #n36 "Contexto da próxima mensagem" text="Administração"
 #n37 region "Canvas do escritório"
  #n38 "Barra do escritório"
   #n39 button "Abrir módulos"
   #n40 navigation "Abas do canvas"
    #n41 button "Administração"
    #n42 button "Fechar aba Administração"
    #n43 button "Início"
    #n44 button "Fechar aba Início"
   #n45 button "Notificações"
   #n46 button "Conta de Proxy admin"
  #n47 main
   #n48 heading "Administração"
   #n49 navigation "Administração"
    #n50 link "Feedback" href="/app/admin/feedback"
    #n51 link "Clientes" href="/app/admin/clients"
    #n52 link "Financeiro" href="/app/admin/finance"
    #n53 link "IA" href="/app/admin/ai"
    #n54 link "Execuções" href="/app/admin/traces"
    #n55 link "Credenciais" href="/app/admin/credentials"
    #n56 link "Auditoria" href="/app/admin/audit"
   #n57 region "Lume"
    #n58 heading "Lume"
    #n59 text="Os modelos e os provedores que respondem em todos os escritórios: conversas, e-mails, cronologias, minutas, anexos e a busca do Cofre."
    #n60 region "Modelos por tarefa"
     #n61 heading "Modelos por tarefa"
     #n62 text="Cada grupo define conexão, modelo e esforço para as suas tarefas. Uma tarefa pode ter escolha própria; sem ela, segue o grupo. O teste envia uma requisição mínima, sem dados de clientes, e pode gerar uma pequena cobrança."
     #n63 article
      #n64 heading "Agente"
      #n65 text="Conversa do Lume com ferramentas, busca e memória."
      #n66 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n67 button "Editar"
      #n68 button "Testar" [disabled]
      #n69 heading "Conversa"
      #n70 text="Cada turno do Lume, com até oito passos de ferramenta."
      #n71 text="Segue o grupo."
      #n72 button "Personalizar"
      #n73 button "Testar" [disabled]
     #n74 article
      #n75 heading "Redação jurídica"
      #n76 text="Estrutura e texto das minutas que o advogado revisa e assina."
      #n77 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n78 button "Editar"
      #n79 button "Testar" [disabled]
      #n80 heading "Estrutura da minuta"
      #n81 text="Seções e termos de busca a partir do pedido e do modelo."
      #n82 text="Segue o grupo."
      #n83 button "Personalizar"
      #n84 button "Testar" [disabled]
      #n85 heading "Seções da minuta"
      #n86 text="Texto de cada seção, com evidências das fontes do caso."
      #n87 text="Segue o grupo."
      #n88 button "Personalizar"
      #n89 button "Testar" [disabled]
     #n90 article
      #n91 heading "Extração de documentos"
      #n92 text="Leitura de documentos longos com saída estruturada conferida pelo sistema."
      #n93 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n94 button "Editar"
      #n95 button "Testar" [disabled]
      #n96 heading "Fatos da cronologia"
      #n97 text="Acontecimentos de cada fonte, com citação literal verificada."
      #n98 text="Segue o grupo."
      #n99 button "Personalizar"
      #n100 button "Testar" [disabled]
      #n101 heading "Divergências da cronologia"
      #n102 text="Datas, valores e envolvidos incompatíveis entre fontes."
      #n103 text="Segue o grupo."
      #n104 button "Personalizar"
      #n105 button "Testar" [disabled]
      #n106 heading "Anexos do PJe"
      #n107 text="Documentos de um PDF digitalizado e onde a petição os cita."
      #n108 text="Segue o grupo."
      #n109 button "Personalizar"
      #n110 button "Testar" [disabled]
     #n111 article
      #n112 heading "Resumo e texto curto"
      #n113 text="Panoramas e respostas curtas de e-mail, depois dos julgamentos do Jev."
      #n114 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n115 button "Editar"
      #n116 button "Testar" [disabled]
      #n117 heading "Panorama de e-mails"
      #n118 text="Resumo do dia, da semana ou do mês."
      #n119 text="Segue o grupo."
      #n120 button "Personalizar"
      #n121 button "Testar" [disabled]
      #n122 heading "Resumo e respostas rápidas"
      #n123 text="Uma conversa de e-mail e até três respostas prontas."
      #n124 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n125 button "Editar"
      #n126 button "Testar" [disabled]
     #n127 article
      #n128 heading "Classificação e segurança"
      #n129 text="Verificação de instruções escondidas em textos de terceiros antes que o agente os leia."
      #n130 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n131 button "Editar"
      #n132 button "Testar" [disabled]
      #n133 heading "Guarda contra injeção"
      #n134 text="E-mails, Docs, publicações e páginas da web lidos pelo agente."
      #n135 text="Segue o grupo."
      #n136 button "Personalizar"
      #n137 button "Testar" [disabled]
      #n138 heading "Elementos figurativos de marcas"
      #n139 text="Leitura de logotipos e sugestões de códigos de Viena conferidas no catálogo do INPI. Requer um modelo com visão."
      #n140 text="Segue o grupo."
      #n141 button "Personalizar"
      #n142 button "Testar" [disabled]
     #n143 article
      #n144 heading "Transcrição"
      #n145 text="Notas de voz do composer, convertidas em texto antes do envio."
      #n146 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n147 button "Editar"
      #n148 button "Testar" [disabled]
      #n149 heading "Nota de voz"
      #n150 text="Gravações do composer e áudios enviados na conversa."
      #n151 text="Segue o grupo."
      #n152 button "Personalizar"
      #n153 button "Testar" [disabled]
    #n154 heading "Conexões"
    #n155 text="As conexões guardam as credenciais dos provedores. O modelo de embedding acompanha o índice de busca."
    #n156 text="1 conexão cadastrada"
    #n157 button "Nova conexão"
    #n158 article
     #n159 heading "Proxy de teste 1280 1791393300477"
     #n160 text="CLIProxyAPI (Lume) · syn••••tial"
     #n161 text="Não atende nenhuma tarefa diretamente."
     #n162 text="Ativa"
     #n163 text="Nome"
     #n164 textbox "Nome" value="Proxy de teste 1280 1791393300477"
     #n165 text="Provider"
     #n166 combobox "Provider"
      #n167 text="CLIProxyAPI (Lume)"
     #n168 text="O CLIProxyAPI responde pelo endereço fixo do Lume, api.lume.software. A conexão só atende as tarefas em que você escolhê-la em Modelos por tarefa. Ele não oferece transcrição nem embeddings."
     #n169 text="Nova chave da API"
     #n170 textbox "Nova chave da API" value=<secure> purpose=password [secure]
     #n171 text="Conexão ativa"
      #n172 checkbox "Conexão ativa" [checked]
     #n173 button "Salvar alterações"
     #n174 button "Testar conexão"
     #n175 button "Excluir"
     #n176 text="O teste envia uma requisição mínima ao provider, sem documentos do cliente, e pode gerar uma pequena cobrança."
   #n177 region "TypeSafe"
    #n178 heading "TypeSafe"
    #n179 region "Configuração do TypeSafe"
     #n180 text="Uma única conexão atende todos os escritórios: relevância de fontes, verificação documental, sugestões de agenda, comparação de julgados e triagem de feedback. O custo é da plataforma."
     #n181 group
      #n182 text="Chave da API"
      #n183 textbox "Chave da API" value=<secure> purpose=password [secure]
      #n184 text="Versão do modelo"
      #n185 textbox "Versão do modelo" value="jev-1.13.0"
      #n186 text="Conexão ativa"
       #n187 checkbox "Conexão ativa"
      #n188 text="Cofre e busca"
      #n189 combobox "Cofre e busca" value="off"
       #n190 option "Desligado" [selected]
       #n191 option "Avaliar sem aplicar"
       #n192 option "Ativado"
      #n193 text="Documentos"
      #n194 combobox "Documentos" value="off"
       #n195 option "Desligado" [selected]
       #n196 option "Avaliar sem aplicar"
       #n197 option "Ativado"
      #n198 text="Agenda"
      #n199 combobox "Agenda" value="off"
       #n200 option "Desligado" [selected]
       #n201 option "Avaliar sem aplicar"
       #n202 option "Ativado"
      #n203 text="Pesquisa"
      #n204 combobox "Pesquisa" value="off"
       #n205 option "Desligado" [selected]
       #n206 option "Avaliar sem aplicar"
       #n207 option "Ativado"
      #n208 text="Triagem de feedback"
      #n209 combobox "Triagem de feedback" value="enabled"
       #n210 option "Desligado"
       #n211 option "Avaliar sem aplicar"
       #n212 option "Ativado" [selected]
      #n213 text="Classificação de e-mails"
      #n214 combobox "Classificação de e-mails" value="off"
       #n215 option "Desligado" [selected]
       #n216 option "Avaliar sem aplicar"
       #n217 option "Ativado"
      #n218 text="Avaliar sem aplicar também envia dados ao TypeSafe e consome o orçamento. Ative após avaliar os resultados."
      #n219 text="Reserva diária de tokens (todos os escritórios)"
      #n220 spinbutton "Reserva diária de tokens (todos os escritórios)" value="2000000"
      #n221 text="Chamadas simultâneas"
      #n222 spinbutton "Chamadas simultâneas" value="4"
      #n223 button "Salvar TypeSafe"
      #n224 button "Testar conexão" [disabled]
      #n225 button "Remover credencial" [disabled]
 #n226 alert
```

## Evidence

- screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/001-failure.png`
- log `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/failure/screen.txt`
- trace `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/trace/trace.zip`

<sub>e2e 0.15.1 · run `01a1175a-d963-7d63-adca-3e374609cdd5` · the whole run is in `report.json`</sub>
