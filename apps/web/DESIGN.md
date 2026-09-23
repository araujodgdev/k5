# Lume design system

The interface steps back so the office's work stays in front. It should feel quiet, precise, and a little editorial: warm neutrals, black ink, one serif voice for titles, and one earthy orange that marks where you are and what the Lume did.

The UI is built on [shadcn/ui](https://ui.shadcn.com) (Radix, `radix-nova` preset) with Tailwind v4. Primitives live in `src/components/ui/` and are ours to edit. The Lume palette is set on the shadcn tokens in `src/app/globals.css`, so every primitive inherits it. Style with Tailwind utilities, and don't hardcode hex values.

## Principles

1. **Ink first, color with a meaning.** Hierarchy comes from weight, size, and the ink ramp (`foreground`, `muted-foreground`, `subtle-foreground`). `primary` is black, so buttons stay ink. Color only ever answers a question: `brand` (earthy orange) says *here* (the active place, focus, the selected row) and marks what the Lume did; each module has one hue on its icon and on 2px markers, so a mixed list shows where each item comes from. Surfaces remain neutral.
2. **One surface per idea.** The app is canvas (sidebar), and the content sits on a single white surface. Don't put cards inside cards or panels inside panels. Group things with spacing and a hairline border.
3. **Say it once.** A page gets one title. Leave out subtitles, eyebrow labels, and descriptions that repeat the title.
4. **Real states, plain words.** Empty, loading, and error states are short sentences in Portuguese, set in text color. Don't use illustrations or colored alert boxes.

## Banned patterns

- Badges, pills, and chips used to decorate or show status. Show status as plain text.
- Pastel or tinted background fills, including light red error boxes and light blue selected states. The single exception is `brand-soft` on the active navigation row and the selected conversation.
- Bullet-point lists in the UI. Use a table, rows, or a sentence instead.
- Containers inside containers, meaning a bordered card inside a bordered panel.
- Excess subtitles and helper text under every heading.
- Gradients, glows, emoji, and decorative icons next to headings. The sign-in light panel is the one gradient, and the one continuous motion, in the product.

## Tokens

Set in `:root` in `globals.css`. Use them through Tailwind classes such as `bg-canvas`, `text-muted-foreground`, and `border`.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#ffffff` | Main content |
| `canvas` | `#fafaf9` | Sidebar and auth background |
| `foreground` | `#1b1b1a` | Text, primary button |
| `brand` | `#d97757` / dark `#e08a6b` | Focus ring (`ring`), active nav pill marker, the Lume's own marks (thinking dot, confirmation rule), progress |
| `brand-ink` | `#b0502f` / dark `#eba184` | Brand-colored text and links (5.2:1 on white) |
| `brand-soft` | `brand` at 11% over the surface | Active nav row and selected conversation only |
| `module-lume` / `module-vault` / `module-agenda` / `module-research` | `#d97757` / `#4f6d8f` / `#b08a2e` / `#5f7f5a` (lighter in dark) | Module icons in nav and tab bar; 2px rules and dots that tag an item with its module. Never a fill, never text |
| `muted-foreground` | `#5f5f5b` | Secondary text, inactive nav |
| `subtle-foreground` | `#696965` / dark `#a0a098` | Placeholders, empty states, inactive tabs; readable on selected surfaces |
| `muted` / `secondary` | `#f3f3f1` | Quiet fills |
| `accent` | `#ebebe8` | Hover and selected fills |
| `schedule` | `#8a6a1c` / dark `#d6b25a` | Agenda text: meeting times, overdue dates (the agenda ochre, dark enough for text) |
| `border` / `input` | `#e8e8e5` / `#d4d4d0` | Dividers / control borders |
| `destructive` | `#b3261e` | Error text only |
| `--radius` | `0.75rem` | Base radius; `rounded-md` for nav and controls, `rounded-2xl` for the content surface, composer, and sheet |
| `--tabbar-h` | `64px` | Mobile tab bar; use the `pb-dock` utility to clear it |
| `--shadow-float` | | Only for elements floating above content: composer, sheet, menus |

Controls are 44px tall on touch (`size="lg"`), and shadcn's default 36px on desktop.

## Dark theme and installation

Dark is the default theme. The switch is a single icon that flips between light and dark (it shows the theme a click leads to); there is no "Sistema" option in the interface.

The `.dark` overrides in `globals.css` use the same warm neutral ramp: canvas
`#171715`, content `#20201e`, text `#f3f3ef`, secondary text `#b5b5ad`, and borders
`#393935`. Primary controls invert to light ink. Continue using semantic tokens;
do not add per-component color overrides. Dialogs and sheets inherit these tokens.

`ThemeSwitch` offers Sistema, Claro, and Escuro with a native keyboard-accessible
select. It lives in the sidebar footer, mobile Mais sheet, auth header, and platform
header. The Mais sheet initially focuses its title, avoiding automatic activation of the native selector on iOS. The preference follows the system by default and persists per browser.
`InstallApp` shares the same quiet controls. Installation help is a dialog; offline
and pending-update notices use a single floating surface and plain pt-BR text.

## Type

- **Sans**: Inter, everywhere. 14px body, 13px meta, 12px field errors. Weights 400 and 500.
- **Serif**: Newsreader, through the `display` utility. Page titles (28px) and the auth heading (36px) only, at weight 400.
- Don't use all-caps labels or letter-spaced eyebrows.

## Logo

`<Logo height={n} />` in `src/components/logo.tsx` is the Lume wordmark: the geometric symbol beside a Newsreader nameplate. `<LumeMark />` in `src/components/lume-mark.tsx` is the symbol by itself, built from an open L and a diagonal beam of light. Both inherit `currentColor`. Use the full wordmark in the shell, auth and platform headers; use the symbol for the Lume module and compact surfaces. `public/lume.svg` is the standalone vector, while `src/app/icon.svg` provides the dark rounded app icon used to generate the favicon and PWA assets. Keep the symbol paths in sync. Don't put the logo inside page content.

## Components

Prefer a shadcn primitive over new markup. Add one with `pnpm dlx shadcn@latest add <name>`.

- `Button` (`variant="default"` is black; `outline`, `ghost`, `size="icon"`). One primary action per view.
- `Input`, `Label`, `Textarea` in a `grid gap-1.5` field, with the error as a `text-destructive text-xs` line below. Form-level errors are an inline `CircleAlert` plus red text, never a filled box.
- `Sheet` (`side="bottom"`) is the mobile "Mais" panel. `Separator` divides groups inside it.
- `Sidebar` primitives build the desktop nav, with `collapsible="none"` inside a `hidden md:block` provider. A GSAP-driven pill (`bg-brand-soft`) slides to the active row, so `data-[active=true]` keeps a transparent background. Platform administrators get an "Administração" row (ShieldCheck) under Feedback, like any other section. The footer is one row: Sair, then Instalar and the theme toggle as 36px icon buttons with labels for screen readers. The menu collapses to icons (3.75rem) with Ctrl/⌘+B only, with no button on screen; labels become tooltips and the unread count becomes a brand dot. The choice lives in `localStorage` and is restored in the document head (`src/lib/nav-collapse.ts`), so the first paint already has the right width. The Lume conversation list uses the same `PanelLeft` control, left of the page title.
- **App shell** (`src/app/app/layout.tsx`): sidebar plus a rounded content surface on desktop; on mobile a sticky header, full-bleed content with `pb-dock`, and a fixed tab bar.
- **Mobile tab bar**: 4 sections plus "Mais". The active tab is a black icon tile. The list is `mobileTabs` in `src/lib/navigation.ts`. It slides away while the page scrolls down and returns on the way up, so reading gets the full height.
- **Bottom sheets** float: inset 8px from the side edges, above the tab bar, rounded and bordered. That geometry is plain CSS in `globals.css` (`[data-slot="sheet-content"][data-side="bottom"]`), unlayered so it beats the utility classes, with a static `bottom` fallback before the `env()` one.
- **Overlays dim, they don't blur.** `backdrop-filter` breaks stacking in some Safari versions, which can hide the panel behind the blur layer. A flat `bg-overlay/40` is also cheaper on a phone and stays dark in both themes.
- **Agent chat** (`/app/agents`, `src/components/agent-chat.tsx`): an empty conversation area with the composer docked at the bottom. The container is `flex-1` inside the flex column shell — never `h-full`, which has no definite height to resolve against and pushes the composer to the top. The shell has a definite `100dvh` height on this route; only the thread viewport scrolls. The composer is `sticky bottom-0`, `max-w-3xl`, rounded-2xl with `--shadow-float`. After scrolling more than 240px from the end, a minimal arrow returns to the latest content and the input compacts without hiding controls or its draft. Respect reduced motion. The Lume module uses the shared `<LumeMark />` symbol in navigation, readable at 16px and 18px. Don't add a second logo, shortcut tiles, or navigation to the chat content. The command center is not a chat.
- **Composer controls** live inside the composer, on a row under the input: attach and microphone. The page header keeps only the conversation actions. The model is chosen by the platform administrator for the office and is never shown in the chat. A control the configured model cannot support stays visible and disabled, with a plain tooltip explaining the limitation.
- **Chat attachments** stay in the message, independently from the Cofre. The attach menu offers camera capture, an existing image, or a document. Show removable previews above the composer before sending and persistent previews in the user message afterward. Request camera access only after "Tirar foto", allow retaking before attaching, and stop the camera when the dialog closes. "Fontes" selects material already stored in the Cofre and case references; uploading in chat never adds a source automatically.
- **Documents open beside the chat** (`src/components/document/`). A document the Lume creates or changes in the turn opens by itself; "Abrir" on a tool line opens one. On `lg` the conversation keeps 42% (at least 24rem) and the conversation list steps aside; below `lg` the document covers the screen with a back arrow. The open document is `?doc=<id>` in the URL, so a reload keeps it and the browser's back closes it; Esc closes it too. One header row (title as an input, save state as text, Versões, Exportar DOCX as the primary action, close), then three tabs marked by a 2px `brand` rule: Editar (rich text in the Word template's font, size, alignment, spacing and text width), Página (the exported DOCX drawn as pages on the `muted` canvas, read-only) and Revisão (issues, evidence check, sources). Saving is automatic after a pause; a version enters the history on explicit save, on leaving, and at most every five minutes while typing. When the Lume changes a document the person is editing, a line with a 2px `brand` rule offers "Ver versão do Lume" or "Manter a minha". `/app/documents/[id]` is the same workspace as a full page. Beside the chat, selecting text shows one floating action, "Pedir ao Lume" with the Lume mark; it becomes a single input ("O que mudar neste trecho?") and sends the request into the conversation, quoting the excerpt. A brand-ruled line in the panel says the request was sent until the Lume's edit arrives. While a document is open, the chat tells the Lume which one, so "o documento" and "o segundo parágrafo" need no name.
- **The Lume acts, then says what it did.** Each tool call is a quiet line above the answer with a check in `brand-ink` and an "Abrir" link to what it created or changed. It asks before only three things: deleting, reaching a court, and overwriting a draft. Those appear under the answer as a sentence with a 2px `brand` rule on the left and two buttons, Confirmar (ink) and Cancelar (ghost); the decision replaces the buttons with plain text. No chips, no modal.
- **Sign-in** (`src/components/auth-form.tsx`): two columns on desktop, the form left-aligned on the left and the Lume light (`src/components/lume-light.tsx`) in a 28px-radius panel on the right; on mobile the light is a 144px strip above the form. The light is a WebGL shader in the Lume palette that drifts slowly, leans toward the pointer, gathers while the password field has focus, flares on submit and cools on an error. Reduced motion renders one still frame; without WebGL a static CSS version of the same palette shows. The panel carries no text.
- **Case law from the web** is a list under the answer, built from the `k5_research_web_jurisprudence` result and never from the model's prose: title as an external link, then court · number · date · site and Jev's relevance in `brand-ink`, the summary clamped to three lines, and a note to check the full text before citing. Only links the web search itself returned are shown.
- **Answers are Markdown** (`src/components/markdown.tsx`), rendered from tokens into React elements, never into HTML. Headings, lists, tables and code inside an answer are content and are exempt from the list ban above, which is about UI chrome.
- **Cofre** (`/app/vault`): a drive. The home lists the library and the cases; a case has its own page with breadcrumbs, its subfolders, and its files. Cards and list are two views of the same level, toggled in the header — the card is the item itself, not a container wrapped around one. Client data sits behind a disclosure labelled "Dados do cliente (opcional)" and is never required to file a document. The case's **Anexos** tab is a two-step form: choose the scanned PDF and the petition, then review a list of rows (include, name, first and last page, move up/down) with the resulting PJe file name as plain text under each name; one primary action generates the files into a new folder.

## Motion (GSAP)

Motion is quiet and explains what changed. Everything goes through `gsap.matchMedia` or a `prefers-reduced-motion` check, so reduced-motion users get instant changes. Radix components animate through `tw-animate-css` instead, and that's fine.

- **Entrance**: wrap a page in `<Reveal>` and mark children with `data-reveal`. They fade and lift 14px in order (0.7s, `power3.out`, 60ms stagger). Use it once per page load, and never on scroll-heavy lists.
- **Selection**: the sidebar pill slides (0.45s `power3.out`), and the active tab icon settles from 0.82 scale (`back.out`).
- **Chrome that gets out of the way**: the tab bar moves off screen in 0.3s (`power2.out`) after 6px of downward scroll past 48px, and returns the moment scrolling reverses.
- **Micro**: hover and press are Tailwind transitions of 150–200ms. Don't use GSAP for these.
- Don't use looping animations, parallax, or motion on text while someone is reading. The sign-in light is the only exception: it is decorative, `aria-hidden`, paused when hidden or off screen, and still under reduced motion.

## Mobile

- The viewport is `viewport-fit=cover` with `interactive-widget=resizes-content` (set in `src/app/layout.tsx`), so the keyboard resizes the layout and the docked composer stays visible.
- The mobile header already names the module next to the logo, so a module's own page title (Início, Lume, Cofre, Pesquisa, Agenda, Notificações, Feedback) is `max-md:sr-only`: still the page's `h1`, not shown twice. Titles that name a record (a case, a client, a judgment) stay visible.
- Respect the safe areas: `env(safe-area-inset-top)` in the header and `env(safe-area-inset-bottom)` in the tab bar and sheet.
- Use `dvh`, not `vh`.

## Future patterns

- **Lists and tables**: full-width rows separated by a hairline, a 13px `muted-foreground` header row, and no zebra striping. Show a file or category with a small icon and text, not a pill.
- **Menus and popovers**: `popover` background, 1px border, `rounded-md`, and `--shadow-float`.

## Workspace overview and clients

- **In?cio** shows real tasks due through today, upcoming meetings, active clients, cases and personal conversations. Use separated rows, allow task completion inline, and link creation actions to the existing editors. Each section has its own empty/error state; reviewers receive read-only actions.
- **Calendar** pins count all matching activities in the visible month, including paginated results. Tasks use civil dates; meetings mark every overlapping local day, excluding their ending midnight. Pin counts are included in accessible labels.
- **Client details** live at `/app/agenda/clients/[id]`, with contact, address, notes, linked cases and paginated activities. Practice areas appear as plain text next to the relationship ("Cliente ativo · Cível, Trabalhista"), never as chips. A dialog is used only to edit data. The Agenda navigation stays active on nested client routes.
- **Feedback** (`/app/feedback`): one textarea, an optional screenshot (picked or pasted) and one primary action; the person's own reports follow as rows with plain-text status and the team's answer. The platform queue (`/platform/feedback`) is a filtered list of rows ordered by priority; triage signals (security, personal data, low confidence) are plain text, and the model's suggestion is shown with its confidence next to the editable fields.
