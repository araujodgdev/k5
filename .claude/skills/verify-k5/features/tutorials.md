# Tutorial library

The tutorial opens a library of short videos grouped by module, with independent playback, Portuguese captions and downloads.

## Sub-features

- Guided tour entry point and video library entry point.
- Module filters and return to the selected module from a video.
- Keyboard navigation, desktop and 390px mobile layout.
- Published video, captions and cover for each tutorial.
- Empty module, missing video and playback error with retry and download.

## How to get to it (user POV)

On desktop, "Tutorial do Lume" is in the sidebar footer; on mobile it is under "Mais". It opens the tour dialog. Choose "Ver vídeos por módulo", select a module and open a video. The library is also at `/app/tutorial`. The first visit can open "Conheça o Lume" on its own.

## Driving it with e2e

Test: `apps/web/e2e/onboarding.e2e.ts`

Preconditions: the verification instance is ready. No workers or external keys are required.

## Gotchas

Administration tutorials only appear for platform administrators. The default account is an office user.
The playback error test deliberately blocks the media request to exercise the recovery controls.
Use FFmpeg to verify decoding independently of the browser's H.264 support.
