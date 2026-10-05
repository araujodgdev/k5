# Public site

The signed-out site at `/` presents Lume to visitors and crawlers: server-rendered HTML with an `h1`, canonical links and `index, follow` on the public pages, `noindex` on sign-in and sign-up, a sitemap with only the public pages, and a home page that works by keyboard and in both themes on phone and desktop. `/app` redirects visitors to `/sign-in`.

## Sub-features

- `site-seo`: `/`, `/termos-de-uso`, `/politica-privacidade` return 200 with `index, follow` and a canonical on `https://lume.software`; `/sign-in` and `/sign-up` carry `noindex`.
- `site-structured-data`: the home has `WebSite` JSON-LD named "Lume", `og:url`, and a description mentioning documentos, IA and honorários.
- `site-robots-sitemap`: `/robots.txt` names the sitemap; `/sitemap.xml` lists exactly the three public pages.
- `site-private-redirect`: `/app` answers a 3xx to `/sign-in`; an unknown path answers 404.
- `site-keyboard`: the first Tab focuses "Ir para o conteúdo", Enter jumps to `#conteudo`.
- `site-themes`: "Usar tema claro" / "Usar tema escuro" keep every section visible without horizontal scroll, at 390px and 1440px.
- `site-enter`: "Entrar" opens the sign-in form.

## How to get to it (user POV)

- Open the instance's `baseURL` signed out; the header has "Entrar" and the theme toggle; the footer links Termos de uso and Política de privacidade.

## Driving it with e2e

Test: `apps/web/e2e/public-site.e2e.ts`

Preconditions:

- `doctor` all OK. No session: these tests run signed out.

- **Crawler view.** Plain `fetch` with `Mozilla/5.0` and `Googlebot` user agents (no JavaScript, as a crawler sees it); asserts status, `h1`, robots meta, `x-robots-tag` and canonical per path.
- **Robots and sitemap.** Fetch `/robots.txt` and `/sitemap.xml` and compare the `<loc>` list.
- **Keyboard and themes.** For 390×844 and 1440×900: `app.open('/')`, `heading` level 1 has text "Lume"; Tab focuses `link "Ir para o conteúdo"`; Enter sets the hash to `#conteudo`; tap each theme button and scroll `#hero-title`, `#modulos-title`, `#escritorio-title`, `#comecar-title` into view with no horizontal scroll; tap `link "Entrar"` and `button "Entrar"` is visible.
- **Proof.** `drive public-site` lists three passing tests (SEO plus one per viewport).

## Gotchas

- The canonical host is the production `https://lume.software`, not the instance's `baseURL`; that is expected.
- The SEO test is HTTP-only on purpose; use the viewport tests (or a trace) for visual proof.
