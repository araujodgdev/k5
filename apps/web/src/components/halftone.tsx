"use client";

import { useEffect, useRef } from "react";
import { tisesPaths } from "@/components/tises-paths";
import { cn } from "@/lib/utils";

export type HalftoneMood = "idle" | "focus" | "submit" | "error";

type Mark = { x: number; y: number; size: number };

// Ordered dithering: a 4×4 Bayer matrix turns a smooth value into a pattern of square pixels.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + .5) / 16);

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Reads a CSS color as a little-endian RGBA word for an ImageData buffer. */
function colorWord(ctx: CanvasRenderingContext2D, value: string) {
  ctx.fillStyle = "#000";
  ctx.fillStyle = value || "#000";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/**
 * A dithered field of square ink pixels drifting over paper, with the Tises mark cut out: the seal as
 * a flat grey silhouette and its diamond in brand, the field's only color. It leans toward the
 * pointer; `mood` lets a form answer through it.
 * The canvas holds one pixel per dither cell and is shown at a whole number of CSS pixels per cell,
 * without smoothing, so the pixels stay square. The mark is a vector on top: drawn into the canvas
 * it would be as coarse as the cells, which grow on large screens.
 * Decorative: aria-hidden, paused off screen, one still frame under reduced motion.
 */
export function Halftone({ className, mood = "idle", mark = null, seed = 1, cell = 3, density = 0 }: {
  className?: string;
  mood?: HalftoneMood;
  /** Where the mark sits, as fractions of the field: centre x, centre y and height. */
  mark?: Mark | null;
  seed?: number;
  /** CSS pixels per dither pixel. */
  cell?: number;
  /** Shifts the field darker (positive) or lighter (negative), from -.5 to .5. */
  density?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  const flashRef = useRef(0);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (mood === "submit" && moodRef.current !== "submit") flashRef.current = 1;
    moodRef.current = mood;
    redrawRef.current();
  }, [mood]);

  const markX = mark?.x, markY = mark?.y, markSize = mark?.size;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const field = canvas.parentElement!;
    let cols = 0, rows = 0, px = 0, fieldWidth = 0, fieldHeight = 0;
    let image: ImageData | null = null;
    let words: Uint32Array | null = null;
    let mask: Uint8Array | null = null;
    let palette = { ink: 0, paper: 0 };
    let darkPaper = false;
    const pointer = { x: .5, y: .5, tx: .5, ty: .5, lean: 0, target: 0 };
    let visible = true;
    let frame = 0;
    let last = 0;
    let time = hash(seed, 7, 3) * 100;

    const readPalette = () => {
      const styles = getComputedStyle(canvas);
      palette = {
        ink: colorWord(probe, styles.getPropertyValue("--foreground").trim()),
        paper: colorWord(probe, styles.getPropertyValue("--background").trim()),
      };
      // Light pixels on a dark page read heavier than ink on paper, so dark themes draw fewer.
      const paper = palette.paper;
      darkPaper = (paper & 255) * .3 + ((paper >> 8) & 255) * .59 + ((paper >> 16) & 255) * .11 < 128;
    };

    // The cells the mark's vector covers, even partly, stay paper, so no pixel touches its edges.
    // Placed in CSS pixels like the overlay, then divided into cells.
    const buildMask = () => {
      mask = null;
      if (markX === undefined || markY === undefined || !markSize || !cols || !rows) return;
      const shape = document.createElement("canvas");
      shape.width = cols;
      shape.height = rows;
      const sctx = shape.getContext("2d", { willReadFrequently: true })!;
      const unit = markSize * fieldHeight / 24 / px;
      sctx.translate(markX * fieldWidth / px - 12 * unit, markY * fieldHeight / px - 12 * unit);
      sctx.scale(unit, unit);
      for (const d of [tisesPaths.upper, tisesPaths.lower, tisesPaths.beam]) sctx.fill(new Path2D(d));
      const covered = sctx.getImageData(0, 0, cols, rows).data;
      mask = new Uint8Array(cols * rows);
      for (let i = 0; i < mask.length; i++) mask[i] = covered[i * 4 + 3] > 0 ? 1 : 0;
    };

    const resize = () => {
      const rect = field.getBoundingClientRect();
      // Large fields grow their pixels so a frame stays near 60k cells (about 6ms). A whole number
      // of CSS pixels per cell keeps every pixel the same size.
      const size = Math.max(cell, Math.ceil(Math.sqrt((rect.width * rect.height) / 60_000)));
      const nextCols = Math.max(1, Math.ceil(rect.width / size));
      const nextRows = Math.max(1, Math.ceil(rect.height / size));
      const moved = rect.width !== fieldWidth || rect.height !== fieldHeight;
      fieldWidth = rect.width;
      fieldHeight = rect.height;
      if (nextCols === cols && nextRows === rows && size === px) { if (moved) buildMask(); return; }
      cols = nextCols;
      rows = nextRows;
      px = size;
      canvas.width = cols;
      canvas.height = rows;
      canvas.style.width = `${cols * size}px`;
      canvas.style.height = `${rows * size}px`;
      image = ctx.createImageData(cols, rows);
      words = new Uint32Array(image.data.buffer);
      buildMask();
    };

    const draw = () => {
      if (!image || !words) return;
      const current = moodRef.current;
      const contrast = current === "focus" ? 1.9 : current === "error" ? .8 : 1.25;
      const bias = density - (darkPaper ? .2 : .1) + (current === "error" ? -.12 : 0) + flashRef.current * .45;
      const scale = 3.2 / Math.max(cols, rows);
      const t = time;
      const px = pointer.x * cols, py = pointer.y * rows;
      const reach = Math.max(cols, rows) * .32;
      const lean = pointer.lean * .42;
      const { ink, paper } = palette;
      for (let y = 0; y < rows; y++) {
        const ny = y * scale;
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (mask && mask[i]) { words[i] = paper; continue; }
          const nx = x * scale;
          let n = noise(nx + t * .06, ny - t * .04, seed) * .65 + noise(nx * 2.3 - t * .09, ny * 2.3 + t * .05, seed + 1) * .35;
          n = (n - .5) * contrast + .5 + bias;
          if (lean) {
            const dx = (x - px) / reach, dy = (y - py) / reach;
            n += lean * Math.exp(-(dx * dx + dy * dy));
          }
          const threshold = BAYER[(x & 3) + ((y & 3) << 2)];
          words[i] = n > threshold ? ink : paper;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      // About 30 frames a second is plenty for a drift this slow.
      if (last && now - last < 32) { frame = requestAnimationFrame(tick); return; }
      const dt = Math.min(.1, (now - (last || now)) / 1000);
      last = now;
      const speed = moodRef.current === "error" ? .15 : moodRef.current === "focus" ? 1.8 : 1;
      time += dt * speed;
      pointer.x += (pointer.tx - pointer.x) * .08;
      pointer.y += (pointer.ty - pointer.y) * .08;
      pointer.lean += (pointer.target - pointer.lean) * .06;
      flashRef.current *= .93;
      if (flashRef.current < .01) flashRef.current = 0;
      draw();
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduced.matches) { draw(); return; }
      if (!frame) { last = 0; frame = requestAnimationFrame(tick); }
    };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    redrawRef.current = () => { if (reduced.matches) draw(); };

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      pointer.tx = x;
      pointer.ty = y;
      pointer.target = x > -.15 && x < 1.15 && y > -.15 && y < 1.15 ? 1 : 0;
    };
    const onVisibility = () => { if (document.hidden) stop(); else if (visible) start(); };
    const onMotion = () => { stop(); start(); };

    readPalette();
    resize();
    draw();

    const sizeObserver = new ResizeObserver(() => { resize(); draw(); });
    sizeObserver.observe(field);
    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    });
    viewObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => { readPalette(); draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);
    start();

    return () => {
      stop();
      redrawRef.current = () => {};
      sizeObserver.disconnect();
      viewObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
    };
  }, [cell, density, seed, markX, markY, markSize]);

  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden bg-background", className)}>
      <canvas ref={canvasRef} className="halftone-canvas absolute top-0 left-0 [image-rendering:pixelated]" />
      {mark && (
        <svg viewBox="0 0 24 24" className="absolute aspect-square -translate-1/2" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, height: `${mark.size * 100}%` }}>
          <path className="fill-panel" d={tisesPaths.upper} />
          <path className="fill-panel" d={tisesPaths.lower} />
          <path className="fill-brand" d={tisesPaths.beam} />
        </svg>
      )}
    </div>
  );
}
