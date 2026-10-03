import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { tutorialModules } from '@k5/tutorial-library';
import type { TutorialClip } from '../src/contracts';

const publicationSchema = z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), durationSeconds: z.number().positive(), revision: z.string() }));

export function selectedVideos() {
  const videos = tutorialModules.flatMap(module => module.videos);
  const ids = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
  if (ids) for (const id of ids) if (!videos.some(video => video.id === id)) throw new Error(`Tutorial desconhecido: ${id}`);
  return videos.filter(video => !ids || ids.includes(video.id));
}

export function writeSubtitles(output: string, clips: TutorialClip[]) {
  const stamp = (seconds: number, separator: string) => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
  };
  let time = 0;
  const subtitles = clips.map((clip, index) => { const start = time; time += clip.frames / 30; return { index: index + 1, start, end: time, text: clip.text }; });
  writeFileSync(resolve(output, 'legendas.pt-BR.srt'), subtitles.map(s => `${s.index}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n'));
  writeFileSync(resolve(output, 'legendas.pt-BR.vtt'), `WEBVTT\n\n${subtitles.map(s => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')}`);
  writeFileSync(resolve(output, 'roteiro.json'), JSON.stringify({ clips }, null, 2));
}

export function concatenate(output: string, files: string[]) {
  const concat = resolve(output, 'concat.txt');
  writeFileSync(concat, files.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', resolve(output, 'video.mp4')], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', resolve(output, 'video.mp4'), '-frames:v', '1', '-update', '1', resolve(output, 'capa.jpg')], { stdio: 'inherit' });
}

export function publishVideo(id: string, output: string) {
  const videoFile = resolve(output, 'video.mp4');
  const durationSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoFile], { encoding: 'utf8' }).trim());
  const revision = createHash('sha256').update(readFileSync(videoFile)).update(readFileSync(resolve(output, 'legendas.pt-BR.vtt'))).update(readFileSync(resolve(output, 'capa.jpg'))).digest('hex').slice(0, 12);
  const root = resolve('../web/public/tutorial');
  const manifest = resolve(root, 'library.json');
  const published = existsSync(manifest) ? publicationSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))) : [];
  const entry = publicationSchema.element.parse({ id, durationSeconds, revision });
  const destination = resolve(root, 'videos', id);
  mkdirSync(destination, { recursive: true });
  for (const file of ['video.mp4', 'capa.jpg', 'legendas.pt-BR.vtt']) copyFileSync(resolve(output, file), resolve(destination, file));
  const next = [...published.filter(item => item.id !== id), entry].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(`${manifest}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(`${manifest}.tmp`, manifest);
  console.log(`Tutorial publicado: ${id} (${durationSeconds.toFixed(1)}s)`);
}
