"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";

const MAX_SECONDS = 10 * 60;
const BARS = 28;

/**
 * The composer's microphone. Recording feeds a live level meter; finishing sends the audio to be
 * transcribed and hands back plain text, which the composer sends as the person's message.
 */
export function useVoiceRecorder({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; context: AudioContext; discard: boolean } | null>(null);
  const callbacks = useRef({ onText, onError });
  useEffect(() => { callbacks.current = { onText, onError }; });

  const release = useCallback(() => {
    const current = session.current;
    session.current = null;
    current?.stream.getTracks().forEach((track) => track.stop());
    void current?.context.close().catch(() => undefined);
    setAnalyser(null);
  }, []);

  const finish = useCallback(() => {
    const current = session.current;
    if (current?.recorder.state === "recording") current.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.discard = true;
    if (current.recorder.state === "recording") current.recorder.stop();
    else { release(); setState("idle"); }
  }, [release]);

  const start = useCallback(async () => {
    if (session.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      callbacks.current.onError("Não foi possível acessar o microfone.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const context = new AudioContext();
    const node = context.createAnalyser();
    node.fftSize = 512;
    context.createMediaStreamSource(stream).connect(node);
    const chunks: Blob[] = [];
    const current = { recorder, stream, context, discard: false };
    session.current = current;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      release();
      if (current.discard) { setState("idle"); return; }
      const mediaType = (recorder.mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(chunks, { type: mediaType });
      if (!blob.size) { setState("idle"); callbacks.current.onError("A gravação ficou vazia. Tente de novo."); return; }
      setState("transcribing");
      try {
        const response = await fetch("/api/chat/transcribe", { method: "POST", headers: { "content-type": mediaType }, body: blob });
        const data = await response.json().catch(() => ({})) as { text?: string; error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível transcrever o áudio. Tente de novo ou escreva a mensagem.");
        const text = data.text?.trim() ?? "";
        if (!text) throw new Error("Não foi possível entender o áudio. Tente de novo, mais perto do microfone.");
        callbacks.current.onText(text);
      } catch (error) {
        callbacks.current.onError(error instanceof Error ? error.message : "Não foi possível transcrever o áudio.");
      } finally {
        setState("idle");
      }
    };
    recorder.start();
    setSeconds(0);
    setAnalyser(node);
    setState("recording");
  }, [release]);

  useEffect(() => {
    if (state !== "recording") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) finish();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state, finish]);

  // Leaving the conversation mid-recording drops the audio and frees the microphone.
  useEffect(() => () => {
    if (session.current) session.current.discard = true;
    if (session.current?.recorder.state === "recording") session.current.recorder.stop();
  }, []);

  return { state, seconds, analyser, start, finish, cancel };
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** A rolling level meter: each bar is a recent moment of the microphone's loudness. */
export function VoiceLevel({ analyser, seconds }: { analyser: AnalyserNode | null; seconds: number }) {
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = bars.current;
    if (!analyser || !container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const samples = new Uint8Array(analyser.fftSize);
    const levels = new Array<number>(BARS).fill(0);
    const nodes = [...container.children] as HTMLElement[];
    let frame = 0;
    let last = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < 70) return;
      last = time;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      // Speech sits low in RMS; the curve lifts it so a normal voice fills most of the height.
      levels.push(Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6));
      levels.shift();
      nodes.forEach((node, index) => { node.style.transform = `scaleY(${Math.max(0.12, levels[index])})`; });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-3 px-1" role="status" aria-live="polite">
      <span className="sr-only">Gravando áudio</span>
      <span ref={bars} aria-hidden="true" className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
        {Array.from({ length: BARS }, (_, index) => <span key={index} className="h-full w-[3px] shrink-0 origin-center scale-y-[0.12] rounded-full bg-brand" />)}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">{clock(seconds)}</span>
    </span>
  );
}
