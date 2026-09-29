import { z } from 'zod';

export const chapterSchema = z.object({
  id: z.string(), title: z.string(), file: z.string(),
  cues: z.array(z.object({ title: z.string(), text: z.string(), start: z.number().nonnegative(), end: z.number().positive() }).refine(cue => cue.end > cue.start, 'O trecho precisa ter duração positiva.')),
});
export type TutorialClip = { file: string; title: string; text: string; start: number; sourceDuration: number; frames: number; audio: string; audioDuration: number };
export type TutorialProps = { clips: TutorialClip[]; overlayOnly?: boolean };
