# ✗ seleção do CLIProxyAPI › administra CLIProxyAPI e escolhe uma tarefa pelo teclado em 1280px

`e2e/cliproxyapi.e2e.ts` · failed · 39.1s

**ERROR**

```text
PUT /api/platform/ai/assignments: HTTP 400 {"error":"Escolha um modelo disponível antes de definir o esforço."}
```

Look at: `e2e/support/accounts.ts:50`  
Failed the same way on both attempts: **ERROR**.  

## Steps

1. ✓ `browser.setViewport` `` (0ms) — `e2e/cliproxyapi.e2e.ts:37`
2. ✓ `browser.setCookies` `` (3ms) — `e2e/support/sign-in.ts:38`
3. ✓ `app.open` `/app/command-center` (713ms) — `e2e/support/sign-in.ts:39`
4. ✓ `expect.toHaveURL` `/\/app\/command-center$/` (0ms) — `e2e/support/sign-in.ts:40`
5. ✓ `expect.toBeAttached` `locator("nav[aria-label=\"Abas do canvas\"] button").first()` (704ms) — `e2e/support/sign-in.ts:9`
6. ✓ `locator.waitFor` `getByRole("button", name: "Agora não") → visible` (42ms) — `e2e/support/sign-in.ts:11`
7. ✓ `locator.tap` `getByRole("button", name: "Agora não")` (361ms) — `e2e/support/sign-in.ts:12`
8. ✓ `expect.toBeHidden` `getByRole("button", name: "Agora não")` (23ms) — `e2e/support/sign-in.ts:13`
9. ✓ `app.open` `/app/admin/ai` (605ms) — `e2e/cliproxyapi.e2e.ts:40`
10. ✓ `locator.tap` `getByRole("button", name: "Nova conexão")` (485ms) — `e2e/cliproxyapi.e2e.ts:41`
11. ✓ `locator.fill` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByLabel("Nome")` (170ms) — `e2e/cliproxyapi.e2e.ts:43`
12. ✓ `locator.focus` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByRole("combobox", name: "Provider")` (62ms) — `e2e/cliproxyapi.e2e.ts:44`
13. ✓ `browser.keyboard.press` `Enter` (117ms) — `e2e/cliproxyapi.e2e.ts:45`
14. ✓ `locator.tap` `getByRole("option", name: "CLIProxyAPI (Lume)")` (219ms) — `e2e/cliproxyapi.e2e.ts:46`
15. ✓ `expect.toBeVisible` `getByText("O CLIProxyAPI responde pelo endereço fixo do Lume").first()` (58ms) — `e2e/cliproxyapi.e2e.ts:47`
16. ✓ `locator.fill` `locator("form").filter({ has: getByRole("heading", name: "Nova conexão") }) >> getByLabel("Chave da API")` (261ms) — `e2e/cliproxyapi.e2e.ts:48`
17. ✓ `locator.tap` `getByRole("button", name: "Criar conexão")` (360ms) — `e2e/cliproxyapi.e2e.ts:49`
18. ✓ `expect.toBeVisible` `getByRole("heading", name: "Proxy de teste 1280 1791392072572")` (440ms) — `e2e/cliproxyapi.e2e.ts:50`
19. ✓ `locator.tap` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("button", name: "Editar").first()` (216ms) — `e2e/cliproxyapi.e2e.ts:55`
20. ✓ `locator.tap` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("combobox", name: "Modelo")` (204ms) — `e2e/cliproxyapi.e2e.ts:56`
21. ✓ `locator.tap` `getByRole("option", name: "Escolher conexão e modelo")` (251ms) — `e2e/cliproxyapi.e2e.ts:57`
22. ✓ `locator.tap` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("combobox", name: "Conexão")` (366ms) — `e2e/cliproxyapi.e2e.ts:58`
23. ✓ `locator.tap` `getByRole("option", name: "Proxy de teste 1280 1791392072572")` (227ms) — `e2e/cliproxyapi.e2e.ts:59`
24. ✓ `locator.tap` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("combobox", name: "Escolher da lista")` (343ms) — `e2e/cliproxyapi.e2e.ts:60`
25. ✓ `locator.tap` `getByRole("option", name: "gpt-6-luna")` (127ms) — `e2e/cliproxyapi.e2e.ts:61`
26. ✓ `locator.focus` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("button", name: "Salvar")` (236ms) — `e2e/cliproxyapi.e2e.ts:62`
27. ✓ `browser.keyboard.press` `Enter` (60ms) — `e2e/cliproxyapi.e2e.ts:63`
28. ✓ `expect.toBeHidden` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") }) >> getByRole("button", name: "Salvar")` (257ms) — `e2e/cliproxyapi.e2e.ts:64`
29. ✓ `browser.reload` `` (574ms) — `e2e/cliproxyapi.e2e.ts:65`
30. ✓ `expect.toContainText` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") })` (185ms) — `e2e/cliproxyapi.e2e.ts:66`
31. ✓ `expect.toContainText` `getByRole("article").filter({ has: getByRole("heading", name: "Resumo e texto curto") })` (59ms) — `e2e/cliproxyapi.e2e.ts:67`
32. ✓ `browser.evaluate` `` (63ms) — `e2e/cliproxyapi.e2e.ts:69`
33. ✓ `app.screenshot` `proxy-selection-1280` (111ms) — `e2e/cliproxyapi.e2e.ts:70`

## Screen at failure

URL: `http://localhost:3000/app/admin/ai`  

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
# Screen at failure
url: http://localhost:3000/app/admin/ai
revision: b1
viewport: 1280x844
nodes: 238

#root document "IA · Administração | Lume"
 #n24 link "Ir para o canvas" href="/app/admin/ai#…"
 #n25 complementary "Lume"
  #n26 text="Lume"
  #n27 button "Ampliar conversa"
  #n28 button "Recolher o Lume"
  #n29 button "Mostrar conversas"
  #n30 heading "Conversa privada"
  #n31 button "Nova conversa"
  #n32 link "Personalizar Lume" href="/app/agents/settings"
  #n33 button "Artefatos"
  #n34 text="quarta-feira, 7 de outubro"
  #n35 heading "Boa tarde, Proxy."
  #n36 text="Por onde começamos? Selecione um caso ou documentos no canvas, ou me conte o que precisa."
  #n37 text="Esta conversa e sua memória são pessoais."
  #n38 button "Organizar minhas tarefas e próximos prazos"
  #n39 button "Resumir os documentos que eu selecionar"
  #n40 button "Consultar honorários pendentes"
  #n41 button "Pesquisar jurisprudência para uma questão"
  #n42 textbox "Pergunte ao Lume"
  #n43 button "Arquivo para anexar"
  #n44 button "Anexar arquivos"
  #n45 button "Gravar áudio" [disabled]
  #n46 button "Enviar mensagem" [disabled]
  #n47 "Contexto da próxima mensagem" text="Administração"
 #n48 region "Canvas do escritório"
  #n49 "Barra do escritório"
   #n50 button "Abrir módulos"
   #n51 navigation "Abas do canvas"
    #n52 button "Administração"
    #n53 button "Fechar aba Administração"
    #n54 button "Início"
    #n55 button "Fechar aba Início"
   #n56 button "Notificações"
   #n57 button "Conta de Proxy admin"
  #n58 main
   #n59 heading "Administração"
   #n60 navigation "Administração"
    #n61 link "Feedback" href="/app/admin/feedback"
    #n62 link "Clientes" href="/app/admin/clients"
    #n63 link "Financeiro" href="/app/admin/finance"
    #n64 link "IA" href="/app/admin/ai"
    #n65 link "Execuções" href="/app/admin/traces"
    #n66 link "Credenciais" href="/app/admin/credentials"
    #n67 link "Auditoria" href="/app/admin/audit"
   #n68 region "Lume"
    #n69 heading "Lume"
    #n70 text="Os modelos e os provedores que respondem em todos os escritórios: conversas, e-mails, cronologias, minutas, anexos e a busca do Cofre."
    #n71 region "Modelos por tarefa"
     #n72 heading "Modelos por tarefa"
     #n73 text="Cada grupo define conexão, modelo e esforço para as suas tarefas. Uma tarefa pode ter escolha própria; sem ela, segue o grupo. O teste envia uma requisição mínima, sem dados de clientes, e pode gerar uma pequena cobrança."
     #n74 article
      #n75 heading "Agente"
      #n76 text="Conversa do Lume com ferramentas, busca e memória."
      #n77 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n78 button "Editar"
      #n79 button "Testar" [disabled]
      #n80 heading "Conversa"
      #n81 text="Cada turno do Lume, com até oito passos de ferramenta."
      #n82 text="Segue o grupo."
      #n83 button "Personalizar"
      #n84 button "Testar" [disabled]
     #n85 article
      #n86 heading "Redação jurídica"
      #n87 text="Estrutura e texto das minutas que o advogado revisa e assina."
      #n88 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n89 button "Editar"
      #n90 button "Testar" [disabled]
      #n91 heading "Estrutura da minuta"
      #n92 text="Seções e termos de busca a partir do pedido e do modelo."
      #n93 text="Segue o grupo."
      #n94 button "Personalizar"
      #n95 button "Testar" [disabled]
      #n96 heading "Seções da minuta"
      #n97 text="Texto de cada seção, com evidências das fontes do caso."
      #n98 text="Segue o grupo."
      #n99 button "Personalizar"
      #n100 button "Testar" [disabled]
     #n101 article
      #n102 heading "Extração de documentos"
      #n103 text="Leitura de documentos longos com saída estruturada conferida pelo sistema."
      #n104 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n105 button "Editar"
      #n106 button "Testar" [disabled]
      #n107 heading "Fatos da cronologia"
      #n108 text="Acontecimentos de cada fonte, com citação literal verificada."
      #n109 text="Segue o grupo."
      #n110 button "Personalizar"
      #n111 button "Testar" [disabled]
      #n112 heading "Divergências da cronologia"
      #n113 text="Datas, valores e envolvidos incompatíveis entre fontes."
      #n114 text="Segue o grupo."
      #n115 button "Personalizar"
      #n116 button "Testar" [disabled]
      #n117 heading "Anexos do PJe"
      #n118 text="Documentos de um PDF digitalizado e onde a petição os cita."
      #n119 text="Segue o grupo."
      #n120 button "Personalizar"
      #n121 button "Testar" [disabled]
     #n122 article
      #n123 heading "Resumo e texto curto"
      #n124 text="Panoramas e respostas curtas de e-mail, depois dos julgamentos do Jev."
      #n125 text="Proxy de teste 1280 1791392072572 · · esforço médio"
       #n126 text="gpt-6-luna"
      #n127 text="Modelo definido aqui; esforço definido aqui."
      #n128 button "Editar"
      #n129 button "Testar"
      #n130 heading "Panorama de e-mails"
      #n131 text="Resumo do dia, da semana ou do mês."
      #n132 text="Segue o grupo."
      #n133 button "Personalizar"
      #n134 button "Testar"
      #n135 heading "Resumo e respostas rápidas"
      #n136 text="Uma conversa de e-mail e até três respostas prontas."
      #n137 text="Proxy de teste 1280 1791392072572 · · esforço baixo"
       #n138 text="gpt-6-luna"
      #n139 text="Modelo herdado de Resumo e texto curto; esforço definido aqui."
      #n140 button "Editar"
      #n141 button "Testar"
     #n142 article
      #n143 heading "Classificação e segurança"
      #n144 text="Verificação de instruções escondidas em textos de terceiros antes que o agente os leia."
      #n145 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n146 button "Editar"
      #n147 button "Testar" [disabled]
      #n148 heading "Guarda contra injeção"
      #n149 text="E-mails, Docs, publicações e páginas da web lidos pelo agente."
      #n150 text="Segue o grupo."
      #n151 button "Personalizar"
      #n152 button "Testar" [disabled]
      #n153 heading "Elementos figurativos de marcas"
      #n154 text="Leitura de logotipos e sugestões de códigos de Viena conferidas no catálogo do INPI. Requer um modelo com visão."
      #n155 text="Segue o grupo."
      #n156 button "Personalizar"
      #n157 button "Testar" [disabled]
     #n158 article
      #n159 heading "Transcrição"
      #n160 text="Notas de voz do composer, convertidas em texto antes do envio."
      #n161 text="O CLIProxyAPI atende só as tarefas em que for escolhido. Escolha uma conexão e um modelo para esta tarefa."
      #n162 button "Editar"
      #n163 button "Testar" [disabled]
      #n164 heading "Nota de voz"
      #n165 text="Gravações do composer e áudios enviados na conversa."
      #n166 text="Segue o grupo."
      #n167 button "Personalizar"
      #n168 button "Testar" [disabled]
    #n169 heading "Conexões"
    #n170 text="As conexões guardam as credenciais dos provedores. O modelo de embedding acompanha o índice de busca."
    #n171 text="2 conexões cadastradas"
    #n172 button "Nova conexão"
    #n173 article
     #n174 heading "Proxy de teste 1280 1791392039055"
     #n175 text="CLIProxyAPI (Lume) · syn••••tial"
     #n176 text="Não atende nenhuma tarefa diretamente."
     #n177 text="Ativa"
     #n178 text="Nome"
     #n179 textbox "Nome" value="Proxy de teste 1280 1791392039055"
     #n180 text="Provider"
     #n181 combobox "Provider"
      #n182 text="CLIProxyAPI (Lume)"
     #n183 text="O CLIProxyAPI responde pelo endereço fixo do Lume, api.lume.software. A conexão só atende as tarefas em que você escolhê-la em Modelos por tarefa. Ele não oferece transcrição nem embeddings."
     #n184 text="Nova chave da API"
     #n185 textbox "Nova chave da API" value=<secure> purpose=password [secure]
     #n186 text="Conexão ativa"
      #n187 checkbox "Conexão ativa" [checked]
     #n188 button "Salvar alterações"
     #n189 button "Testar conexão"
     #n190 button "Excluir"
     #n191 text="O teste envia uma requisição mínima ao provider, sem documentos do cliente, e pode gerar uma pequena cobrança."
    #n192 article
     #n193 heading "Proxy de teste 1280 1791392072572"
     #n194 text="CLIProxyAPI (Lume) · syn••••tial"
     #n195 text="Atende: Resumo e texto curto."
     #n196 text="Ativa"
     #n197 text="Nome"
     #n198 textbox "Nome" value="Proxy de teste 1280 1791392072572"
     #n199 text="Provider"
     #n200 combobox "Provider"
      #n201 text="CLIProxyAPI (Lume)"
     #n202 text="O CLIProxyAPI responde pelo endereço fixo do Lume, api.lume.software. A conexão só atende as tarefas em que você escolhê-la em Modelos por tarefa. Ele não oferece transcrição nem embeddings."
     #n203 text="Nova chave da API"
     #n204 textbox "Nova chave da API" value=<secure> purpose=password [secure]
     #n205 text="Conexão ativa"
      #n206 checkbox "Conexão ativa" [checked]
     #n207 button "Salvar alterações"
     #n208 button "Testar conexão"
     #n209 button "Excluir"
     #n210 text="O teste envia uma requisição mínima ao provider, sem documentos do cliente, e pode gerar uma pequena cobrança."
   #n211 region "TypeSafe"
    #n212 heading "TypeSafe"
    #n213 region "Configuração do TypeSafe"
     #n214 text="Uma única conexão atende todos os escritórios: relevância de fontes, verificação documental, sugestões de agenda, comparação de julgados e triagem de feedback. O custo é da plataforma."
     #n215 group
      #n216 text="Chave da API"
      #n217 textbox "Chave da API" value=<secure> purpose=password [secure]
      #n218 text="Versão do modelo"
      #n219 textbox "Versão do modelo" value="jev-1.13.0"
      #n220 text="Conexão ativa"
       #n221 checkbox "Conexão ativa"
      #n222 text="Cofre e busca"
      #n223 combobox "Cofre e busca" value="off"
       #n224 option "Desligado" [selected]
       #n225 option "Avaliar sem aplicar"
       #n226 option "Ativado"
      #n227 text="Documentos"
      #n228 combobox "Documentos" value="off"
       #n229 option "Desligado" [selected]
       #n230 option "Avaliar sem aplicar"
       #n231 option "Ativado"
      #n232 text="Agenda"
      #n233 combobox "Agenda" value="off"
       #n234 option "Desligado" [selected]
       #n235 option "Avaliar sem aplicar"
       #n236 option "Ativado"
      #n237 text="Pesquisa"
      #n238 combobox "Pesquisa" value="off"
       #n239 option "Desligado" [selected]
       #n240 option "Avaliar sem aplicar"
       #n241 option "Ativado"
      #n242 text="Triagem de feedback"
      #n243 combobox "Triagem de feedback" value="enabled"
       #n244 option "Desligado"
       #n245 option "Avaliar sem aplicar"
       #n246 option "Ativado" [selected]
      #n247 text="Classificação de e-mails"
      #n248 combobox "Classificação de e-mails" value="off"
       #n249 option "Desligado" [selected]
       #n250 option "Avaliar sem aplicar"
       #n251 option "Ativado"
      #n252 text="Avaliar sem aplicar também envia dados ao TypeSafe e consome o orçamento. Ative após avaliar os resultados."
      #n253 text="Reserva diária de tokens (todos os escritórios)"
      #n254 spinbutton "Reserva diária de tokens (todos os escritórios)" value="2000000"
      #n255 text="Chamadas simultâneas"
      #n256 spinbutton "Chamadas simultâneas" value="4"
      #n257 button "Salvar TypeSafe"
      #n258 button "Testar conexão" [disabled]
      #n259 button "Remover credencial" [disabled]
 #n260 alert
```

## Evidence

- screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/002-failure.png`
- log `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/failure/screen.txt`
- screenshot `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/screenshots/001-proxy-selection-1280.png`
- trace `.e2e/artifacts/web/serial__e2e_cliproxyapi.e2e.ts__sele_C3_A7_C3_A3o_20do_20CLIProxyAPI-c6da95aa/default/attempt-1/trace/trace.zip`

<sub>e2e 0.15.1 · run `01a11748-210d-7d3f-9693-54f85414ed32` · the whole run is in `report.json`</sub>
