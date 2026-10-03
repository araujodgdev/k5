import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TutorialVideo } from '@k5/tutorial-library';
import { chapterSchema, tutorialPropsSchema, type TutorialClip } from '../src/contracts';
import { narrateOpenAI, speechSettings } from './narrate-openai';
import { concatenate, publishVideo, selectedVideos, writeSubtitles } from './library';

const openai = process.argv.includes('--openai');
const publish = process.argv.includes('--publish');
const prepare = process.argv.includes('--prepare');
const fromExisting = process.argv.includes('--from-existing');
if (prepare && publish) throw new Error('Prepare o roteiro sem --publish, ou renderize antes de publicar.');
if (prepare && fromExisting) throw new Error('--from-existing reutiliza os trechos concluídos e não aceita --prepare.');
const videos = selectedVideos();

async function renderVideo(video: TutorialVideo) {
  const output = resolve('../../output/tutorial-library', video.id);
  mkdirSync(output, { recursive: true });
  if (fromExisting) {
    const previous = resolve('../../output/tutorial-lume-openai');
    const { clips } = tutorialPropsSchema.parse(JSON.parse(readFileSync(resolve(previous, 'roteiro.json'), 'utf8')));
    const selected = clips.map((clip, index) => ({ clip, index })).filter(({ clip }) => video.chapters.some(id => clip.file === `recordings/${id}.mp4`));
    if (!selected.length || video.chapters.some(id => !selected.some(({ clip }) => clip.file === `recordings/${id}.mp4`))) throw new Error(`Não há gravação completa para ${video.id}.`);
    writeSubtitles(output, selected.map(item => item.clip));
    const cache = resolve('public/narration-openai', video.id);
    mkdirSync(cache, { recursive: true });
    for (const [localIndex, { clip }] of selected.entries()) {
      const audio = resolve('public', clip.audio);
      copyFileSync(audio, resolve(cache, `${localIndex}.wav`));
      if (existsSync(audio.replace(/\.wav$/, '.sha256'))) copyFileSync(audio.replace(/\.wav$/, '.sha256'), resolve(cache, `${localIndex}.sha256`));
    }
    writeFileSync(resolve(output, 'narracao.json'), JSON.stringify(speechSettings, null, 2));
    concatenate(output, selected.map(item => resolve(previous, 'parts', `${item.index}.mp4`)));
    if (publish) publishVideo(video.id, output);
    return;
  }

  const chapters = video.chapters.map(id => {
    const chapter = chapterSchema.parse(JSON.parse(readFileSync(resolve('public/recordings', `${id}.json`), 'utf8')));
    if (chapter.id !== id) throw new Error(`Identificador incorreto na gravação ${id}.`);
    const source = resolve('public', chapter.file);
    const normalized = source.replace(/\.webm$/, '.mp4');
    if (normalized !== source && (!existsSync(normalized) || statSync(normalized).mtimeMs < statSync(source).mtimeMs)) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-an', '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', normalized], { stdio: 'inherit' });
    }
    return { ...chapter, file: chapter.file.replace(/\.webm$/, '.mp4') };
  });
  const narrationFolder = `${openai ? 'narration-openai' : 'narration'}/${video.id}`;
  const narrationDir = resolve('public', narrationFolder);
  mkdirSync(narrationDir, { recursive: true });
  const texts = chapters.flatMap(chapter => chapter.cues.map(cue => cue.text));
  writeFileSync(resolve(narrationDir, 'texts.json'), JSON.stringify(texts));
  if (openai) await narrateOpenAI(texts, narrationDir);
  else execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/narrate.ps1'), '-Directory', narrationDir], { stdio: 'inherit' });
  let audioIndex = 0;
  const clips: TutorialClip[] = chapters.flatMap(chapter => chapter.cues.map(cue => {
    const sourceDuration = cue.end - cue.start;
    const audio = `${narrationFolder}/${audioIndex++}.wav`;
    const audioDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', resolve('public', audio)], { encoding: 'utf8' }).trim());
    return { file: chapter.file, title: cue.title, text: cue.text, start: cue.start, sourceDuration, frames: Math.round(Math.max(5, audioDuration + 0.4) * 30), audio, audioDuration };
  }));
  const frames = clips.reduce((sum, clip) => sum + clip.frames, 0);
  tutorialPropsSchema.parse({ clips });
  writeSubtitles(output, clips);
  if (openai) writeFileSync(resolve(output, 'narracao.json'), JSON.stringify(speechSettings, null, 2));
  if (prepare) { console.log(`Roteiro preparado: ${video.id}, ${(frames / 30).toFixed(1)}s.`); return; }
  const serveUrl = await bundle({ entryPoint: resolve('src/index.tsx') });
  const browser = await openBrowser('chrome');
  const parts = resolve(output, 'parts');
  mkdirSync(parts, { recursive: true });
  try {
    const inputProps = { clips, overlayOnly: true };
    const composition = await selectComposition({ serveUrl, id: 'LumeTutorial', inputProps, puppeteerInstance: browser });
    let frame = 0;
    for (const [index, clip] of clips.entries()) {
      const overlay = resolve(parts, `${index}.png`);
      await renderStill({ composition, serveUrl, inputProps, frame, output: overlay, imageFormat: 'png', puppeteerInstance: browser });
      frame += clip.frames;
      const duration = clip.frames / 30;
      const rate = clip.sourceDuration / duration;
      const filters = `[0:v]setpts=(PTS-STARTPTS)/${rate},fps=30,scale=1568:882,pad=1920:1080:176:66:color=0x232323,tpad=stop_mode=clone:stop_duration=${duration}[screen];[screen][1:v]overlay=0:0:format=auto,format=yuv420p[v];[2:a]apad[a]`;
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '2', '-ss', String(clip.start), '-t', String(clip.sourceDuration), '-i', resolve('public', clip.file), '-loop', '1', '-i', overlay, '-i', resolve('public', clip.audio), '-filter_complex_threads', '1', '-filter_complex', filters, '-map', '[v]', '-map', '[a]', '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-threads', '2', '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', resolve(parts, `${index}.mp4`)], { stdio: 'inherit' });
      console.log(`${video.id}: trecho ${index + 1}/${clips.length}`);
    }
  } finally { await browser.close({ silent: true }); }
  concatenate(output, clips.map((_, index) => resolve(parts, `${index}.mp4`)));
  if (publish) publishVideo(video.id, output);
  console.log(`Vídeo exportado: ${output}`);
}

for (const video of videos) await renderVideo(video);
