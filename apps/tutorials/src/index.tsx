import { AbsoluteFill, Composition, Html5Audio, OffthreadVideo, Sequence, getInputProps, registerRoot, staticFile, useCurrentFrame } from 'remotion';
import type { TutorialProps } from './contracts';
const fps = 30;

function Tutorial({ clips, overlayOnly = false }: TutorialProps) {
  const frame = useCurrentFrame();
  const total = clips.reduce((sum, clip) => sum + clip.frames, 0);
  let offset = 0;
  return <AbsoluteFill style={{ background: overlayOnly ? 'transparent' : '#232323', color: '#f5f5f5', fontFamily: 'Arial, sans-serif' }}>
    {clips.map((clip, index) => {
      const from = offset;
      offset += clip.frames;
      return <Sequence key={index} from={from} durationInFrames={clip.frames}>
        <div style={{ position: 'absolute', top: 22, left: 56, right: 56, display: 'flex', justifyContent: 'space-between', fontSize: 24 }}>
          <span style={{ letterSpacing: -1, fontWeight: 700 }}>Lume <span style={{ color: '#d97757', marginLeft: 20, fontWeight: 400 }}>Guia da plataforma</span><span style={{ marginLeft: 24, fontWeight: 400, fontSize: 18, color: '#b8b8b8' }}>Narração gerada por IA</span></span>
          <span>{clip.title}</span>
        </div>
        {!overlayOnly && <OffthreadVideo muted src={staticFile(clip.file)} trimBefore={Math.round(clip.start * fps)} playbackRate={clip.sourceDuration / (clip.frames / fps)} style={{ position: 'absolute', left: 176, top: 66, width: 1568, height: 882, objectFit: 'contain' }} />}
        {!overlayOnly && <Html5Audio src={staticFile(clip.audio)} playbackRate={Math.max(1, clip.audioDuration / (clip.frames / fps - 0.3))} />}
        <div style={{ position: 'absolute', left: 120, right: 120, bottom: 20, padding: '15px 28px', background: '#232323', borderLeft: '4px solid #d97757', fontSize: 29, lineHeight: 1.25, textAlign: 'center' }}>{clip.text}</div>
      </Sequence>;
    })}
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 4, background: '#d97757', width: `${frame / Math.max(total, 1) * 100}%` }} />
  </AbsoluteFill>;
}

function Root() {
  const props = getInputProps<TutorialProps>();
  return <Composition id="LumeTutorial" component={Tutorial} durationInFrames={Math.max(1, (props.clips ?? []).reduce((sum, clip) => sum + clip.frames, 0))} fps={fps} width={1920} height={1080} defaultProps={{ clips: props.clips ?? [], overlayOnly: props.overlayOnly ?? false }} />;
}

registerRoot(Root);
