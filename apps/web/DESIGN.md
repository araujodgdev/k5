# K5 design system

The interface steps back so the office's work stays in front. It should feel quiet, precise, and a little editorial: warm neutrals, black ink, one serif voice for titles.

The UI is built on [shadcn/ui](https://ui.shadcn.com) (Radix, `radix-nova` preset) with Tailwind v4. Primitives live in `src/components/ui/` and are ours to edit. The K5 palette is set on the shadcn tokens in `src/app/globals.css`, so every primitive inherits it. Style with Tailwind utilities, and don't hardcode hex values.

## Principles

1. **Ink over color.** Hierarchy comes from weight, size, and the ink ramp (`foreground`, `muted-foreground`, `subtle-foreground`). `primary` is black. There is no brand accent color.
2. **One surface per idea.** The app is canvas (sidebar), and the content sits on a single white surface. Don't put cards inside cards or panels inside panels. Group things with spacing and a hairline border.
3. **Say it once.** A page gets one title. Leave out subtitles, eyebrow labels, and descriptions that repeat the title.
4. **Real states, plain words.** Empty, loading, and error states are short sentences in Portuguese, set in text color. Don't use illustrations or colored alert boxes.

## Banned patterns

- Badges, pills, and chips used to decorate or show status. Show status as plain text.
- Pastel or tinted background fills, including light red error boxes and light blue selected states.
- Bullet-point lists in the UI. Use a table, rows, or a sentence instead.
- Containers inside containers, meaning a bordered card inside a bordered panel.
- Excess subtitles and helper text under every heading.
- Gradients, glows, emoji, and decorative icons next to headings.

## Tokens

Set in `:root` in `globals.css`. Use them through Tailwind classes such as `bg-canvas`, `text-muted-foreground`, and `border`.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#ffffff` | Main content |
| `canvas` | `#fafaf9` | Sidebar and auth background |
| `foreground` | `#1b1b1a` | Text, primary button, focus ring |
| `muted-foreground` | `#5f5f5b` | Secondary text, inactive nav |
| `subtle-foreground` | `#93938e` | Placeholders, empty states, inactive tabs |
| `muted` / `secondary` | `#f3f3f1` | Quiet fills |
| `accent` | `#ebebe8` | Hover and selected fills |
| `border` / `input` | `#e8e8e5` / `#d4d4d0` | Dividers / control borders |
| `destructive` | `#b3261e` | Error text only |
| `--radius` | `0.75rem` | Base radius; `rounded-md` for nav and controls, `rounded-2xl` for the content surface, composer, and sheet |
| `--tabbar-h` | `64px` | Mobile tab bar; use the `pb-dock` utility to clear it |
| `--shadow-float` | | Only for elements floating above content: composer, sheet, menus |

Controls are 44px tall on touch (`size="lg"`), and shadcn's default 36px on desktop.

## Type

- **Sans**: Inter, everywhere. 14px body, 13px meta, 12px field errors. Weights 400 and 500.
- **Serif**: Newsreader, through the `display` utility. Page titles (28px) and the auth heading (36px) only, at weight 400.
- Don't use all-caps labels or letter-spaced eyebrows.

## Logo

`<Logo height={n} />` in `src/components/logo.tsx` is the traced K5 mark. It inherits `currentColor`. Sizes are 16px in the sidebar, 15px in the mobile header, and 18px on auth. `src/app/icon.svg` is the favicon. Don't put the logo inside page content.

## Components

Prefer a shadcn primitive over new markup. Add one with `pnpm dlx shadcn@latest add <name>`.

- `Button` (`variant="default"` is black; `outline`, `ghost`, `size="icon"`). One primary action per view.
- `Input`, `Label`, `Textarea` in a `grid gap-1.5` field, with the error as a `text-destructive text-xs` line below. Form-level errors are an inline `CircleAlert` plus red text, never a filled box.
- `Sheet` (`side="bottom"`) is the mobile "Mais" panel. `Separator` divides groups inside it.
- `Sidebar` primitives build the desktop nav, with `collapsible="none"` inside a `hidden md:block` provider. A GSAP-driven pill (`bg-sidebar-accent`) slides to the active row, so `data-[active=true]` keeps a transparent background.
- **App shell** (`src/app/app/layout.tsx`): sidebar plus a rounded content surface on desktop; on mobile a sticky header, full-bleed content with `pb-dock`, and a fixed tab bar.
- **Mobile tab bar**: 4 sections plus "Mais". The active tab is a black icon tile. The list is `mobileTabs` in `src/lib/navigation.ts`. It slides away while the page scrolls down and returns on the way up, so reading gets the full height.
- **Bottom sheets** float: inset 8px from the side edges, above the tab bar, rounded and bordered. That geometry is plain CSS in `globals.css` (`[data-slot="sheet-content"][data-side="bottom"]`), unlayered so it beats the utility classes, with a static `bottom` fallback before the `env()` one.
- **Overlays dim, they don't blur.** `backdrop-filter` breaks stacking in some Safari versions, which can hide the panel behind the blur layer. A flat `bg-foreground/25` is also cheaper on a phone.
- **Agent chat** (`/app/agents`, `src/components/agent-chat.tsx`): an empty conversation area with the composer docked at the bottom. The container is `flex-1` inside the flex column shell — never `h-full`, which has no definite height to resolve against and pushes the composer to the top. The composer is `sticky bottom-0`, `max-w-3xl`, rounded-2xl with `--shadow-float`. Don't add a logo, shortcut tiles, or navigation to the chat content. The command center is not a chat.

## Motion (GSAP)

Motion is quiet and explains what changed. Everything goes through `gsap.matchMedia` or a `prefers-reduced-motion` check, so reduced-motion users get instant changes. Radix components animate through `tw-animate-css` instead, and that's fine.

- **Entrance**: wrap a page in `<Reveal>` and mark children with `data-reveal`. They fade and lift 14px in order (0.7s, `power3.out`, 60ms stagger). Use it once per page load, and never on scroll-heavy lists.
- **Selection**: the sidebar pill slides (0.45s `power3.out`), and the active tab icon settles from 0.82 scale (`back.out`).
- **Chrome that gets out of the way**: the tab bar moves off screen in 0.3s (`power2.out`) after 6px of downward scroll past 48px, and returns the moment scrolling reverses.
- **Micro**: hover and press are Tailwind transitions of 150–200ms. Don't use GSAP for these.
- Don't use looping animations, parallax, or motion on text while someone is reading.

## Mobile

- The viewport is `viewport-fit=cover` with `interactive-widget=resizes-content` (set in `src/app/layout.tsx`), so the keyboard resizes the layout and the docked composer stays visible.
- Respect the safe areas: `env(safe-area-inset-top)` in the header and `env(safe-area-inset-bottom)` in the tab bar and sheet.
- Use `dvh`, not `vh`.

## Future patterns

- **Lists and tables**: full-width rows separated by a hairline, a 13px `muted-foreground` header row, and no zebra striping. Show a file or category with a small icon and text, not a pill.
- **Menus and popovers**: `popover` background, 1px border, `rounded-md`, and `--shadow-float`.
