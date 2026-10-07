# ✗ a página inicial funciona pelo teclado e nos dois temas em 1440px

`e2e/public-site.e2e.ts` · failed · 36.9s

**LOCATOR_NOT_FOUND**

```text
locator matched no nodes within getByRole("button", name: "Usar tema claro")
```

Asked for: button "Usar tema claro"  
Waited: 30.1s  
Look at: `e2e/public-site.e2e.ts:55`  
Failed the same way on both attempts: **LOCATOR_NOT_FOUND** at step 8.  

## Steps

1. ✓ `browser.setViewport` `` (0ms) — `e2e/public-site.e2e.ts:47`
2. ✓ `app.open` `/` (241ms) — `e2e/public-site.e2e.ts:48`
3. ✓ `expect.toHaveText` `getByRole("heading")` (135ms) — `e2e/public-site.e2e.ts:49`
4. ✓ `browser.keyboard.press` `Tab` (17ms) — `e2e/public-site.e2e.ts:50`
5. ✓ `expect.toBeFocused` `getByRole("link", name: "Ir para o conteúdo")` (19ms) — `e2e/public-site.e2e.ts:51`
6. ✓ `browser.keyboard.press` `Enter` (11ms) — `e2e/public-site.e2e.ts:52`
7. ✓ `browser.url` `` (0ms) — `e2e/public-site.e2e.ts:53`
8. ✗ `locator.tap` `getByRole("button", name: "Usar tema claro")` (30.1s) — **LOCATOR_NOT_FOUND** — `e2e/public-site.e2e.ts:55`

## Screen at failure

URL: `http://localhost:3000/#conteudo`  
Closest to what the locator asked for:  
- `#n13 button "Usar tema escuro"`

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
# Screen at failure
url: http://localhost:3000/#conteudo
revision: b1
viewport: 1440x900
nodes: 121

#root document "Lume | Software jurídico para advogados e escritórios"
 #n4 link "Ir para o conteúdo" href="/#…"
 #n5 banner
  #n6 link "Lume, início" href="/"
  #n7 text="São Paulo"
   #n8 text="13:57"
  #n9 navigation "Seções"
   #n10 link "Módulos" href="/#…"
   #n11 link "Formatos" href="/#…"
   #n12 link "Começar" href="/#…"
  #n13 button "Usar tema escuro"
  #n14 link "Entrar" href="/sign-in"
 #n15 main
  #n16 region "Lume"
   #n17 heading "Lume"
    #n18 text="Lume"
   #n19 text="O Lume guarda os documentos de cada caso, prepara rascunhos a partir deles e organiza tarefas, prazos e honorários."
   #n20 link "Criar conta" href="/sign-up"
   #n21 text="Para quem advoga sozinho e para advogados que dividem casos com colegas."
   #n22 "Módulos do Lume"
    #n23 list
     #n24 listitem "Lume"
     #n25 listitem "Cofre"
     #n26 listitem "Pesquisa"
     #n27 listitem "Escritório"
     #n28 listitem "Honorários"
     #n29 listitem "E-mails"
     #n30 listitem "Mensagens"
     #n31 listitem "WhatsApp"
     #n32 listitem "Integrações"
  #n33 region "Organização por caso"
   #n34 text="Um caso,"
   #n35 text="uma pasta."
   #n36 text="Com tarefas e prazos."
   #n37 text="Documentos, clientes, tarefas, prazos e honorários ficam ligados ao caso. Quando um colega entra no caso, ele encontra os arquivos que você liberou e vê o que falta fazer."
  #n38 region "Cinco módulos, um caso."
   #n39 text="Módulos"
   #n40 heading "Cinco módulos, um caso."
    #n41 text="Cinco"
    #n42 text="módulos,"
    #n43 text="um caso."
   #n44 text="Os cinco módulos usam os mesmos casos. O Lume lê os documentos do Cofre, o Escritório mostra os prazos de cada caso e Honorários mostra quanto falta receber."
   #n45 link "Criar conta" href="/sign-up"
   #n46 list
    #n47 listitem "01 Lume Peça uma cronologia dos fatos, uma análise ou uma minuta a partir dos documentos do caso. Você confere as fontes e decide o que usar. Antes de apagar um arquivo, sobrescrever um rascunho ou falar com um tribunal, o Lume pede sua confirmação. Peças "
     #n48 heading "01 Lume" text="Lume"
      #n49 text="01"
     #n50 text="Peça uma cronologia dos fatos, uma análise ou uma minuta a partir dos documentos do caso. Você confere as fontes e decide o que usar. Antes de apagar um arquivo, sobrescrever um rascunho ou falar com um tribunal, o Lume pede sua confirmação."
     #n51 list
      #n52 listitem "Peças em DOCX"
      #n53 listitem "Citações com a fonte"
      #n54 listitem "Voz e anexos"
      #n55 listitem "Documento ao lado da conversa"
    #n56 listitem "02 Cofre Guarde os documentos em pastas por caso. O Lume lê cada arquivo inteiro, inclusive PDFs escaneados, e você acha um trecho com uma busca ou uma pergunta. Pastas por caso Leitura de PDFs escaneados Anexos nomeados para o PJe Busca no conteúdo"
     #n57 heading "02 Cofre" text="Cofre"
      #n58 text="02"
     #n59 text="Guarde os documentos em pastas por caso. O Lume lê cada arquivo inteiro, inclusive PDFs escaneados, e você acha um trecho com uma busca ou uma pergunta."
     #n60 list
      #n61 listitem "Pastas por caso"
      #n62 listitem "Leitura de PDFs escaneados"
      #n63 listitem "Anexos nomeados para o PJe"
      #n64 listitem "Busca no conteúdo"
    #n65 listitem "03 Pesquisa Descreva a questão, escolha entre uma busca rápida ou profunda e confira as decisões encontradas. Salve uma decisão no caso, com o link da fonte para conferir, ou comece uma peça a partir dela. Jurisprudência na web Busca rápida ou profunda Vín"
     #n66 heading "03 Pesquisa" text="Pesquisa"
      #n67 text="03"
     #n68 text="Descreva a questão, escolha entre uma busca rápida ou profunda e confira as decisões encontradas. Salve uma decisão no caso, com o link da fonte para conferir, ou comece uma peça a partir dela."
     #n69 list
      #n70 listitem "Jurisprudência na web"
      #n71 listitem "Busca rápida ou profunda"
      #n72 listitem "Vínculo com o caso"
      #n73 listitem "Rascunho a partir da decisão"
    #n74 listitem "04 Escritório Cada cliente tem contatos, observações, casos e as próximas tarefas. Tarefas, os prazos que você cadastra e reuniões entram num só calendário, com aviso no celular. Clientes e casos Tarefas e reuniões Prazos que você define Avisos no celular"
     #n75 heading "04 Escritório" text="Escritório"
      #n76 text="04"
     #n77 text="Cada cliente tem contatos, observações, casos e as próximas tarefas. Tarefas, os prazos que você cadastra e reuniões entram num só calendário, com aviso no celular."
     #n78 list
      #n79 listitem "Clientes e casos"
      #n80 listitem "Tarefas e reuniões"
      #n81 listitem "Prazos que você define"
      #n82 listitem "Avisos no celular"
    #n83 listitem "05 Honorários Divida o honorário em parcelas e registre cada recebimento, inclusive pagamentos parciais. O saldo a receber muda a cada registro. O Lume não movimenta dinheiro. Parcelas com vencimento Pagamentos parciais Parcelas em atraso Saldo a receber"
     #n84 heading "05 Honorários" text="Honorários"
      #n85 text="05"
     #n86 text="Divida o honorário em parcelas e registre cada recebimento, inclusive pagamentos parciais. O saldo a receber muda a cada registro. O Lume não movimenta dinheiro."
     #n87 list
      #n88 listitem "Parcelas com vencimento"
      #n89 listitem "Pagamentos parciais"
      #n90 listitem "Parcelas em atraso"
      #n91 listitem "Saldo a receber"
  #n92 region "Formatos e dados"
   #n93 heading "Formatos e dados"
    #n94 text="Formatos e dados"
   #n95 text="DOCX"
   #n96 text="Exporte a peça no modelo do escritório. Fonte, margens e espaçamento continuam iguais."
   #n97 text="PJe"
   #n98 text="Os anexos saem divididos e nomeados no padrão do processo eletrônico."
   #n99 text="0"
   #n100 text="Dados compartilhados entre escritórios. Cada escritório acessa apenas os próprios casos e documentos."
  #n101 region "Abra o seu escritório : criar conta"
   #n102 heading "Abra o seu escritório : criar conta"
    #n103 link "Abra o seu escritório : criar conta" href="/sign-up"
     #n104 text="Abra"
     #n105 text="o seu"
     #n106 text="escritório"
     #n107 text=": criar conta"
 #n108 contentinfo
  #n109 text="Documentos, IA e gestãopara quem advoga."
  #n110 navigation "Rodapé"
   #n111 link "Termos de uso" href="/termos-de-uso"
   #n112 link "Privacidade" href="/politica-privacidade"
   #n113 link "Entrar" href="/sign-in"
   #n114 link "Criar conta" href="/sign-up"
   #n115 link "Módulos" href="/#…"
  #n116 text="São Paulo"
  #n117 text="13:57"
  #n118 text="Lume"
  #n119 text="© 2026 Lume"
  #n120 link "Comece com um caso do seu escritório Criar conta" href="/sign-up"
   #n121 text="Comece com um casodo seu escritório"
   #n122 text="Criar conta"
 #n123 alert
```

## Evidence

- screenshot `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/screenshots/001-failure.png`
- log `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/failure/screen.txt`
- trace `.e2e/artifacts/web/e2e_public-site.e2e.ts__a_20p_C3_A1gina_20inicial_20funciona_20pelo_20teclado_20e_20nos_20dois_20temas_20em_201-c841e0fc/default/attempt-1/trace/trace.zip`

<sub>e2e 0.15.1 · run `01a11748-210d-7d3f-9693-54f85414ed32` · the whole run is in `report.json`</sub>
