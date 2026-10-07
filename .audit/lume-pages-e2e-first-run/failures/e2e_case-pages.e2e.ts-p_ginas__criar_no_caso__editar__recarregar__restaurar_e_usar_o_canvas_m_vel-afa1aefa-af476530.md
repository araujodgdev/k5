# ✗ páginas: criar no caso, editar, recarregar, restaurar e usar o canvas móvel

`e2e/case-pages.e2e.ts` · failed · 26.4s

**ASSERTION_FAILED**

```text
expect.toBeVisible failed
locator: getByRole("textbox", name: "Texto do documento")
expected: visible
observed: no node (match count 0)
```

Look at: `e2e/case-pages.e2e.ts:11`  

## Steps

1. ✓ `app.open` `/app/vault/cases/43e530dc-06aa-42e2-bbd8-0b8d4c91f86e` (2.4s)
2. ✓ `locator.tap` `getByRole("group", name: "Seção do caso") >> getByRole("button", name: "Páginas")` (1.0s)
3. ✓ `expect.toBeVisible` `getByText("Nenhuma página nesta pasta.")` (8.3s)
4. ✓ `locator.tap` `getByRole("button", name: "Nova página")` (91ms)
5. ✓ `locator.fill` `getByLabel("Nome da página")` (107ms)
6. ✓ `locator.tap` `getByRole("button", name: "Criar página")` (118ms)
7. ✗ `expect.toBeVisible` `getByRole("textbox", name: "Texto do documento")` (10.0s) — **ASSERTION_FAILED**

## Screen at failure

URL: `http://localhost:62541/app/vault/cases/43e530dc-06aa-42e2-bbd8-0b8d4c91f86e/pages/2f3b8473-9ee9-4847-a8a3-7abdf7795009`  

The screen as the agent reads it, one node per line: `#id role "name" text="…" [states]`.

```text
# Screen at failure
url: http://localhost:62541/app/vault/cases/43e530dc-06aa-42e2-bbd8-0b8d4c91f86e/pages/2f3b8473-9ee9-4847-a8a3-7abdf7795009
revision: b1
viewport: 1280x844
nodes: 34

#root document "Página do caso | Lume"
 #n7 link "Ir para o canvas" href="/app/vault/cases/43e530dc-06aa-42e2-bbd8-0b8d4c91f86e/pages/2f3b8473-9ee9-4847-a8a3-7abdf7795009#…"
 #n8 complementary "Lume"
  #n9 text="Lume"
  #n10 button "Ampliar conversa"
  #n11 button "Recolher o Lume"
  #n12 button "Mostrar conversas"
  #n13 heading "Conversa privada"
  #n14 button "Nova conversa"
  #n15 link "Personalizar Lume" href="/app/agents/settings"
  #n16 button "Artefatos"
  #n17 text="Peça o que precisar. O Lume consulta os documentos do escritório e cria tarefas, reuniões e casos por você."
  #n18 textbox "Pergunte ao Lume"
  #n19 button "Arquivo para anexar"
  #n20 button "Anexar arquivos"
  #n21 button "Gravar áudio" [disabled]
  #n22 button "Enviar mensagem" [disabled]
  #n23 "Contexto da próxima mensagem" text="Plano de trabalho conjunto"
 #n24 region "Canvas do escritório"
  #n25 "Barra do escritório"
   #n26 button "Abrir módulos"
   #n27 navigation "Abas do canvas"
    #n28 button "Páginas do caso 1791333579270"
    #n29 button "Fechar aba Páginas do caso 1791333579270"
    #n30 button "Início"
    #n31 button "Fechar aba Início"
    #n32 button "Plano de trabalho conjunto"
    #n33 button "Fechar aba Plano de trabalho conjunto"
   #n34 button "Notificações"
   #n35 button "Conta de Verificação Lume"
  #n36 main
   #n37 status "Abrindo documento…"
    #n38 text="Abrindo documento…"
 #n39 alert
```

## Evidence

- screenshot `.e2e/verify/20261006T234247-d88728/case-pages/artifacts/web/e2e_case-pages.e2e.ts__p_C3_A1ginas_3A_20criar_20no_20caso_2C_20editar_2C_20recarregar_2C_20restaurar_20e_20usa-6fcf2e8a/default/attempt-0/…`
- log `.e2e/verify/20261006T234247-d88728/case-pages/artifacts/web/e2e_case-pages.e2e.ts__p_C3_A1ginas_3A_20criar_20no_20caso_2C_20editar_2C_20recarregar_2C_20restaurar_20e_20usa-6fcf2e8a/default/attempt-0/…`
- video `.e2e/verify/20261006T234247-d88728/case-pages/artifacts/web/e2e_case-pages.e2e.ts__p_C3_A1ginas_3A_20criar_20no_20caso_2C_20editar_2C_20recarregar_2C_20restaurar_20e_20usa-6fcf2e8a/default/attempt-0/…`
- trace `.e2e/verify/20261006T234247-d88728/case-pages/artifacts/web/e2e_case-pages.e2e.ts__p_C3_A1ginas_3A_20criar_20no_20caso_2C_20editar_2C_20recarregar_2C_20restaurar_20e_20usa-6fcf2e8a/default/attempt-0/…`

<sub>e2e 0.15.1 · run `01a113cd-12af-7dea-bdde-ff74af881c83` · the whole run is in `report.json`</sub>
