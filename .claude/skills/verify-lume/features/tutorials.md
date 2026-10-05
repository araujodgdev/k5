# Tutorial library

The tutorial opens a library of short videos grouped by module, with independent playback, Portuguese captions and downloads.

## Sub-features

- Guided tour entry point and video library entry point.
- Module filters and return to the selected module from a video.
- Keyboard navigation, desktop and 390px mobile layout.
- Published video, captions and cover for each tutorial.
- Empty module, missing video and playback error with retry and download.

## How to get to it (user POV)

Open Tutorial in the menu, choose Ver vídeos por módulo, select a module and open a video.

## Driving it with e2e

Test: `apps/web/e2e/onboarding.e2e.ts`

Preconditions: the verification instance is ready. No workers or external keys are required.

## Gotchas

Administration tutorials only appear for platform administrators. The default account is an office user.
The playback error test deliberately blocks the media request to exercise the recovery controls.
Use FFmpeg to verify decoding independently of the browser's H.264 support.
