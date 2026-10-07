# Lume design system

The office is two surfaces side by side. The Lume panel floats on the left, and the canvas on the right shows the work: Início, cases, documents and modules. The person asks in the panel, the Lume acts, and the canvas shows what it touched. Everything is ink on warm paper, and the one orange belongs to the Lume.

The UI is built on [shadcn/ui](https://ui.shadcn.com) (Radix, `radix-nova` preset) with Tailwind v4. Primitives live in `src/components/ui/` and are ours to edit. The canvas page and its controls live in `src/components/canvas/`, the shell in `src/components/shell/` and the panel in `src/components/lume-panel/`. Tokens are set in `src/app/globals.css`. Style with Tailwind utilities and tokens, never with hex values.

The reference is the prototype: `Main.dc.html` (computer), `Celular.dc.html` (phone) and `Sistema.dc.html` (the visual-system board). Code comments cite it by these names.

## Principles

1. **The Lume comes first.** The panel sits beside every view and holds the only conversation. A view never adds its own chat, a shortcut tile to the Lume or a second logo. What the Lume does shows in the panel as a plan, and in the canvas as the tab, row or block it changed.
2. **Cases are spaces.** A case is a place with its people, its sections and its items drawn as previews, not a folder in a drive. Each case opens in its own canvas tab, and the Lume reads the open case as the subject of the conversation.
3. **Ink plus one orange.** Hierarchy comes from size, weight and the ink ramp. `brand` appears only where the Lume acts or where something needs the person. Modules have no color, and icons are strokes in the text color.
4. **Real data only.** Every name, figure and sentence on screen comes from the office's records or the Lume's work. The empty panel builds its day sentence from the agenda, and its suggestions offer only what the Lume can do from the open view. No view ships sample content, and the landing never invents numbers or clients.
5. **Quiet states.** Empty, loading and error states are one short pt-BR sentence in `muted-foreground`, with "Tentar novamente" where a retry helps. No illustrations and no colored alert boxes.

## Two shells share one set of views

`src/app/app/(office)/layout.tsx` picks the shell per office. `isCanvasShellEnabled(officeId)` in `src/lib/canvas-shell/rollout.ts` reads the Flagship flag `canvas-shell`. `K5_CANVAS_SHELL=on` forces it on for local development, the verify instance and e2e.

- Flag on: `OfficeShell` (`src/components/shell/office-shell.tsx`) with the Lume panel and the canvas. Most of this document describes it.
- Flag off: the sidebar shell (`AppSidebar`), kept until the pilot ends. See [Sidebar shell (flag off)](#sidebar-shell-flag-off).

The views were restyled for everyone and render the same in both shells. In the sidebar shell a `CanvasPage` sits inside the sidebar's `main`. `/app/agents` is a page only in the sidebar shell. In the canvas shell it redirects to Início, or to the document it had open, and the panel opens the conversation the link names.

## Tokens

Set in `:root` and `.dark` in `globals.css` and used through Tailwind classes such as `bg-pane`, `border-border-strong` and `text-muted-foreground`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#FDFDFB` | `#1A1918` | The canvas, the shell ground and the panel on a phone |
| `pane` | `#FAFAF8` | `#1E1D1B` | The floating panel on a computer |
| `card`, `popover` | `#FFFFFF` | `#222120` | Cards, KPI tiles, the plan and approval cards, the composer, menus and dialogs |
| `muted`, `secondary` | `#EFEEEA` | `#2A2927` | Sunken fills: the person's message, the context chip, the muted `Pill`, avatars without a photo, `kbd` |
| `foreground` | `#1C1B19` | `#E2E0DB` | Text |
| `muted-foreground` | `#6D6C6A` | `#A19F9B` | Secondary text, row icons, eyebrows, inactive tabs |
| `subtle-foreground` | `#75746F` | `#8A8884` | Placeholders and quiet notes, 4.5:1 on `background` |
| `primary` | `#1C1B19` | `#F3F1EC` | The primary button and the send button, with `primary-foreground` (`#FAFAF8`, `#161514`) |
| `accent` | ink at 4.5% | white at 5% | Hover fills |
| `selected` | ink at 7% | white at 8.5% | The active tab, the current launcher row, the open conversation, a pressed `Chip` |
| `border` | ink at 9% | white at 8% | Hairlines: cards, the strip, tab strips, table headers, dialog footers |
| `border-strong` | ink at 16% | white at 14% | A hovered card, the composer, the phone pill, the strip's divider |
| `input` | ink at 16% | white at 14% | Control outlines |
| `line` | ink at 14% | white at 12% | Structure in the sidebar shell, the auth screens and the landing |
| `brand` | `#E08A6B` | `#E08A6B` | The Lume. See the list below |
| `brand-ink` | `#A9502F` | `#EBA184` | Brand text on paper: a running or waiting step, the accent `Pill`, relevance in case law |
| `brand-soft` | brand at 12% | brand at 16% | The Lume strip, rows the Lume prepared, the accent `Pill` |
| `brand-foreground` | `#1C1B19` | `#1C1B19` | Text on a brand fill |
| `ring` | `#E08A6B` | `#E08A6B` | Focus rings and the composer's focus border |
| `destructive` | `#B3261E` | `#FF9C94` | Error text and the destructive button |
| `overlay` | `#1C1B19` | `#000000` | The dim behind dialogs and sheets, at 25% (50% in dark) |
| `canvas` | `#F3F2EE` | `#0E0D0C` | No component uses it. The sidebar tokens repeat its value |
| `panel` | `#EAE9E4` | `#2A2927` | Landing blocks and the halftone silhouettes |
| `--shadow-float` | `0 1px 2px` and `0 12px 32px`, ink at 5% and 9% | `0 1px 2px` and `0 16px 40px`, black at 40% and 45% | What floats: the panel, the phone pill, menus, dialogs, the scroll-to-latest button |
| `--ease` | `cubic-bezier(.16, 1, .3, 1)` | same | Expo out, for every transition: `ease-(--ease)` |

On `Sistema.dc.html`, `background` is "Canvas", `pane` is "Painel do Lume", `card` is "Cartão", `muted` is "Afundado", `muted-foreground` is "Texto secundário" and `canvas` is "Fundo do app". The token named `canvas` is not the canvas surface.

`brand` marks only these things:

- the beam of the mark while the Lume works or waits
- the 6px urgent dot on a row, and the unread dot on the bell and the phone menu
- running and waiting plan steps, in `brand-ink`
- the outline of an approval card while it waits
- the Lume strip of a case and of Administração, in `brand-soft`
- rows the Lume prepared: `DataTable` `highlight` and Agenda suggestions
- the accent `Pill`, for a status that needs the person
- the 2px rule on the Lume's results: changed document blocks, its e-mail summaries, the "Pedido enviado" line, saved-copy notices
- focus rings and the composer's focus border

## Type

Geist (`--font-geist`) is the only face. `font-serif` and `font-heading` resolve to it. The body is `text-sm` (14px) with `letter-spacing: -0.006em`, and `h1` to `h3` take -0.02em. `text-xs` and `text-sm` set line-height 1.45, the prototype's value for every small size. Weights are 400, 500 for emphasis and 600 for titles.

| Role | Size | Where |
| --- | --- | --- |
| View title | 26px, 600, -0.02em (24px on a phone) | `CanvasHeader` |
| Section | 15px, 600 | `CanvasSection`, "Lume" in the panel header |
| Dialog title | 17px, 600, -0.01em | `DialogTitle` |
| Greeting | 21px, 600 | The empty panel |
| Conversation | 15px at 1.6 for the Lume, 14.5px at 1.55 for the person | The thread, at 15.5px and 15px on a phone |
| Interface | 14px for row titles, 13.5px in buttons, inputs and table cells | Rows, controls |
| Meta | 12.5px to 13px in `muted-foreground` | Eyebrows (13px), row details, statuses |
| Mono | Geist Mono, 12.5px (`font-mono text-[12.5px]`), never a sentence | Times, dates, deadlines, process numbers, values, counts |

Icons are lucide, drawn with a 1.5 stroke (`svg.lucide` in `globals.css`): 16px in rows and buttons, 14px in tabs and chips, 18px in the phone bars. Icons take the text color or `muted-foreground`.

The utilities `display`, `page-title`, `label-mono` and `square-dot` serve the auth screens, the landing and the sidebar shell. Canvas views don't use them.

## Radius

| Step | Class | Use |
| --- | --- | --- |
| 6px | `rounded-sm` | Buttons, strip and icon buttons, the context chip |
| 8px | `rounded-md` | Inputs and selects, rows, canvas tabs, filter `Chip`s, menu items |
| 10px | `rounded-[10px]` | `CanvasRow` on a phone |
| 12px | `rounded-lg` | Cards, KPI tiles, the plan and approval cards, menus, popovers, the launcher |
| 14px | `rounded-[14px]` | The composer and the person's message (18px and 16px on a phone) |
| 16px | `rounded-xl` | The floating panel, dialogs, search, bottom sheets, the notification and feedback panels |
| Round | `rounded-full` | Avatars, dots, the send button, `Pill`, the phone pill |

## Office shell

### Computer

`OfficeShell` fills the viewport (`h-dvh`) on `background`. A skip link, "Ir para o conteúdo", comes first, then two regions:

- `aside#lume-panel` ("Lume"): the panel, mounted once and kept while collapsed. From `md` it floats 10px from the top, bottom and left edges. It is `clamp(360px, 33.333%, 500px)` wide, on `pane`, with 16px corners, a `border` hairline and `--shadow-float`.
- `main#main-content` ("Canvas do escritório"): the strip, then `.canvas-scroll`, the one scrolling region. Views with scroll regions of their own (E-mails, Mensagens, WhatsApp) fill it instead.

### Collapsed

Ctrl J or "Recolher o Lume" collapses the panel. The head script in `src/lib/canvas-shell/panel.ts` sets `data-lume-panel="collapsed"` on `html` before the first paint, so the geometry is CSS (the `lume-collapsed:` variant) and React follows it. On a computer `localStorage` (`lume:panel`) keeps the choice. A 36px round button with the live mark (30px) takes the top-left corner: "Abrir o Lume", Ctrl J. The mark shows the Lume's state while the panel is closed, and the strip starts 60px in to clear it. Opening the panel focuses the composer. Collapsing it focuses the mark.

### Strip

The strip is 52px under a `border` hairline. In order:

1. The launcher button, "Casos e módulos" (32px, `LayoutGrid`).
2. An 18px divider in `border-strong`.
3. The tabs (`nav` "Abas do canvas").
4. "Buscar" with the `kbd` "Ctrl K": 32px, outlined in `border`, 8px corners.
5. The bell. A brand dot shows while anything is unread, and the label counts it.
6. The theme toggle, a Sun or Moon icon.
7. The avatar (28px). Its menu holds the name and office, Perfil, "Enviar feedback", "Instalar o Lume" and "Sair".

Icon buttons on the strip are 32px with 6px corners, in `muted-foreground`, with an `accent` hover (`stripButton`).

### Tabs

`canvas-tabs.ts` and `places.ts` in `src/components/shell/` hold the model. The canvas opens one tab per case, document and module. Moving inside a module, such as a view of Escritório or a section of Administração, stays in its tab. Início comes first and never closes.

- A tab is 32px with 8px corners: a 14px icon, the title in 13px medium and a 22px close button ("Fechar aba …"). Início is at most 110px wide, other tabs 230px. When the tabs outgrow the strip, the others shrink to 88px and then scroll behind Início, which stays put. The open tab keeps at least 120px and is always scrolled into view. The active tab takes `selected`, and the others are `muted-foreground` with an `accent` hover.
- While the Lume works in a case, or touches a place in the running turn, that tab shows the live mark in place of its icon. A case keeps the mark while the Lume waits on the person there.
- Beyond eight tabs, opening one drops the oldest tab that is not Início. Closing the active tab moves to the one before it.
- Tabs persist per person and office in `localStorage` (`lume:canvas-tabs:v1:<user>:<office>`). Zod validates them on read and drops anything malformed.
- A view names its tab and sets the canvas subject with `<CanvasMeta title subject />`. The composer's context chip shows the subject.
- A plain click opens a place through `useShell().open(href, title)` (or `CanvasLink`). A modified click keeps the browser's own behavior.
- An open document saves before the canvas leaves it. If the save fails, the canvas stays.

### Launcher

The launcher is a 360px popover under its button, with 12px corners and 6px padding. The same list, `LauncherList`, fills the phone menu.

- "Plataforma", for platform administrators: Administração, noted "Só a equipe Lume".
- "Casos": the three most recent cases and "Todos os casos".
- "Módulos", in two columns. Escritório opens as its three main views: Tarefas, Agenda and Clientes. The Lume is the panel, so it is not a module, and the Cofre is "Todos os casos".
- After a hairline: Perfil and Tutorial.

Rows are 34px with 13.5px text (44px and 15px on a phone), 8px corners and a 16px icon in `muted-foreground`. The row for the page on screen takes `selected` and medium weight. A module in beta carries `BetaLabel`.

### Search and keyboard

Ctrl K opens "Buscar no escritório", a command dialog 560px wide, 64px from the top on a phone and 96px on a computer. Its groups are "Abas abertas", "Casos" and "Módulos e conta". The placeholder is "Buscar casos, módulos e abas", and no match reads "Nada encontrado.".

| Keys | Action |
| --- | --- |
| Ctrl K or ⌘ K | Open or close search |
| Ctrl J or ⌘ J | Collapse or open the panel |
| Ctrl S or ⌘ S | Save the open document |
| Esc | Close a dialog, a menu or the panel's history |

### Phone

Below `md` one surface has the whole screen, and the Lume comes first. The head script collapses the panel only when the address points at a view other than `/app`, `/app/command-center` or `/app/agents`, such as a notification link. On a phone the choice lasts for the visit.

- The panel fills the screen on `background`, with no float, border or corners. Its header is 56px under a hairline, and the collapse button becomes "Abrir o canvas do escritório" (`Layers`).
- The canvas header is 56px plus the top safe area: "Lume" with a back arrow, the view's own actions (`CanvasPhoneActions` renders them here), "Buscar" and "Mais opções". All are 44px. A view with a parent replaces "Lume" with its own way back through `CanvasPhoneBack`: a page opened from a case shows "Caso".
- "Mais opções" opens a bottom sheet with the launcher list and a row with Sair, Notificações, "Enviar feedback", "Instalar Lume" and the theme. Its grid icon carries the unread dot.
- A floating pill brings the Lume back. It is 52px, round, on `card` with `border-strong` and `--shadow-float`, 16px from the sides and 18px above the safe area. It shows the live mark and "Pedir ao Lume", "Pedir ao Lume sobre este caso" or "Pedir ao Lume sobre esta página". It hides while a field has focus and on views with their own composer.
- Opening a place from the panel collapses the panel, so the canvas shows. A place the Lume opens while it works waits behind the conversation instead.

## Lume panel

`LumePanel` (`src/components/lume-panel/lume-panel.tsx`) mounts `AgentChat` (`src/components/agent-chat.tsx`) in `panel` mode. Until the person accepts the AI data notice, the panel shows `AiDataNotice`. A link with `?conversationId=` (and optionally `&caseId=`) opens that conversation in the panel, wherever the canvas is.

### Header

The header is 52px: the live mark (22px), "Lume" and a status line in 12.5px `muted-foreground` with `aria-live`. The line reads "trabalhando", "trabalhando · 2 de 4 tarefas" or "precisa de você", and is empty at rest. The mark is `still` at rest, `working` during a turn and `attention` while an approval waits. Three 32px ghost buttons with tooltips follow: "Conversas anteriores", "Nova conversa" and "Recolher o Lume".

### Empty conversation

The empty state sits at the foot of the thread, above the composer:

- the mark in `idle` (40px)
- a greeting by hour and first name, 21px ("Boa tarde, Ana.")
- one sentence about the day from the agenda, then "Por onde começamos?" ("Uma tarefa vence até hoje e há uma reunião às 15:00. Por onde começamos?")
- up to four suggestions as 40px rows with an icon, chosen by the canvas subject: a case ("Resuma este caso"), a document ("Revise este documento"), Agenda, Honorários, Pesquisa or the office

`sessionStorage` (`lume:day`) keeps the day sentence until midnight, so a new conversation paints it at once.

### Thread

The thread scrolls inside the panel with 20px sides and 16px between messages. The person's message is a `muted` bubble on the right, at most 86% wide, with 14px corners. The Lume's answer has no bubble. Above the answer, the turn's steps show as a plan card when there are two or more, and otherwise as tool lines. A tool line is 13px `muted-foreground`: the module icon, the action, the detail in `subtle-foreground` and "Abrir".

While the turn runs and no plan card shows it, the answer ends in one working line (`SmartWorking`): the mark in `working` and what the Lume is doing ("Pensando…", "Consultando o Cofre…", "Escrevendo…", "Conferindo as citações…"). The server sends the phase from the stream (`src/lib/chat-status.ts`). The reasoning text is never shown. Under the answer, "Copiar resposta" and "Gerar novamente" (28px) appear on hover or focus. More than 240px from the end, a 36px round button, "Voltar ao mais recente", floats above the composer.

### Plan card

`PlanCard` (`plan-card.tsx`) is a 12px `card` with a hairline. Its header reads "Plano do Lume" and a summary such as "2 de 4 concluídas · 1 precisa de você". Each step is a row:

- a 16px state icon, with the state as screen-reader text: done (`CircleCheck`, ink), running (`LoaderCircle`, `brand-ink`), needs the person (`CircleAlert`, `brand-ink`), failed (`destructive`), cancelled (`subtle-foreground`)
- the module (12px icon and name) over the step's title (13.5px) and detail (12.5px, two lines at most)
- "Abrir" or "Baixar" for what the step created

`plan.ts` reads the plan from what the turn did: finished tool calls (repeats of one tool make one step), approvals and the running step. The model decides one step at a time, so the card never lists future steps. It updates in place.

### Approval card

The Lume asks before it sends, deletes, reaches a court, overwrites a draft or moves money. `ApprovalCard` (`approval-card.tsx`) is the only shape that question takes. It is never a modal and never a chip.

- A 12px `card` with 14px padding, outlined in `brand` while it waits and in `border` after.
- A 13px context line with the module icon ("Enviar para Felipe no WhatsApp"), then the content itself at 14px.
- Google actions show their review (`GoogleApprovalReview`) before Confirmar unlocks.
- "O Lume só faz isso com a sua confirmação.", then Cancelar (outline) and Confirmar (primary). On a phone they split the row at 44px.
- After the decision one status line replaces the buttons: "Confirmado", "Cancelado" or "Não concluído", the result and "Abrir".

Confirmar runs on the server exactly the action the Lume proposed. While an approval waits, the panel's mark and status, the collapsed mark, the case's tab and the case strip show `attention`.

### History

"Conversas anteriores" swaps the thread for the history: "Conversas", then 44px rows with the title and a mono relative time. The open conversation takes `selected`, and a bin ("Excluir …") appears on hover or focus. An empty history reads "Seu histórico aparecerá aqui.". Behind a hairline at the foot: "Artefatos desta conversa" (outline) and "Personalizar o Lume" (ghost). Esc closes the history and returns focus to its button.

### Composer

`Composer` (`composer.tsx`) is a 14px `card` outlined in `border-strong`. The outline turns `ring` while it has focus. The text is 14.5px, starts at two rows and grows to ten ("Peça algo ao Lume"). One row of controls sits under it:

- attach (`Plus`, 30px), a menu with "Tirar foto", "Documento ou planilha" and "Escolher imagem"
- the context chip, the canvas subject: 26px, 6px corners, `muted`, 12.5px, at most 250px ("O Lume vê: Silva vs. Construtora Horizonte")
- the microphone, "Gravar áudio"
- send, a 32px ink circle that becomes a stop square ("Parar resposta") while a turn runs

While recording, a trash button ("Descartar gravação") replaces the microphone, and a meter of `brand` bars with a timer replaces the chip. Send becomes "Parar gravação e enviar". The audio is transcribed ("Transcrevendo áudio…"), joined to anything typed and sent as the person's own words. A control the configured model cannot support stays visible and disabled, with a tooltip: "O Lume não lê imagens nesta configuração.". The model is never shown.

### Attachments and artifacts

Attachments belong to the message, apart from the Cofre. A message takes up to six files: documents up to 25 MB, images up to 10 MB. Files that cannot attach are named in one error line. A document brings up to 300 thousand characters of text, and a Word file also brings its pictures in reading order. Removable previews sit above the composer before sending and stay in the message after. The camera starts only after "Tirar foto", allows a retake and stops when its dialog closes.

"Artefatos desta conversa" opens a right sheet with "Documentos do Lume" and "Anexos enviados". "Salvar no Cofre" opens a form behind a 2px `brand` rule: Formato (PDF or DOCX), Destino (Biblioteca or a case) and Pasta. An error stays in the form with "Tentar de novo". "Do Cofre nesta conversa" selects stored material as context. Uploading in the chat never adds context or a Cofre copy by itself.

### The canvas follows the Lume

Every message carries what the canvas shows: the subject and the open tabs (`canvas` in `src/lib/chat-contract.ts`). The model reads their names as data, never as instructions. While the Lume works, the server streams `data-canvas` commands (`src/lib/canvas-protocol.ts`). They move the canvas as it happens and are never stored, so a reload does not replay them.

- `open` brings a place up in its tab: what the person asked to see, through `k5_ui_open_resource` (a case, a page, a Cofre file at its folder, a client, an activity or a module by name), and whatever the Lume just created or changed. A page already on screen reloads instead.
- `touch` marks the tab of a place the Lume only read, until the turn ends.
- Downloads, outside links and the Lume's own route never move the canvas.

A document the Lume writes therefore opens by itself in a canvas tab (`/app/documents/<id>`). `document-bridge.tsx` connects the document to the panel: "Pedir ao Lume" on a selection sends the request into the panel's conversation, quoting the excerpt. While a document is the canvas subject, the turn knows which one, so "o documento" needs no name. A case on screen scopes the turn when the conversation has no case of its own, and the chip shows it.

### Answers, citations and case law

- Answers are Markdown (`src/components/markdown.tsx`), rendered from tokens into React elements, never into HTML. Headings, lists, tables and code inside an answer are content, so the ban on lists in UI chrome does not apply.
- Citations are reviewed, not blocked (`src/lib/citations/`). Under an answer, "Citações para conferir" lists those that need the lawyer: the citation in medium weight, its status in words ("Fonte correspondente não identificada", "A fonte sustenta só em parte", "A fonte diz o contrário", "Não verificada") and the source as a link. One quiet line counts the citations that match. The document's Revisão tab shows the same rows.
- Case law from the web is a list built from the `k5_research_web_jurisprudence` result: the title as an external link, court · number · date · site, the relevance in `brand-ink`, a three-line summary and a note to check the full text before citing. Only links the search returned appear.
- "Fontes da pesquisa (N)" is a disclosure with the web sources.

## Canvas page anatomy

Views compose the primitives in `src/components/canvas/canvas-page.tsx`.

**`CanvasPage`** is one centered column: `default` for modules, `wide` for grids, boards, tables and Administração. The 96px foot on a phone clears the pill.

| Width | Max | Computer padding | Phone padding | Gap |
| --- | --- | --- | --- | --- |
| `default` | 880px | 48px sides, 40px top, 64px bottom | 16px sides, 18px top, 96px bottom | 40px, 16px on a phone |
| `wide` | 1120px | 40px sides, 28px top, 64px bottom | same | same |

**`CanvasHeader`** takes `eyebrow`, `title` and `actions`. The eyebrow is 13px `muted-foreground` and adds context: a date, counts, an address. The title is the view's only `h1`. Actions sit on the right and wrap under the title on a narrow screen. One primary action per view, usually an outline button with its `Plus`.

**`CanvasSection`** is a titled block: an `h2` at 15px semibold, an optional `action` and 12px to its content. `CanvasSectionLink` is that action: a 28px quiet text link such as "Ver todos".

**`CanvasRow`** is one row of a list. Rows have no dividers. They bleed 12px into the margin (8px on a phone), so their text aligns with the page.

| Part | Look |
| --- | --- |
| `icon` | 16px, `muted-foreground`, decorative |
| `control` | An interactive lead, such as the checkbox that completes a task |
| `title` | 14px medium (14.5px on a phone), truncated |
| `detail` | After the title, 13.5px `muted-foreground`. Under it when `stacked` and always on a phone, at 12.5px |
| `urgent` | A 6px `brand` dot before `meta`: the item needs the person soon |
| `meta` | Mono 12.5px at the end: a time, a date, a value |
| `status` | Under `meta` in stacked rows, 12px: a status in words |

A plain row is 44px (52px on a phone), and a `stacked` row is 56px. A row with `href` is a link and with `onClick` a button. With a `control`, the title becomes the link stretched over the row, and the focus outline draws on the row. Pass `label` when the visible text is not the action's name ("Assistir: …"). Hover is an `accent` fill with 8px corners (10px on a phone).

**`CanvasCard`** is a raised tile in a grid: 12px corners, a `border` hairline that turns `border-strong` on hover, on `card`. It renders a link, a button or a `div`. As a button its children must be inline.

**`CanvasTrail`** (`canvas-controls.tsx`) is the 44px bar over a page opened from a module: a reader, a conversation, a video. It sticks to the top under a hairline. The way back (icon and label) is in `muted-foreground`, then "/" and the current page in medium weight with `aria-current`. The page's quiet actions (`trailAction`, 30px, 44px on a phone) sit at the end.

## Controls

The controls in `src/components/canvas/canvas-controls.tsx` follow the prototype's `admBloco` and `admTabela`.

**Chip is a filter control.** `Chip` is 30px (44px on a phone) with 8px corners and 13px text. Off, it shows a hairline and `muted-foreground` with an `accent` hover. On, it takes `selected` and medium weight, and sets `aria-pressed`. With `menu`, it opens a dropdown of options (`FilterMenu`), shows a 12px chevron and leaves `aria-pressed` to the options. A bar of chips scrolls sideways on a phone.

**Pill is a status, used only where the prototype uses one.** `Pill` is 22px, round, 12px medium. `muted` is the default (`muted` fill, `muted-foreground`). `accent` (`brand-soft`, `brand-ink`) marks a status that needs the person: a P0 ticket, a failed run, a pending payment. The prototype puts pills in the status columns of Administração's tables and in their detail facts. Everywhere else a status is plain text, such as `CanvasRow` `status`.

**`Field`** puts a 12px `muted-foreground` label 6px above its control. `htmlFor` takes an id from `useId`.

**`KpiRow` and `Kpi`** are a `dl` of equal tiles 12px apart: two per line on a phone, one line from `md`. A tile is a 12px `card` with a hairline. The label is 12.5px `muted-foreground`, and the value is mono at 21px (18px with `size="small"`).

**`DataTable`** is `role="table"` with a required `label`. Columns are grid tracks: a fixed width, or `minmax(0, 1fr)` for the flexible column. The header is 12px medium `muted-foreground` over a hairline. Rows are 46px (58px with `tall`), with 8px corners, an `accent` hover and no dividers.

- Cells are 13.5px. `mono` sets 12.5px mono, `strong` 14px medium, and `sub` adds a 12px second line.
- `rowHref` stretches the flexible column's link over the row. Cells with `interactive` sit above it.
- `highlight` fills rows the Lume prepared or changed with `brand-soft`.
- On a phone each row stacks: the flexible column on top, the others on one quiet line. The header becomes screen-reader only, and columns with `phone: false` hide.
- `empty` is one sentence.

**`Button`** (`src/components/ui/button.tsx`) has 6px corners and 13.5px text. Sizes: `default` 32px, `sm` 28px, `xs` 24px, `lg` 34px, `icon` 32px, `icon-sm` 28px, `icon-lg` 36px. `default` is ink in medium weight, fading to 88% on hover. `outline` is drawn in `input`, and `outline`, `ghost` and `secondary` take an `accent` fill on hover. `destructive` is outlined in red with a faint red hover. A press moves the button down 1px. A leading action may put its arrow at the far end with `justify-between`.

**Inputs** are 36px with 8px corners, outlined in `input`. A field's error is a 12px `destructive` line under it. A form-level error is an inline `CircleAlert` and red text, never a filled box. A form that needs a choice checks it itself (`noValidate`) and says what is missing under the field.

**Selects** look the same everywhere. A native `select`, `SelectTrigger` and `PickerTrigger` (`src/components/ui/picker-trigger.tsx`) are outlined in `input`, start their text 10px in and draw the chevron in `muted-foreground` 10px from the right. For native selects this is one unlayered rule in `globals.css`, so a component's `px-*` cannot move the text or the arrow. A select inside a sentence opts out with `data-inline`. A choice that needs searching uses one picker, never a search field beside a select.

**Section tabs** share `sectionTab` and `sectionTabRow` (`src/components/section-tabs.ts`): 40px, 13.5px (14px on a phone), the active tab in medium weight over a 2px ink rule, the others in `muted-foreground`, all on one hairline. On a phone the row scrolls sideways. A case's sections look the same, with mono counts. The versions of a calculation or a proposal use them too (`VersionTabs`, `src/components/version-tabs.tsx`).

## Dialogs and overlays

`DialogContent` (`src/components/ui/dialog.tsx`) is the one dialog:

- 540px wide from `sm`. On a computer it hangs 96px from the top with a maximum height of `100dvh - 8rem`. On a phone it is centered with 16px margins.
- 16px corners, a `border` hairline, `popover` and `--shadow-float`. Padding is 24px at the sides, 22px on top and 20px below, with 18px between its parts.
- The close button, "Fechar", is a 30px ghost 18px from the top right. `DialogTitle` is 17px semibold, and `DialogDescription` 13px `muted-foreground`.
- `DialogFooter` sits under a hairline with its actions on the right. On a phone the actions stack, primary first.

Form dialogs keep their fields in a scrolling area between the title and the footer, so Cancelar and Salvar stay in view on a phone. `AlertDialog` asks before a destructive step ("Sair sem salvar?").

Overlays dim and never blur. `backdrop-filter` breaks stacking in some Safari versions, and a flat `bg-overlay/25` (`/50` in dark) is cheaper on a phone.

- Bottom sheets float 8px from the sides and above the safe area, with 16px corners and a hairline. The geometry is unlayered CSS in `globals.css` (`[data-slot="sheet-content"][data-side="bottom"]`).
- Notificações and the feedback panel are dialogs. On a computer they hang under the bell, 56px from the top and 12px from the right. On a phone they sit at the bottom.
- Menus and popovers are `popover` with 12px corners, a hairline and `--shadow-float`. Items have 8px corners and an `accent` hover.

## Views

**Início** (`/app/command-center`, `src/components/inicio/`) is a `default` page. The eyebrow is the date and the title is "Hoje", with no actions: the panel greets. The day comes first, as rows with no heading. Tasks lead with their checkbox. Meetings, fees and court deadlines lead with an icon. Each row ends with its mono time, and urgent items carry the dot. After eight rows, "Mais N no Escritório" links on. "Casos recentes" (172px cards in columns of at least 220px, "Ver todos") and "O que o Lume fez hoje" (the mark, a sentence, a mono time) follow and are hidden on a phone. An empty day reads "Nada para hoje.".

**Casos** (`/app/vault`) is a `wide` page: "Casos", a grid or list toggle, "Buscar casos" and "Novo caso". The grid holds `CaseCard`s, 248px tall in columns of at least 260px. A card shows the name over a hairline, the client, a summary, "N arquivos · atualizado …", the people and a "•••" menu. The last card is "Biblioteca do escritório". The list view uses stacked rows.

A case (`/app/vault/cases/<id>`) is a space:

- The header has the way back to "Casos", the name, "cliente · área", the mono process number with the court, the people (30px avatars), "Compartilhar" and a "•••" menu: Editar caso, Conversar sobre o caso, Tarefas e Agenda, Importar do Google Drive, Excluir caso. On a phone, Compartilhar and the menu move to the canvas header.
- The Lume strip (`CaseStrip`) shows only while the Lume works in the case or waits on the person: `brand-soft`, the live mark, "O Lume está trabalhando neste caso." and "Acompanhar" when the panel is collapsed.
- Sections are tabs with mono counts: Tudo, Páginas, Arquivos, Tarefas, Honorários, Processos, Referências, Anexos. A case shared from another office hides Tarefas, Honorários and Processos. "Nova pasta" and "Enviar arquivos" end the row.
- Items are cards (`ItemGrid`, columns of at least 210px) with a 118px preview: a page's first lines, a sheet of paper, image tiles or a folder. Items the Lume wrote carry its mark. On a phone items are rows with a 36px tile. Folders open in place under a trail.

"Enviar arquivos" sends one file per request, in order, and the button counts ("Enviando 2 de 5…"). A failure names its file and the rest continue. "Nova pasta" asks who sees the folder: "Todos do caso", "Só eu" or chosen people. Ancestors restrict descendants. The share dialog adds associates, lists Participantes and manages "Portal do cliente". Anexos turns a scanned PDF and the petition into PJe files: "Propor anexos", "Revise antes de gerar", "Gerar N anexos".

**Documento** (`/app/documents/<id>`) has no `CanvasPage`. A sticky 44px bar holds the trail (the case, or "Conversa"), the title, the save state in words ("Salvando…", "Alterações não salvas", "Salvo"), the tabs Editar, Página and Revisão, then Versões and Exportar. On a phone the trail hides: a page opened from a case goes back with "Caso" in the canvas header, and Versões and Exportar move there too. Editar is rich text in the Word template's font, size, alignment and spacing, in a 640px column. Página draws the export as pages. Revisão holds the human checklist, Citações ("Conferir de novo"), Verificações and Fontes. Saving is automatic after a pause.

After the Lume changes the document, each changed block carries the 2px `brand` rule for 6 seconds, and the first one scrolls into view. The marks never enter the text. When the person has unsaved edits, a line with the rule offers "Ver versão do Lume" or "Manter a minha". Selecting text shows "Pedir ao Lume", which becomes one input ("O que mudar neste trecho?").

**Escritório** (`/app/agenda`) opens on Tarefas, Agenda or Clientes, under section tabs that add Associados, Convites and Atividade. The eyebrow counts ("3 abertas, 1 atrasada") or names the date. The one action is "Nova tarefa", "Nova reunião" or "Novo cliente". A toolbar holds the search, filter chips (Situação, Relacionamento, Área, Caso, Cliente), "Descrever ao Lume" and the list or board switch.

- Rows are stacked. Tasks lead with their checkbox and end with the date and status in words. Meetings end with the time. Clients end with "N casos" and the city.
- Agenda puts the list beside a month card in a 264px column. Pins count every matching activity in the month, and the count is in the day's label.
- The Lume's suggestions are `brand-soft` rows with the mark, "Sugestão do Lume · …" and "precisa de você".
- Done work leaves the list. Situação starts on Abertas, and finished items are one filter away.
- A client's page lists contact facts, "Tarefas e reuniões", "Casos no Cofre" and "Observações". Practice areas are plain text ("Cliente ativo · Cível, Trabalhista"), never chips.

**Honorários**: the eyebrow sums "A receber", "em atraso" and "recebido". Actions are "Propostas e tabelas OAB" (ghost) and "Novo honorário". Rows end with the value in mono and "vence 09/10" or "venceu", and an overdue fee is urgent. A fee's dialog shows KPIs, "Parcelas" and "Histórico de recebimentos". Propostas show Contratação, Êxito estimado and Total estimado as KPIs.

**Cálculos**: "Novo cálculo" is a grid of `CanvasCard`s and "Meus cálculos" a list. A result shows the total in mono and "Memória de cálculo" as a table.

**Pesquisa** (`/app/research`) lists past searches as stacked rows under "Nova pesquisa" (Jurisprudência or Marca). A search and a reader open under a `CanvasTrail` back to "Pesquisa", with actions such as "Atualizar estado", "Fonte oficial" and "Ver na WIPO", icon-only on a phone. A judgment shows "Ementa" and "Inteiro teor" side by side from `lg`. Trademark searches use the WIPO Global Brand Database, and no match never certifies availability. Histories are private to the person.

**Mensagens, WhatsApp and E-mails** list conversations as stacked rows, with unread as the urgent dot. A conversation opens under a trail in a 720px column. The person's messages are `muted` bubbles, the others have none, and the composer matches the panel's. E-mails filters folders with chips (Recebidos, Com estrela, Enviados, Rascunhos, Todos). A message's HTML renders in a sandboxed frame (`email-frame.tsx`): no scripts or forms, links in a new tab, a white page in both themes and remote images blocked until "Mostrar imagens". The mailbox's Opções inteligentes (`SmartOptions`, the mark with no text) offer summaries and replies. Nothing is sent without the person.

**Administração** (`/app/admin`) is a `wide` page for platform administrators. The eyebrow reads "Só administradores da plataforma veem esta área". The Lume strip shows while the Lume works outside a case. Tabs: Feedback, Clientes, Financeiro, IA, Execuções, Credenciais, Auditoria. Each section is built from `admin-blocks.tsx`, filter chips, KPIs and `DataTable`s with pills in the status columns. A broken model choice is a red line with the reason, never a silent fallback. Auditoria lists the newest first, with "Mais antigos →".

The smaller views follow the same parts:

- **Plano**: the plan's end date in the eyebrow, "Pagar um mês" as the action, KPIs, "Créditos" and the payments table.
- **Perfil**: a `wide` page with a heading column from `lg`: "Sobre você", "Como os outros veem", "Acesso" and "Seus dados".
- **Tutoriais**: videos per module as rows, with the duration in mono.
- **Personalizar Lume**: the rules, the knowledge and the Word template.
- **Notificações**: the tabs "Novas" and "Arquivadas", "Arquivar todas", and rows with a title, a two-line summary and a time. Opening or archiving one moves it to Arquivadas. `?notificacoes=1` opens it.
- **Feedback**: three choices ("Algo quebrou", "Tenho uma ideia", "Não entendi algo"), one question that follows the choice, the screen it concerns and an optional screenshot. `?feedback=relatos` opens the person's reports.

## Motion is the mark's states

Motion says what the Lume is doing. Nothing animates its way onto the page. The mark's states (`.lume-mark` in `globals.css`) are the motion:

| State | Where | What moves |
| --- | --- | --- |
| `still` | The panel header at rest | Nothing |
| `idle` | The empty panel, the collapsed mark and the phone pill at rest | One band crosses the beam every 7s |
| `working` | The panel header, the working line, a case's tab and strip | The beam glows and a band flows up every 1.8s |
| `attention` | Anywhere an approval waits | The beam pulses in `brand` every 2.4s |

Hovering Opções inteligentes runs one band through a still mark. Two other signals stay because they are state too: the spinner on a running step or a busy button, and the 2px rule on changed document blocks, which fades over 6 seconds. Hover and focus change color only, over Tailwind's 150ms, with `ease-(--ease)`. No fill sweeps or rises, and nothing uses GSAP. Radix overlays fade through `tw-animate-css`.

Under reduced motion the global rule in `globals.css` stops every animation and transition. The mark keeps its beam lit for `working` and `attention`, and spinners carry `motion-reduce:animate-none`.

## Mobile

- The viewport is `viewport-fit=cover` with `interactive-widget=resizes-content` (`src/app/layout.tsx`), so the keyboard resizes the layout and the composer stays visible.
- `md` (768px) splits phone from computer. Use `max-md:` for phone overrides.
- Use `dvh`, never `vh`. Respect the safe areas: the canvas header pads the top inset, and the pill, sheets and panels clear the bottom one.
- The composer's text is 16px on a phone and starts at one row.
- Nothing widens the page. Grids use `minmax(0, …)` tracks, toolbars use `min-w-0`, and long names truncate.
- Tab strips and chip bars scroll sideways. They never wrap or cut a word.
- A view's header actions move into the canvas header with `CanvasPhoneActions`, and its way back with `CanvasPhoneBack`.
- Views with their own scroll regions lock the canvas scroll (`.canvas-scroll:has(…)`) and hide the pill.

## Accessibility

- **Focus is always visible.** Every control shows a ring or an outline in `ring` on keyboard focus: 2px on most, a 3px ring at 50% on `Button`. The Tailwind 4 trap: `outline-none` sets the outline style to none, and `focus-visible:outline-2` only sets its width, so no outline draws. Never put `outline-none` and `focus-visible:outline-*` on one element. Either use the outline alone (`focus-visible:outline-2 focus-visible:outline-ring`, as `CanvasRow`, `Chip` and `CanvasCard` do), or pair `outline-none` with `focus-visible:ring-2 focus-visible:ring-ring`, as the strip and the panel do.
- **Touch targets are 44px on a phone.** Add `max-md:h-11` or `max-md:size-11`. `Button` `lg` is 34px and is not a touch size.
- **Form ids come from `useId`.** Derive related ids from it (`${id}-name`). Never hardcode an id.
- **Every control has an accessible name.** Icon-only buttons take `aria-label`, with a tooltip or `title` on a computer. Icons and the mark are `aria-hidden` unless labelled. Rows whose text is not the action pass `label`. Counts belong in the label ("Notificações, 2 não lidas"). State icons carry screen-reader text.
- **Status is announced.** Loading lines use `role="status"`, errors `role="alert"`, and the panel's status line is `aria-live`.
- **Focus returns where it came from.** Closing a panel, a sheet or the history focuses its opener. Opening the Lume focuses the composer.
- **Reduced motion is respected.** See the motion section.

## Copy

All UI text is pt-BR, in sentence case and plain words. A status is a word, never a color alone. Ongoing work ends in an ellipsis ("Salvando…"). A button names what it does ("Criar pasta", "Enviar arquivos"). An error says what failed and what to do ("Não foi possível carregar os casos." with "Tentar novamente"). Copy says only what the product does and only what is actually sent. A spoken message shows its words, never "Mensagem de voz".

## Banned patterns

- A chip as anything but a filter, and a pill as anything but a status in a place the prototype uses one.
- Lines between list rows. Space and the hover fill separate rows. A hairline splits only structure: a header, a tab strip, a table's header, a dialog's footer.
- Tinted fills other than `brand-soft` for the Lume's own work and `muted` for sunken surfaces. No colored alert boxes.
- Bullet lists in UI chrome. Use rows, a table or a sentence.
- A bordered card inside a bordered card.
- Gradients, glows, emoji and decorative icons beside headings. The beam of the mark is the one light.
- A color per module, on icons, rules or anywhere else.
- Entrance animations, sweeping or rising hover fills, and blurred overlays.
- A chat, a second logo or a shortcut tile to the Lume inside a view.
- Hex values in components.

## Light by default

Light is the default for everyone. `ThemeProvider` (`src/components/theme-provider.tsx`, `defaultTheme="light"`) stores the person's choice under `k5-theme`, and the system setting never decides. Dark is the same system with other token values. Brand fills keep ink text. `theme-color` follows the theme: `#FDFDFB` in light, `#1A1918` in dark. The strip and the phone menu toggle the theme with a Sun or Moon icon (`useThemeToggle`). `ThemeSwitch`, two small circles, stays on sign-in, the landing, the legal pages, the recovery and client layouts and the sidebar footer.

## Logo

The mark is a cube cut by a beam of light: two ink halves with an S-shaped beam between them. Its geometry lives once, in `src/components/lume-mark.tsx` (`LUME_MARK`, on a `0 0 100 100` box). `public/offline.html`, `public/lume.svg` and `src/app/icon.svg` are served without the app's code, so each keeps a copy of the halves, and `tests/lume-mark.test.ts` fails when a copy drifts.

- `<LumeMark />` is the still mark in `currentColor`, with no tile behind it.
- `<LiveLumeMark state />` (`src/components/live-lume-mark.tsx`) is the mark with its beam, in the four states above. Each instance makes its own ids, so several can share a page.
- `<Logo height={n} />` pairs the mark with a Geist nameplate for compact places, never inside page content.
- `src/app/icon.svg` is the ink mark on a `#F3F2EE` tile. `scripts/generate-pwa-icons.ts` builds the PWA icons and `favicon.ico` from it. Run it after any change to the mark.
- Inside content, the mark signs the Lume's own work: an item it wrote, a suggestion, a line in "O que o Lume fez hoje".

## Halftone, sign-in and landing

`<Halftone />` (`src/components/halftone.tsx`) is the product's one image: square ink pixels, ordered-dithered over slow noise, with a few brand pixels in the mid-tones and optionally the mark cut out of it. Where text sits over the field, the mark is a `panel` silhouette. Where it stands alone, it is a `brand` vector over a paper cut-out. The field leans toward the pointer, is `aria-hidden`, pauses off screen and in hidden tabs, draws one still frame under reduced motion and caps itself near 60 thousand pixels per frame. It appears on sign-in and the landing, never in the office.

Sign-in (`src/components/auth-form.tsx`) is a header row under a `line`, then two cells. The left cell has a mono label, the `display` heading and the form with a full-width ink submit. The right cell is the halftone with the mark, and on a phone it is a 144px strip. The field answers the form: it tightens while the password has focus, flashes on submit and pales on an error.

The landing (`/`, `src/app/page.tsx`) keeps the previous identity's grid of cells split by `line` rules and its `display` type until it gets its own redesign. Its scroll effects (`data-rise`, `data-fade`, `data-wipe`) and the module strip are the only motion outside the mark, and they stop under reduced motion.

## Sidebar shell (flag off)

Offices without `canvas-shell` keep `AppSidebar` (`src/components/app-sidebar.tsx`) until the pilot ends.

- On a computer the sidebar (15.5rem, on the `sidebar` tokens) and the content sit edge to edge, split by one `line`. The top row is the mark in a 3.75rem square and the office. Rows are 40px, and the active row takes `sidebar-accent` and medium weight. The footer holds Sair, Feedback, Notificações, Instalar and `ThemeSwitch`. Ctrl B collapses the menu to 3.75rem, and `src/lib/nav-collapse.ts` restores the width before the first paint.
- On a phone a sticky header shows the mark, module and office. A 64px tab bar (`mobileTabs` in `src/lib/navigation.ts`) holds four sections and "Mais", and slides away while the page scrolls down. Content clears it with `pb-dock`.
- The Lume is the page `/app/agents`: a conversation list beside the chat, and documents in a resizable split (`?doc=`).

When the pilot ends, these go with the sidebar: `AppSidebar`, the `sidebar-*` tokens, `--tabbar-h`, `--shell-header`, `pb-dock`, the `.app-shell` and `.agent-chat` rules in `globals.css`, and `AgentChat`'s `page` mode.
