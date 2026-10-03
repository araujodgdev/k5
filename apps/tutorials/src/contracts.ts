import { z } from 'zod';

export const chapterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), title: z.string(), file: z.string().regex(/^recordings\/[a-z0-9-]+\.(webm|mp4)$/),
  cues: z.array(z.object({ title: z.string(), text: z.string(), start: z.number().nonnegative(), end: z.number().positive() }).refine(cue => cue.end > cue.start, 'O trecho precisa ter duração positiva.')).min(1),
});
export const tutorialClipSchema = z.object({ file: z.string(), title: z.string(), text: z.string(), start: z.number().nonnegative(), sourceDuration: z.number().positive(), frames: z.number().int().positive(), audio: z.string(), audioDuration: z.number().positive() });
export const tutorialPropsSchema = z.object({ clips: z.array(tutorialClipSchema).min(1) });
export type TutorialClip = z.infer<typeof tutorialClipSchema>;
export type TutorialProps = { clips: TutorialClip[]; overlayOnly?: boolean };
