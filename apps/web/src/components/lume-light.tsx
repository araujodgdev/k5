"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

export type LumeLightMood = "idle" | "focus" | "submit" | "error";

/*
 * Liquid light for the sign-in panel: softly warped noise in the Lume palette (cream, amber, the
 * brand orange and one ink-blue fold), blurred, under film grain. It drifts slowly, leans toward the
 * pointer, gathers while the password is typed, flares on submit and cools briefly on an error.
 * This is the one place DESIGN.md allows a gradient and continuous motion.
 */
const fragment = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_energy;
uniform float u_cool;
uniform float u_dark;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float value = 0.0; float amplitude = 0.55;
  for (int i = 0; i < 3; i++) { value += amplitude * snoise(p); p *= 1.9; amplitude *= 0.45; }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.035;
  vec2 pull = (u_pointer - uv) * 0.25;
  float gather = 1.0 - 0.3 * u_energy;

  // Two gentle warps of low-frequency noise: large, slow folds of light rather than marble.
  vec2 q = vec2(snoise(p * 0.55 * gather + vec2(0.0, t)), snoise(p * 0.55 * gather + vec2(5.2, -t * 0.8)));
  vec2 r = vec2(snoise(p * 0.6 + 0.45 * q + vec2(1.7, 9.2) + t * 0.6 + pull),
                snoise(p * 0.6 + 0.45 * q + vec2(8.3, 2.8) - t * 0.5 + pull));
  float f = fbm(p * 0.5 + 0.4 * r);
  float n = clamp(f * 0.7 + 0.5, 0.0, 1.0);

  vec3 cream = vec3(0.965, 0.937, 0.902);
  vec3 amber = vec3(0.949, 0.749, 0.478);
  vec3 orange = vec3(0.851, 0.467, 0.341);
  vec3 ink = vec3(0.184, 0.310, 0.560);

  vec3 color = mix(cream, amber, smoothstep(0.30, 0.85, n));
  color = mix(color, orange, smoothstep(0.55, 1.05, n + 0.15 * u_energy) * 0.85);
  // A single blue fold, like a vein of cold light through the warm field.
  float vein = smoothstep(0.42, 0.0, abs(r.x - 0.2 * r.y + 0.1 - 0.25 * u_cool));
  color = mix(color, ink, vein * vein * (0.85 + 0.15 * u_cool) * smoothstep(-0.8, 0.5, q.y));
  color += u_energy * 0.08 * vec3(1.0, 0.8, 0.6) * smoothstep(0.5, 1.0, n);

  vec3 night = vec3(0.110, 0.102, 0.094);
  color = mix(color, mix(night, color * 0.9, 0.18 + 0.62 * smoothstep(0.35, 1.0, n) + 0.5 * vein * vein), u_dark);

  gl_FragColor = vec4(color, 1.0);
}`;

const vertex = `attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

export function LumeLight({ mood = "idle", className }: { mood?: LumeLightMood; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uniforms = useRef({ energy: 0, cool: 0, pointerX: 0.5, pointerY: 0.5, targetX: 0.5, targetY: 0.5 });
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "low-power" });
    const vs = gl && compile(gl, gl.VERTEX_SHADER, vertex);
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, fragment);
    const program = gl && vs && fs ? gl.createProgram() : null;
    if (!gl || !program || !vs || !fs) { queueMicrotask(() => setFallback(true)); return; }
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { queueMicrotask(() => setFallback(true)); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const at = (name: string) => gl.getUniformLocation(program, name);
    const u = { res: at("u_res"), time: at("u_time"), pointer: at("u_pointer"), energy: at("u_energy"), cool: at("u_cool"), dark: at("u_dark") };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = () => document.documentElement.classList.contains("dark") ? 1 : 0;
    // The field is soft by design, so it renders at half resolution and the browser scales it up.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    };
    const start = performance.now() - 14_000;
    const draw = (now: number) => {
      const state = uniforms.current;
      state.pointerX += (state.targetX - state.pointerX) * 0.04;
      state.pointerY += (state.targetY - state.pointerY) * 0.04;
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, reduced.matches ? 14 : (now - start) / 1000);
      gl.uniform2f(u.pointer, state.pointerX, state.pointerY);
      gl.uniform1f(u.energy, state.energy);
      gl.uniform1f(u.cool, state.cool);
      gl.uniform1f(u.dark, dark());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    let visible = true;
    const loop = (now: number) => { draw(now); frame = requestAnimationFrame(loop); };
    const run = () => {
      cancelAnimationFrame(frame);
      resize();
      if (reduced.matches) { draw(performance.now()); return; }
      if (visible && document.visibilityState === "visible") frame = requestAnimationFrame(loop);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; run(); });
    observer.observe(canvas);
    const resizeObserver = new ResizeObserver(run);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => { if (reduced.matches) draw(performance.now()); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const onPointer = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      uniforms.current.targetX = Math.min(1.2, Math.max(-0.2, (event.clientX - box.left) / box.width));
      uniforms.current.targetY = Math.min(1.2, Math.max(-0.2, 1 - (event.clientY - box.top) / box.height));
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", run);
    reduced.addEventListener("change", run);
    run();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect(); resizeObserver.disconnect(); themeObserver.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", run);
      reduced.removeEventListener("change", run);
      // No loseContext(): the canvas keeps one context for its life, and a remount reuses it.
      gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buffer);
    };
  }, []);

  useEffect(() => {
    const state = uniforms.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.killTweensOf(state);
    if (mood === "focus") gsap.to(state, { energy: 0.55, cool: 0, duration: 1.2, ease: "power2.out" });
    else if (mood === "submit") gsap.to(state, { energy: 1, cool: 0, duration: 0.6, ease: "power3.out" });
    else if (mood === "error") gsap.timeline().to(state, { cool: 1, energy: 0, duration: 0.35, ease: "power2.out" }).to(state, { cool: 0, duration: 1.4, ease: "power2.inOut" });
    else gsap.to(state, { energy: 0, cool: 0, duration: 1.4, ease: "power2.inOut" });
  }, [mood]);

  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden bg-[#f6efe6] dark:bg-[#1c1a18]", className)}>
      {fallback
        ? <div className="lume-light-fallback absolute inset-0" />
        : <canvas ref={canvasRef} className="absolute -inset-8 size-[calc(100%+4rem)] blur-xl" />}
      <div className="lume-light-grain pointer-events-none absolute inset-0" />
    </div>
  );
}
