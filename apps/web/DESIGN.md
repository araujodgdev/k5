# Lume design system

The office is two surfaces side by side. The Lume panel floats on the left with one persistent conversation, and the canvas on the right shows the work: Início, cases, documents and modules. Everything is ink on warm paper, and the one orange belongs to the Lume.

The UI is built on [shadcn/ui](https://ui.shadcn.com) (Radix, `radix-nova` preset) with Tailwind v4. Primitives live in `src/components/ui/` and are ours to edit. The canvas page and its controls live in `src/components/canvas/`. The workspace (panel, toolbar and tabs) lives in `src/components/lume/`, with its styles in `src/app/lume-workspace.css`. Tokens are set in `src/app/globals.css`. Style with Tailwind utilities and tokens, never with hex values.

The visual reference is the prototype: `Main.dc.html` (computer), `Celular.dc.html` (phone) and `Sistema.dc.html` (the visual-system board). Code comments cite it by these names.

## Principles

1. **The Lume comes first.** The panel sits beside every view and holds the only conversation. A view never adds its own chat, a shortcut tile to the Lume or a second logo. What the Lume does shows in the conversation as the steps it took, and in the canvas as the row or block it changed.
2. **Cases are spaces.** A case is a place with its people, its sections and its items, not a folder in a drive. Each case opens in its own canvas tab, and the open resource becomes the context of the next message.
3. **Ink plus one orange.** Hierarchy comes from size, weight and the ink ramp. `brand` appears only where the Lume acts or where something needs the person. Modules have no color, and icons are strokes in the text color.
4. **Real data only.** Every name, figure and sentence on screen comes from the office's records or the Lume's work. The chat greeting uses the person's first name, the local time and the selected context. No view ships sample content, and the landing never invents numbers or clients.
5. **Quiet states.** Empty, loading and error states are one short pt-BR sentence in `muted-foreground`, with "Tentar novamente" where a retry helps. No illustrations and no colored alert boxes.

## Tokens

Set in `:root` and `.dark` in `globals.css` and used through Tailwind classes such as `bg-card`, `border-border-strong` and `text-muted-foreground`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `background` | `#FDFDFB` | `#1A1918` | The canvas and the panel on a phone |
| `pane` | `#FAFAF8` | `#1E1D1B` | The prototype's panel paper. The workspace draws its panel on `panel`, mapped to the same value |
| `card`, `popover` | `#FFFFFF` | `#222120` | Cards, KPI tiles, the composer, menus and dialogs |
| `muted`, `secondary` | `#EFEEEA` | `#2A2927` | Sunken fills: the active canvas tab, the context chip, the muted `Pill`, avatars without a photo, `kbd` |
| `foreground` | `#1C1B19` | `#E2E0DB` | Text |
| `muted-foreground` | `#6D6C6A` | `#A19F9B` | Secondary text, row icons, eyebrows, inactive tabs |
| `subtle-foreground` | `#75746F` | `#8A8884` | Placeholders and quiet notes, 4.5:1 on `background` |
| `primary` | `#1C1B19` | `#F3F1EC` | The primary button, with `primary-foreground` (`#FAFAF8`, `#161514`) |
| `accent` | ink at 4.5% | white at 5% | Hover fills |
| `selected` | ink at 7% | white at 8.5% | A pressed `Chip` and the chosen row or option |
| `border` | ink at 9% | white at 8% | Hairlines: cards, the toolbar, tab strips, table headers, dialog footers |
| `border-strong` | ink at 16% | white at 14% | A hovered card, a control that needs to stand out |
| `input` | ink at 16% | white at 14% | Control outlines |
| `line` | ink at 14% | white at 12% | Structure on the auth screens and the landing |
| `brand` | `#E08A6B` | `#E08A6B` | The Lume. See the list below |
| `brand-ink` | `#A9502F` | `#EBA184` | Brand text on paper: the accent `Pill`, relevance in case law, the mark on the collapsed Lume button |
| `brand-soft` | brand at 12% | brand at 16% | Rows the Lume prepared, the accent `Pill`, the collapsed Lume button |
| `brand-foreground` | `#1C1B19` | `#1C1B19` | Text on a brand fill |
| `ring` | `#E08A6B` | `#E08A6B` | Focus rings |
| `destructive` | `#B3261E` | `#FF9C94` | Error text and the destructive button |
| `overlay` | `#1C1B19` | `#000000` | The dim behind dialogs and sheets, at 25% (50% in dark) |
| `canvas` | `#F3F2EE` | `#0E0D0C` | The workspace ground, which the workspace maps to the `background` value |
| `panel` | `#EAE9E4` | `#2A2927` | Landing blocks and the halftone silhouettes. Inside the office it is the Lume panel |
| `--shadow-float` | `0 1px 2px` and `0 12px 32px`, ink at 5% and 9% | `0 1px 2px` and `0 16px 40px`, black at 40% and 45% | What floats: the Lume panel, menus and dialogs |
| `--ease` | `cubic-bezier(.16, 1, .3, 1)` | same | Expo out, for every transition: `ease-(--ease)` |

The office runs inside `.lume-workspace`. `lume-workspace.css` remaps some tokens there and in `.lume-menu`, so these values win inside the office:

| Token | Light | Dark |
| --- | --- | --- |
| `background`, `canvas` | `#FDFDFB` | `#1A1918` |
| `panel` | `#FAFAF8` | `#1E1D1B` |
| `foreground`, `primary` | `#1C1B19` | `#F3F1EC` |
| `card`, `popover` | `#FFFFFF` | `#222120` |
| `muted`, `secondary` | `#EFEEEA` | `#2A2927` |
| `muted-foreground`, `subtle-foreground` | `#686761` | `#AAA8A2` |
| `border`, `line` | ink at 9% | white at 9% |
| `input` | ink at 20% | white at 22% |
| `accent` | ink at 4.5% | white at 5% |
| `brand-soft` | brand at 11% over `background` | same |

`brand`, `brand-ink`, `ring` and `--shadow-float` keep the values above. `selected`, `border-strong`, `overlay` and `destructive` are not remapped.

On `Sistema.dc.html`, `background` is "Canvas", `pane` is "Painel do Lume", `card` is "Cartão", `muted` is "Afundado", `muted-foreground` is "Texto secundário" and `canvas` is "Fundo do app".

`brand` marks only these things:

- the beam of the mark while the Lume works
- the 6px urgent dot on a row
- the collapsed Lume button, in `brand-soft` with the mark in `brand-ink`
- rows the Lume prepared: `DataTable` `highlight` and Agenda suggestions
- the accent `Pill`, for a status that needs the person
- the 2px rule on the Lume's results and questions: a confirmation that waits, changed document blocks, its e-mail summaries, the "Pedido enviado" line, saved-copy notices
- the meter bars while recording audio
- focus rings

## Type

Geist (`--font-geist`) is the only face. `font-serif` and `font-heading` resolve to it. The body is `text-sm` (14px) with `letter-spacing: -0.006em`, and `h1` to `h3` take -0.02em. `text-xs` and `text-sm` set line-height 1.45, the prototype's value for every small size. Weights are 400, 500 for emphasis and 600 for titles.

| Role | Size | Where |
| --- | --- | --- |
| View title | 26px, 600, -0.02em (24px on a phone) | `CanvasHeader` |
| Section | 15px, 600 | `CanvasSection` |
| Dialog title | 17px, 600, -0.01em | `DialogTitle` |
| Interface | 14px for row titles, 13.5px in buttons, inputs and table cells | Rows, controls |
| Meta | 12.5px to 13px in `muted-foreground` | Eyebrows (13px), row details, statuses |
| Mono | Geist Mono, 12.5px (`font-mono text-[12.5px]`), never a sentence | Times, dates, deadlines, process numbers, values, counts |

Icons are lucide, drawn with a 1.5 stroke (`svg.lucide` in `globals.css`): 16px in rows and buttons, 14px in chips and on a tab's close button. Icons take the text color or `muted-foreground`.

The utilities `display`, `page-title`, `label-mono` and `square-dot` belong to the auth screens and the landing. A canvas view titles itself with `CanvasHeader`.

## Radius

| Step | Class | Use |
| --- | --- | --- |
| 6px | `rounded-sm` | Buttons, icon buttons, the context chip |
| 8px | `rounded-md` | Inputs and selects, rows, canvas tabs, filter `Chip`s, menu items |
| 10px | `rounded-[10px]` | `CanvasRow` on a phone |
| 12px | `rounded-lg` | Cards, KPI tiles, menus and popovers |
| 14px | `rounded-[14px]` | The composer |
| 16px | `rounded-xl` | The floating panel, dialogs, bottom sheets, the notification and feedback panels |
| Round | `rounded-full` | Avatars, dots, `Pill`, the collapsed Lume button |

## Office workspace

`src/app/app/(office)/layout.tsx` wraps every office route in `LumeWorkspace` (`src/components/lume/lume-workspace.tsx`). It owns one persistent private conversation, and the App Router children form the canvas. The controller in `src/lib/lume-workspace.ts` owns the panel mode, the phone surface and the tabs. The App Router owns route content and the active URL.

A skip link, "Ir para o canvas", comes first, then two regions:

- `aside` "Lume": the panel. Its header is 54px: the mark (21px), "Lume" and two icon buttons, "Ampliar conversa" and "Recolher o Lume". Under it sits `AgentChat`, or `AiDataNotice` until the person accepts the AI data notice.
- `section` "Canvas do escritório": the toolbar, then `main#main-content`, the one scrolling region. Views with scroll regions of their own (E-mails, Mensagens, WhatsApp) lock it (`.lume-canvas-content:has(…)`).

### Panel modes

Every mode keeps the conversation mounted.

- Floating is the default. From `md` the panel floats 10px from the top, bottom and left edges. It is `clamp(360px, 33.333%, 500px)` wide, on `panel`, with 16px corners, a hairline and `--shadow-float`.
- Focused gives the conversation the whole screen on `background`, in a 760px column, and hides the canvas. "Voltar ao painel flutuante", or "Abrir canvas" at the foot of the panel, returns to floating. Choosing Lume in the module menu also focuses it.
- Collapsed hides the panel. A 38px round button, "Abrir o Lume", joins the toolbar: the still mark in `brand-ink` on `brand-soft`. It does not imply a running task.

Collapsing moves focus to the canvas, and opening moves it to the panel.

### Toolbar

The toolbar ("Barra do escritório") is 56px under a hairline. In order:

1. "Abrir módulos" (`Grid2X2`). Its menu shows the office name, the modules from `appNavigation` in `src/lib/navigation.ts` with `BetaLabel` where a module is in beta, and Administração for platform administrators. Tutorial follows a hairline. Flagged modules appear only where their flag is on.
2. "Abrir o Lume", while the panel is collapsed.
3. The tabs.
4. The bell (`NotificationTrigger`), which carries the unread count.
5. The avatar (28px), "Conta de …". Its menu holds the name with "Meu perfil", Tutorial, then feedback, `InstallApp` and `ThemeSwitch` between hairlines, then "Sair".

Icon buttons are 36px with 6px corners, in `muted-foreground`, with an `accent` hover. Menus (`.lume-menu`) are `popover` with 12px corners, a hairline and `--shadow-float`. Their rows are at least 38px, with 13px text, 7px corners and an `accent` hover.

"Sair" saves open documents first. If that fails, "Sair sem salvar?" offers to discard the drafts.

### Tabs

The tabs (`nav` "Abas do canvas") hold canonical resource URLs and IDs, never copies of a mounted screen.

- A tab is 34px with 8px corners and at most 220px wide (190px on a phone): the title in 13px, truncated, and a close button ("Fechar aba …"). The active tab takes `secondary` and `foreground`, and the others are `muted-foreground`. The row scrolls sideways.
- Tabs persist per person and office in `localStorage`. A stored tab gets its title only after the server authorizes it (`/api/canvas/resource`). The workspace keeps the 20 most recent tabs.
- A view that loads an authorized resource registers it with `<CanvasResource resource />` (`workspace-context.tsx`).
- Closing the active tab opens the last remaining tab, or Início.
- A revoked resource reads "Este recurso não está mais disponível. Abra outro destino no canvas."

### Navigation

A plain click on an `/app` link goes through the workspace. A modified click, a download or another target keeps the browser's own behavior. An open document saves before the canvas leaves it. If the save fails, the canvas stays and a `destructive` line under the toolbar says why.

Navigation changes the context of the next message. Each sent message keeps a copy of its context, and regeneration uses its server-stored scope with fresh authorization. An unresolved destination disables sending.

`?conversationId=` opens that conversation in the panel, and `?lume=1` brings the panel forward. `?notificacoes=1` opens Notificações, and `?feedback=relatos` opens the person's reports. The workspace removes these parameters once it has handled them.

### Phone

Below `md` the Lume and the canvas take turns, and both stay mounted. The hidden one is inert. A fresh visit to Início (`/app/command-center` with no parameters) starts in the chat, and any other address starts in the canvas. A conversation link opens the chat unless it points at a case or a document.

- The panel fills the screen with no float, border or corners.
- The switch "Alternar conversa e canvas" sits at the bottom: 54px plus the bottom safe area, on `panel` under a hairline. "Lume" and "Canvas" are 44px buttons with `aria-pressed`, and the chosen one takes `secondary`. Each moves focus to its surface.
- Opening a place shows the canvas. Asking the Lume about a document selection shows the chat.
- Every control in the workspace is at least 44px.

## Conversation

`AgentChat` (`src/components/agent-chat.tsx`) stays mounted in the panel. Only an explicit conversation change replaces its runtime. The conversation history overlays the panel when asked for.

- Suggested prompts fill the composer only after a click. They claim nothing about work that has not loaded.
- The composer is a 14px `card` outlined in `input` at the foot of the thread. The context chip (6px corners, `secondary`, 12px `muted-foreground`) names the authorized resource and any explicit sources of the next message. A running request keeps naming its original target when the canvas changes.
- While a turn runs, the answer ends in one working line (`SmartWorking`): the mark in `working` and what the Lume is doing.
- The Lume acts, then says what it did. Observed tool calls appear as quiet rows labelled with their module above the answer. A running row updates in place when its result arrives, and only a confirmed result gets a check and "Abrir". Approval, cancellation, failure and interruption say exactly what happened. There are no invented stages, totals or personas.
- Destructive actions, external sends and draft overwrites ask first: a sentence behind a 2px `brand` rule with Confirmar and Cancelar. The decision replaces the buttons with plain text.

### Composer controls

Attach and the microphone sit on a row under the input. While recording, the microphone becomes "Descartar gravação" (a bin), a meter of `brand` bars and a timer fill the row, and send becomes a stop square that finishes the recording. The audio is transcribed ("Transcrevendo áudio…"), joined to anything typed and sent as the person's own words. Under reduced motion the meter stays still and the timer carries the state. A control the configured model cannot support stays visible and disabled, with a tooltip. The model is never shown.

### Attachments and artifacts

Attachments belong to the message, apart from the Cofre. A message takes up to six files: documents up to 25 MB, images up to 10 MB. Files that cannot attach are named in one error line. A document brings up to 300 thousand characters of text, and a Word file also brings its pictures in reading order. Removable previews sit above the composer before sending and stay in the message after. The camera starts only after "Tirar foto", allows a retake and stops when its dialog closes.

"Artefatos desta conversa" (`src/components/agent-artifacts-panel.tsx`) is a right sheet with "Documentos do Lume" and "Anexos enviados". "Salvar no Cofre" opens a form behind a 2px `brand` rule: Formato (PDF or DOCX), Destino (Biblioteca or a case) and Pasta. An error stays in the form with "Tentar de novo". "Do Cofre nesta conversa" selects stored material as context. Uploading in the chat never adds context or a Cofre copy by itself.

### Answers, citations and case law

- Answers are Markdown (`src/components/markdown.tsx`), rendered from tokens into React elements, never into HTML. Headings, lists, tables and code inside an answer are content, so the ban on lists in UI chrome does not apply.
- Citations are reviewed, not blocked (`src/lib/citations/`). Under an answer, "Citações para conferir" lists those that need the lawyer: the citation in medium weight, its status in words ("Fonte correspondente não identificada", "A fonte sustenta só em parte", "A fonte diz o contrário", "Não verificada") and the source as a link. One quiet line counts the citations that match. The document's Revisão tab shows the same rows.
- Case law from the web is a list built from the `k5_research_web_jurisprudence` result: the title as an external link, court · number · date · site, the relevance in `brand-ink`, a three-line summary and a note to check the full text before citing. Only links the search returned appear.
- "Fontes da pesquisa (N)" is a disclosure with the web sources.

## Canvas page anatomy

Views compose the primitives in `src/components/canvas/canvas-page.tsx`.

**`CanvasPage`** is one centered column: `default` for modules, `wide` for grids, boards, tables and Administração.

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

**Section tabs** share `sectionTab` and `sectionTabRow` (`src/components/section-tabs.ts`): 40px, 13.5px (14px on a phone), the active tab in medium weight over a 2px ink rule, the others in `muted-foreground`, all on one hairline. On a phone the row scrolls sideways. A case's sections use them, and so do the versions of a calculation or a proposal (`VersionTabs`, `src/components/version-tabs.tsx`).

## Dialogs and overlays

`DialogContent` (`src/components/ui/dialog.tsx`) is the one dialog:

- 540px wide from `sm`. On a computer it hangs 96px from the top with a maximum height of `100dvh - 8rem`. On a phone it is centered with 16px margins.
- 16px corners, a `border` hairline, `popover` and `--shadow-float`. Padding is 24px at the sides, 22px on top and 20px below, with 18px between its parts.
- The close button, "Fechar", is a 30px ghost 18px from the top right. `DialogTitle` is 17px semibold, and `DialogDescription` 13px `muted-foreground`.
- `DialogFooter` sits under a hairline with its actions on the right. On a phone the actions stack, primary first.

Form dialogs keep their fields in a scrolling area between the title and the footer, so Cancelar and Salvar stay in view on a phone. `AlertDialog` asks before a destructive step ("Sair sem salvar?").

Overlays dim and never blur. `backdrop-filter` breaks stacking in some Safari versions, and a flat `bg-overlay/25` (`/50` in dark) is cheaper on a phone.

- Bottom sheets float 8px from the sides and above the phone's Lume and Canvas switch, with 16px corners and a hairline. The geometry is unlayered CSS in `globals.css` (`[data-slot="sheet-content"][data-side="bottom"]`).
- Notificações and the feedback panel are dialogs. On a phone they sit at the bottom, 8px from the sides, above the switch. On a computer they open at the bottom left, 12px from the bottom edge (`.feedback-panel` and `.notification-panel` in `globals.css`).
- Menus and popovers are `popover` with 12px corners, a hairline and `--shadow-float`. Items have 8px corners and an `accent` hover.

## Views

**Início** (`/app/command-center`, `src/components/command-center.tsx`) starts with the local date and "Hoje": the person's tasks and the tasks of shared cases they can see, fee installments due through today, and unread notifications. Personal tasks complete inline. Upcoming meetings carry an explicit label for their wider horizon. "Casos recentes" uses saved descriptions and timestamps. "Atividade recente" shows recorded events from those cases and never credits a person's action to the Lume. Each source has its own loading, empty and error state.

**Casos** (`/app/vault`) is a `wide` page: "Casos", a grid or list toggle, "Buscar casos" and "Novo caso". The grid holds `CaseCard`s, 248px tall in columns of at least 260px. A card shows the name over a hairline, the client, a summary, "N arquivos · atualizado …", the people and a "•••" menu. The last card is "Biblioteca do escritório". The list view uses stacked rows.

A case (`/app/vault/cases/<id>`, `src/components/vault-case-view.tsx`) is a space:

- The header shows the case name, its description and client when they exist, and the people with access, with Compartilhar, Pedir ao Lume and a "•••" menu. Pedir ao Lume focuses the composer with the case as context, without sending or replacing the draft.
- Sections are section tabs: Tudo, Páginas, Arquivos, Tarefas, Honorários and Atividade. Mais holds Processos, Referências, Anexos and Participantes.
- Tudo combines the pages and files at the current folder level with their saved previews, type, date, version and processing state. A computer shows a grid, and a phone shows compact rows.
- "Enviar arquivos" sends one file per request, in order, and the button counts ("Enviando 2 de 5…"). A failure names its file and the rest continue. "Nova pasta" asks who sees the folder: "Todos do caso", "Só eu" or chosen people. Ancestors restrict descendants.
- Compartilhar holds access through associates, the case's Lume policy and links to the client portal. Anexos turns a scanned PDF and the petition into PJe files, starting from "Propor anexos".

**Documento** (`/app/documents/<id>`) has no `CanvasPage`. Legacy `?doc=` links redirect there. The header holds the editable title, the save state in words ("Salvando…", "Alterações não salvas", "Salvo"), Versões and Exportar (PDF or DOCX). The tabs are Editar, Página and Revisão. Editar is rich text in the Word template's font, size, alignment and spacing. Página draws the export as pages. Revisão holds the human checklist, Citações ("Conferir de novo"), Verificações and Fontes. Saving is automatic after a pause. `DocumentDraftsProvider` keeps unsaved work across routes and the phone's surface switch.

After the Lume changes the document, each changed block carries the 2px `brand` rule for 6 seconds, and the first one scrolls into view. The marks never enter the text. When the person has unsaved edits, a line with the rule offers "Ver versão do Lume" or "Manter a minha". Selecting text shows "Pedir ao Lume", which becomes one input ("O que mudar neste trecho?"). It saves the document first and sends a copy of the selection to the conversation.

**Escritório** (`/app/agenda`) opens on Tarefas, Agenda or Clientes, under section tabs that add Associados, Convites and Atividade. The eyebrow counts ("3 abertas, 1 atrasada") or names the date. The one action is "Nova tarefa", "Nova reunião" or "Novo cliente". A toolbar holds the search, filter chips (Situação, Relacionamento, Área, Caso, Cliente), "Descrever ao Lume" and the list or board switch.

- Rows are stacked. Tasks lead with their checkbox and end with the date and status in words. Meetings end with the time. Clients end with "N casos" and the city.
- Agenda puts the list beside a month card in a 264px column. Pins count every matching activity in the month, and the count is in the day's label.
- The Lume's suggestions are `brand-soft` rows with the mark, "Sugestão do Lume · …" and "precisa de você".
- Done work leaves the list. Situação starts on Abertas, and finished items are one filter away.
- A client's page (`/app/agenda/clients/<id>`) lists contact facts, "Tarefas e reuniões", "Casos no Cofre" and "Observações". Practice areas are plain text ("Cliente ativo · Cível, Trabalhista"), never chips.

**Honorários**: the eyebrow sums "A receber", "em atraso" and "recebido". Actions are "Propostas e tabelas OAB" (ghost) and "Novo honorário". Rows end with the value in mono and "vence 09/10" or "venceu", and an overdue fee is urgent. A fee's dialog shows KPIs, "Parcelas" and "Histórico de recebimentos". Propostas show Contratação, Êxito estimado and Total estimado as KPIs.

**Cálculos**: "Novo cálculo" is a grid of `CanvasCard`s and "Meus cálculos" a list. A result shows the total in mono and "Memória de cálculo" as a table.

**Pesquisa** (`/app/research`) lists past searches as stacked rows under "Nova pesquisa" (Jurisprudência or Marca). A search and a reader open under a `CanvasTrail` back to "Pesquisa", with actions such as "Atualizar estado", "Fonte oficial" and "Ver na WIPO", icon-only on a phone. A judgment shows "Ementa" and "Inteiro teor" side by side from `lg`. Trademark searches use the WIPO Global Brand Database, and no match never certifies availability. Histories are private to the person.

**Mensagens, WhatsApp and E-mails** list conversations as stacked rows, with unread as the urgent dot. A conversation opens under a trail in a 720px column. The person's messages are `muted` bubbles, and the others have none. E-mails filters folders with chips (Recebidos, Com estrela, Enviados, Rascunhos, Todos). A message's HTML renders in a sandboxed frame (`email-frame.tsx`): no scripts or forms, links in a new tab, a white page in both themes and remote images blocked until "Mostrar imagens". The mailbox's Opções inteligentes (`SmartOptions`, the mark with no text) offer summaries and replies. Nothing is sent without the person.

**Administração** (`/app/admin`) is a `wide` page for platform administrators. The eyebrow reads "Só administradores da plataforma veem esta área". Tabs: Feedback, Clientes, Financeiro, IA, Execuções, Credenciais, Auditoria. Each section is built from `admin-blocks.tsx`, filter chips, KPIs and `DataTable`s with pills in the status columns. A broken model choice is a red line with the reason, never a silent fallback. Auditoria lists the newest first, with "Mais antigos →".

The smaller views follow the same parts:

- **Plano**: the plan's end date in the eyebrow, "Pagar um mês" as the action, KPIs, "Créditos" and the payments table.
- **Perfil**: a `wide` page with a heading column from `lg`: "Sobre você", "Como os outros veem", "Acesso" and "Seus dados".
- **Tutoriais**: videos per module as rows, with the duration in mono.
- **Personalizar Lume**: the rules, the knowledge and the Word template.
- **Notificações**: the tabs "Novas" and "Arquivadas", "Arquivar todas", and rows with a title, a two-line summary and a time. Opening or archiving one moves it to Arquivadas. The bell or `?notificacoes=1` opens it.
- **Feedback**: three choices ("Algo quebrou", "Tenho uma ideia", "Não entendi algo"), one question that follows the choice, the screen it concerns and an optional screenshot. The account menu or `?feedback=relatos` opens it.

## Motion is the mark's states

Motion says what the Lume is doing. Nothing animates its way onto the page. The mark's states (`.lume-mark` in `globals.css`, drawn by `LiveLumeMark`) are the motion:

| State | Where | What moves |
| --- | --- | --- |
| `still` | Opções inteligentes at rest | Nothing |
| `working` | The chat's working line, Opções inteligentes while the Lume works on a request | The beam glows and a band flows up every 1.8s |

`LiveLumeMark` also draws `idle` (one band crosses the beam every 7s) and `attention` (the beam pulses in `brand` every 2.4s). No view uses them today.

Hovering Opções inteligentes runs one band through a still mark. Two other signals stay because they are state too: the spinner on a busy control, and the 2px rule on changed document blocks, which fades over 6 seconds. Hover and focus change color only, over Tailwind's 150ms, with `ease-(--ease)`. No fill sweeps or rises. Panel modes and the phone's surface switch change at once and keep their content mounted. Radix overlays fade through `tw-animate-css`.

Under reduced motion the global rule in `globals.css` stops every animation and transition, and `lume-workspace.css` drops transitions inside the workspace. The mark keeps its beam lit for `working` and `attention`, and spinners carry `motion-reduce:animate-none`.

## Mobile

- The viewport is `viewport-fit=cover` with `interactive-widget=resizes-content` (`src/app/layout.tsx`), so the keyboard resizes the layout and the composer stays visible.
- `md` (768px) splits phone from computer. Use `max-md:` for phone overrides.
- Use `dvh`, never `vh`. Respect the safe areas: the workspace pads the top inset, and the Lume and Canvas switch, sheets and panels clear the bottom one.
- Nothing widens the page. Grids use `minmax(0, …)` tracks, toolbars use `min-w-0`, and long names truncate.
- Tab strips and chip bars scroll sideways. They never wrap or cut a word.
- Views with their own scroll regions lock the canvas scroll (`.lume-canvas-content:has(…)` in `lume-workspace.css`).

## Accessibility

- **Focus is always visible.** Every control shows a ring or an outline in `ring` on keyboard focus: 2px on most, a 3px ring at 50% on `Button`. The Tailwind 4 trap: `outline-none` sets the outline style to none, and `focus-visible:outline-2` only sets its width, so no outline draws. Never put `outline-none` and `focus-visible:outline-*` on one element. Either use the outline alone (`focus-visible:outline-2 focus-visible:outline-ring`, as `CanvasRow`, `Chip`, `CanvasCard` and the workspace's controls do), or pair `outline-none` with `focus-visible:ring-2 focus-visible:ring-ring`.
- **Touch targets are 44px on a phone.** Add `max-md:h-11` or `max-md:size-11`. `Button` `lg` is 34px and is not a touch size.
- **Form ids come from `useId`.** Derive related ids from it (`${id}-name`). Never hardcode an id.
- **Every control has an accessible name.** Icon-only buttons take `aria-label`, with a tooltip or `title` on a computer. Icons and the mark are `aria-hidden` unless labelled. Rows whose text is not the action pass `label`. Counts belong in the label ("Notificações, 2 não lidas"). State icons carry screen-reader text.
- **Status is announced.** Loading lines use `role="status"`, and errors `role="alert"`.
- **Hidden surfaces are inert.** A collapsed panel, the canvas behind a focused panel and the phone's hidden surface take `inert` and `aria-hidden`.
- **Focus returns where it came from.** Closing a sheet, a menu or a dialog focuses its opener. Collapsing the Lume focuses the canvas, and opening it focuses the panel.
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
- Invented stages, progress or totals for the Lume's work.
- Hex values in components.

## Light by default

Light is the default for everyone. `ThemeProvider` (`src/components/theme-provider.tsx`, `defaultTheme="light"`) stores the person's choice under `k5-theme`, and the system setting never decides. Dark is the same system with other token values. Brand fills keep ink text. `theme-color` follows the theme: `#FDFDFB` in light, `#1A1918` in dark. `ThemeSwitch`, two small circles, toggles the theme in the account menu, on sign-in, the landing, the legal pages and the recovery and client layouts.

## Logo

The mark is a cube cut by a beam of light: two ink halves with an S-shaped beam between them. Its geometry lives once, in `src/components/lume-mark.tsx` (`LUME_MARK`, on a `0 0 100 100` box). `public/offline.html`, `public/lume.svg` and `src/app/icon.svg` are served without the app's code, so each keeps a copy of the halves, and `tests/lume-mark.test.ts` fails when a copy drifts.

- `<LumeMark />` is the still mark in `currentColor`, with no tile behind it.
- `<LiveLumeMark state />` (`src/components/live-lume-mark.tsx`) is the mark with its beam, in the states above. Each instance makes its own ids, so several can share a page.
- `<Logo height={n} />` pairs the mark with a Geist nameplate for compact places, never inside page content.
- `src/app/icon.svg` is the ink mark on a `#F3F2EE` tile. `scripts/generate-pwa-icons.ts` builds the PWA icons and `favicon.ico` from it. Run it after any change to the mark.
- Inside content, the mark signs the Lume's own work, such as an Agenda suggestion.

## Halftone, sign-in and landing

`<Halftone />` (`src/components/halftone.tsx`) is the product's one image: square ink pixels, ordered-dithered over slow noise, with a few brand pixels in the mid-tones and optionally the mark cut out of it. Where text sits over the field, the mark is a `panel` silhouette. Where it stands alone, it is a `brand` vector over a paper cut-out. The field leans toward the pointer, is `aria-hidden`, pauses off screen and in hidden tabs, draws one still frame under reduced motion and caps itself near 60 thousand pixels per frame. It appears on sign-in and the landing, never in the office.

Sign-in (`src/components/auth-form.tsx`) is a header row under a `line`, then two cells. The left cell has a mono label, the `display` heading and the form with a full-width ink submit. The right cell is the halftone with the mark, and on a phone it is a 144px strip. The field answers the form: it tightens while the password has focus, flashes on submit and pales on an error.

The landing (`/`, `src/app/page.tsx`) keeps the previous identity's grid of cells split by `line` rules and its `display` type until it gets its own redesign. Its scroll effects (`data-rise`, `data-fade`, `data-wipe`) and the module strip are the only motion outside the mark, and they stop under reduced motion.
