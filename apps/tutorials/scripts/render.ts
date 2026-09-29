import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chapterSchema, type TutorialClip } from '../src/contracts';
import { narrateOpenAI, speechSettings } from './narrate-openai';

const directory = resolve('public/recordings');
const chapters = readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => chapterSchema.parse(JSON.parse(readFileSync(resolve(directory, name), 'utf8'))));
for (const chapter of chapters) {
  const source = resolve('public', chapter.file);
  const normalized = source.replace(/\.webm$/, '.mp4');
  if (!existsSync(normalized) || statSync(normalized).mtimeMs < statSync(source).mtimeMs) {
    console.log(`Preparando gravação: ${chapter.id}`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-an', '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', normalized], { stdio: 'inherit' });
  }
  chapter.file = chapter.file.replace(/\.webm$/, '.mp4');
}
const openai = process.argv.includes('--openai');
const narrationFolder = openai ? 'narration-openai' : 'narration';
const narrationDir = resolve('public', narrationFolder);
mkdirSync(narrationDir, { recursive: true });
const texts = chapters.flatMap(chapter => chapter.cues.map(cue => cue.text));
writeFileSync(resolve(narrationDir, 'texts.json'), JSON.stringify(texts));
if (openai) await narrateOpenAI(texts, narrationDir);
else execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/narrate.ps1'), '-Directory', narrationDir], { stdio: 'inherit' });
let audioIndex = 0;
const clips: TutorialClip[] = chapters.flatMap(chapter => chapter.cues.map(cue => {
  const sourceDuration = cue.end - cue.start;
  const duration = Math.max(5, Math.min(sourceDuration, Math.max(6, cue.text.split(/\s+/).length / 2.8)));
  const audio = `${narrationFolder}/${audioIndex++}.wav`;
  const audioDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', resolve('public', audio)], { encoding: 'utf8' }).trim());
  return { file: chapter.file, title: cue.title, text: cue.text, start: cue.start, sourceDuration, frames: Math.round(Math.max(duration, audioDuration + 0.4) * 30), audio, audioDuration };
}));
const requestedFrames = clips.reduce((sum, clip) => sum + clip.frames, 0);
if (requestedFrames > 294 * 30) for (const clip of clips) clip.frames = Math.floor(clip.frames * 294 * 30 / requestedFrames);
const frames = clips.reduce((sum, clip) => sum + clip.frames, 0);
if (frames < 120 * 30 || frames > 300 * 30) throw new Error(`A duração precisa ser de 2 a 5 minutos; roteiro atual: ${(frames / 30).toFixed(1)}s`);
const output = resolve(openai ? '../../output/tutorial-lume-openai' : '../../output/tutorial-lume');
mkdirSync(output, { recursive: true });
if (openai) writeFileSync(resolve(output, 'narracao.json'), JSON.stringify(speechSettings, null, 2));
writeFileSync(resolve(output, 'roteiro.json'), JSON.stringify({ clips }, null, 2));
const stamp = (seconds: number, separator: string) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
};
let time = 0;
const subtitles = clips.map((clip, index) => { const start = time; time += clip.frames / 30; return { index: index + 1, start, end: time, text: clip.text }; });
writeFileSync(resolve(output, 'tutorial-lume.pt-BR.srt'), subtitles.map(s => `${s.index}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n'));
writeFileSync(resolve(output, 'tutorial-lume.pt-BR.vtt'), `WEBVTT\n\n${subtitles.map(s => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')}`);
const inputProps = { clips };
if (process.argv.includes('--prepare')) { console.log(`Roteiro preparado: ${(frames / 30).toFixed(1)}s.`); process.exit(0); }
const serveUrl = await bundle({ entryPoint: resolve('src/index.tsx') });

const browser = await openBrowser('chrome');
const parts = resolve(output, 'parts');
mkdirSync(parts, { recursive: true });
try {
  const composition = await selectComposition({ serveUrl, id: 'LumeTutorial', inputProps: { ...inputProps, overlayOnly: true }, puppeteerInstance: browser });
  let frame = 0;
  for (const [index, clip] of clips.entries()) {
    const overlay = resolve(parts, `${index}.png`);
    await renderStill({ composition, serveUrl, inputProps: { ...inputProps, overlayOnly: true }, frame, output: overlay, imageFormat: 'png', puppeteerInstance: browser });
    frame += clip.frames;
    const duration = clip.frames / 30;
    const rate = clip.sourceDuration / duration;
    const audioRate = Math.max(1, clip.audioDuration / (duration - 0.3));
    const filters = `[0:v]setpts=(PTS-STARTPTS)/${rate},fps=30,scale=1568:882,pad=1920:1080:176:66:color=0x232323,tpad=stop_mode=clone:stop_duration=${duration}[screen];[screen][1:v]overlay=0:0:format=auto,format=yuv420p[v];[2:a]atempo=${audioRate},apad[a]`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '2', '-ss', String(clip.start), '-t', String(clip.sourceDuration), '-i', resolve('public', clip.file), '-loop', '1', '-i', overlay, '-i', resolve('public', clip.audio), '-filter_complex_threads', '1', '-filter_complex', filters, '-map', '[v]', '-map', '[a]', '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-threads', '2', '-c:a', 'aac', '-ar', '48000', '-b:a', '160k', resolve(parts, `${index}.mp4`)], { stdio: 'inherit' });
    console.log(`Trecho ${index + 1}/${clips.length}: ${clip.title}`);
  }
} finally {
  await browser.close({ silent: true });
}
const concat = resolve(parts, 'concat.txt');
writeFileSync(concat, clips.map((_, index) => `file '${index}.mp4'`).join('\n'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', resolve(output, 'tutorial-lume.mp4')], { stdio: 'inherit' });
console.log(`Vídeo exportado para ${output}`);
