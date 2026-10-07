# ✗ a página inicial funciona pelo teclado e nos dois temas em 390px

`e2e/public-site.e2e.ts` · failed · 33.0s

**LOCATOR_NOT_FOUND**

```text
locator matched no nodes within getByRole("button", name: "Usar tema claro")
```

Asked for: button "Usar tema claro"  
Waited: 30.0s  
Look at: `e2e/public-site.e2e.ts:55`  
Failed the same way on both attempts: **LOCATOR_NOT_FOUND** at step 8.  

## Steps

1. ✓ `browser.setViewport` `` (0ms) — `e2e/public-site.e2e.ts:47`
2. ✓ `app.open` `/` (652ms) — `e2e/public-site.e2e.ts:48`
3. ✓ `expect.toHaveText` `getByRole("heading")` (205ms) — `e2e/public-site.e2e.ts:49`
4. ✓ `browser.keyboard.press` `Tab` (36ms) — `e2e/public-site.e2e.ts:50`
5. ✓ `expect.toBeFocused` `getByRole("link", name: "Ir para o conteúdo")` (28ms) — `e2e/public-site.e2e.ts:51`
6. ✓ `browser.keyboard.press` `Enter` (9ms) — `e2e/public-site.e2e.ts:52`
7. ✓ `browser.url` `` (0ms) — `e2e/public-site.e2e.ts:53`
8. ✗ `locator.tap` `getByRole("button", name: "Usar tema claro")` (30.0s) — **LOCATOR_NOT_FOUND** — `e2e/public-site.e2e.ts:55`

## Screen at failure

URL: `http://localhost:3000/#conteudo`  
Closest to what the locator asked for:  
- `#n8 button "Usar tema escuro"`

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
# Screen at failure
url: http://localhost:3000/#conteudo
revision: b1
viewport: 390x844
nodes: 116

#root document "Lume | Software jurídico para advogados e escritórios"
 #n4 link "Ir para o conteúdo" href="/#…"
 #n5 banner
  #n6 link "Lume, início" href="/"
  #n7 text="Lume"
  #n8 button "Usar tema escuro"
  #n9 link "Entrar" href="/sign-in"
 #n10 main
  #n11 region "Lume"
   #n12 heading "Lume"
    #n13 text="Lume"
   #n14 text="O Lume guarda os documentos de cada caso, prepara rascunhos a partir deles e organiza tarefas, prazos e honorários."
   #n15 link "Criar conta" href="/sign-up"
   #n16 text="Para quem advoga sozinho e para advogados que dividem casos com colegas."
   #n17 "Módulos do Lume"
    #n18 list
     #n19 listitem "Lume"
     #n20 listitem "Cofre"
     #n21 listitem "Pesquisa"
     #n22 listitem "Escritório"
     #n23 listitem "Honorários"
     #n24 listitem "E-mails"
     #n25 listitem "Mensagens"
     #n26 listitem "WhatsApp"
     #n27 listitem "Integrações"
  #n28 region "Organização por caso"
   #n29 text="Um caso,"
   #n30 text="uma pasta."
   #n31 text="Com tarefas e prazos."
   #n32 text="Documentos, clientes, tarefas, prazos e honorários ficam ligados ao caso. Quando um colega entra no caso, ele encontra os arquivos que você liberou e vê o que falta fazer."
  #n33 region "Cinco módulos, um caso."
   #n34 text="Módulos"
   #n35 heading "Cinco módulos, um caso."
    #n36 text="Cinco"
    #n37 text="módulos,"
    #n38 text="um caso."
   #n39 text="Os cinco módulos usam os mesmos casos. O Lume lê os documentos do Cofre, o Escritório mostra os prazos de cada caso e Honorários mostra quanto falta receber."
   #n40 link "Criar conta" href="/sign-up"
   #n41 list
    #n42 listitem "01 Lume Peça uma cronologia dos fatos, uma análise ou uma minuta a partir dos documentos do caso. Você confere as fontes e decide o que usar. Antes de apagar um arquivo, sobrescrever um rascunho ou falar com um tribunal, o Lume pede sua confirmação. Peças "
     #n43 heading "01 Lume" text="Lume"
      #n44 text="01"
     #n45 text="Peça uma cronologia dos fatos, uma análise ou uma minuta a partir dos documentos do caso. Você confere as fontes e decide o que usar. Antes de apagar um arquivo, sobrescrever um rascunho ou falar com um tribunal, o Lume pede sua confirmação."
     #n46 list
      #n47 listitem "Peças em DOCX"
      #n48 listitem "Citações com a fonte"
      #n49 listitem "Voz e anexos"
      #n50 listitem "Documento ao lado da conversa"
    #n51 listitem "02 Cofre Guarde os documentos em pastas por caso. O Lume lê cada arquivo inteiro, inclusive PDFs escaneados, e você acha um trecho com uma busca ou uma pergunta. Pastas por caso Leitura de PDFs escaneados Anexos nomeados para o PJe Busca no conteúdo"
     #n52 heading "02 Cofre" text="Cofre"
      #n53 text="02"
     #n54 text="Guarde os documentos em pastas por caso. O Lume lê cada arquivo inteiro, inclusive PDFs escaneados, e você acha um trecho com uma busca ou uma pergunta."
     #n55 list
      #n56 listitem "Pastas por caso"
      #n57 listitem "Leitura de PDFs escaneados"
      #n58 listitem "Anexos nomeados para o PJe"
      #n59 listitem "Busca no conteúdo"
    #n60 listitem "03 Pesquisa Descreva a questão, escolha entre uma busca rápida ou profunda e confira as decisões encontradas. Salve uma decisão no caso, com o link da fonte para conferir, ou comece uma peça a partir dela. Jurisprudência na web Busca rápida ou profunda Vín"
     #n61 heading "03 Pesquisa" text="Pesquisa"
      #n62 text="03"
     #n63 text="Descreva a questão, escolha entre uma busca rápida ou profunda e confira as decisões encontradas. Salve uma decisão no caso, com o link da fonte para conferir, ou comece uma peça a partir dela."
     #n64 list
      #n65 listitem "Jurisprudência na web"
      #n66 listitem "Busca rápida ou profunda"
      #n67 listitem "Vínculo com o caso"
      #n68 listitem "Rascunho a partir da decisão"
    #n69 listitem "04 Escritório Cada cliente tem contatos, observações, casos e as próximas tarefas. Tarefas, os prazos que você cadastra e reuniões entram num só calendário, com aviso no celular. Clientes e casos Tarefas e reuniões Prazos que você define Avisos no celular"
     #n70 heading "04 Escritório" text="Escritório"
      #n71 text="04"
     #n72 text="Cada cliente tem contatos, observações, casos e as próximas tarefas. Tarefas, os prazos que você cadastra e reuniões entram num só calendário, com aviso no celular."
     #n73 list
      #n74 listitem "Clientes e casos"
      #n75 listitem "Tarefas e reuniões"
      #n76 listitem "Prazos que você define"
      #n77 listitem "Avisos no celular"
    #n78 listitem "05 Honorários Divida o honorário em parcelas e registre cada recebimento, inclusive pagamentos parciais. O saldo a receber muda a cada registro. O Lume não movimenta dinheiro. Parcelas com vencimento Pagamentos parciais Parcelas em atraso Saldo a receber"
     #n79 heading "05 Honorários" text="Honorários"
      #n80 text="05"
     #n81 text="Divida o honorário em parcelas e registre cada recebimento, inclusive pagamentos parciais. O saldo a receber muda a cada registro. O Lume não movimenta dinheiro."
     #n82 list
      #n83 listitem "Parcelas com vencimento"
      #n84 listitem "Pagamentos parciais"
      #n85 listitem "Parcelas em atraso"
      #n86 listitem "Saldo a receber"
  #n87 region "Formatos e dados"
   #n88 heading "Formatos e dados"
    #n89 text="Formatos e dados"
   #n90 text="DOCX"
   #n91 text="Exporte a peça no modelo do escritório. Fonte, margens e espaçamento continuam iguais."
   #n92 text="PJe"
   #n93 text="Os anexos saem divididos e nomeados no padrão do processo eletrônico."
   #n94 text="0"
   #n95 text="Dados compartilhados entre escritórios. Cada escritório acessa apenas os próprios casos e documentos."
  #n96 region "Abra o seu escritório : criar conta"
   #n97 heading "Abra o seu escritório : criar conta"
    #n98 link "Abra o seu escritório : criar conta" href="/sign-up"
     #n99 text="Abra"
     #n100 text="o seu"
     #n101 text="escritório"
     #n102 text=": criar conta"
 #n103 contentinfo
  #n104 text="Documentos, IA e gestãopara quem advoga."
  #n105 navigation "Rodapé"
   #n106 link "Termos de uso" href="/termos-de-uso"
   #n107 link "Privacidade" href="/politica-privacidade"
   #n108 link "Entrar" href="/sign-in"
   #n109 link "Criar conta" href="/sign-up"
   #n110 link "Módulos" href="/#…"
  #n111 text="São Paulo"
  #n112 text="13:55"
  #n113 text="Lume"
  #n114 text="© 2026 Lume"
  #n115 link "Comece com um caso do seu escritório Criar conta" href="/sign-up"
   #n116 text="Comece com um casodo seu escritório"
   #n117 text="Criar conta"
 #n118 alert
```

## Evidence

- screenshot `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/screenshots/001-failure.png`
- log `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/failure/screen.txt`
- trace `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_203-78650869/default/attempt-1/trace/trace.zip`

<sub>e2e 0.15.1 · run `01a11748-210d-7d3f-9693-54f85414ed32` · the whole run is in `report.json`</sub>
