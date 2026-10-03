import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tutorialModules } from '@k5/tutorial-library';
import { tutorialLibrary } from '../src/lib/tutorial-library';

test('published tutorials have independent media and subtitles starting at zero', () => {
  const modules = tutorialLibrary({ platformAdmin: true });
  const videos = modules.flatMap(module => module.videos);
  assert.equal(videos.length, tutorialModules.flatMap(module => module.videos).length);
  assert.equal(new Set(videos.map(video => video.id)).size, videos.length);
  for (const video of videos) {
    assert.ok(video.durationSeconds > 0);
    assert.match(video.revision, /^[a-f0-9]{12}$/);
    for (const path of Object.values(video.media)) assert.ok(readFileSync(resolve('public', `.${path}`)).length > 0);
    assert.match(readFileSync(resolve('public', `.${video.media.captions}`), 'utf8'), /^WEBVTT\s+00:00:00\.000 -->/);
  }
});

test('platform administration tutorials follow session access', () => {
  assert.equal(tutorialLibrary({ platformAdmin: false }).some(module => module.id === 'administracao'), false);
  assert.equal(tutorialLibrary({ platformAdmin: true }).some(module => module.id === 'administracao'), true);
});
