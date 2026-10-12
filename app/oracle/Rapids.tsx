"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWorld, HEIGHT, KAYAK_Y, LIVES, riverAt, startState, step, WIDTH,
  type Input, type Obstacle, type State, type Star,
} from "@/lib/rapids";

interface Props {
  /** Stars on the course: one lead each. */
  stars: number;
  onClaim: (stars: number) => void;
  /** Offered only when skipping is allowed (e.g. your own key). */
  onSkip?: () => void;
}

type Phase = "ready" | "playing" | "done";

/** The Rapids: paddle to Timnu's island and collect a star for every lead you want. */
export default function Rapids({ stars, onClaim, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<State | null>(null);
  const inputRef = useRef<Input>({ dir: 0, targetX: null });
  const keysRef = useRef({ left: false, right: false });
  const fxRef = useRef({ shake: 0, flash: 0, sparkles: [] as Sparkle[] });
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState({ stars: 0, lives: LIVES, progress: 0 });
  const [result, setResult] = useState<{ stars: number; how: "island" | "capsized" } | null>(null);
  const best = useRef(0);

  const start = useCallback(() => {
    stateRef.current = startState(createWorld(stars, (Math.random() * 2 ** 31) | 0));
    fxRef.current = { shake: 0, flash: 0, sparkles: [] };
    inputRef.current = { dir: 0, targetX: null };
    setHud({ stars: 0, lives: LIVES, progress: 0 });
    setResult(null);
    setPhase("playing");
    canvasRef.current?.focus();
  }, [stars]);

  // Draw the idle river behind the start screen.
  useEffect(() => {
    if (phase !== "ready") return;
    stateRef.current = startState(createWorld(stars, 7));
    const ctx = setupCanvas(canvasRef.current);
    if (ctx) draw(ctx, stateRef.current, fxRef.current, 0);
  }, [phase, stars]);

  // Game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    const ctx = setupCanvas(canvasRef.current);
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const loop = (now: number) => {
      const s = stateRef.current!;
      const dt = (now - last) / 1000;
      last = now;
      const k = keysRef.current;
      inputRef.current.dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      step(s, dt, inputRef.current);
      const fx = fxRef.current;
      if (s.event === "hit") {
        fx.shake = 0.35;
        fx.flash = 0.25;
      }
      if (s.event === "star") fx.sparkles.push(...burst(s.x, KAYAK_Y - 10));
      fx.shake = Math.max(0, fx.shake - dt);
      fx.flash = Math.max(0, fx.flash - dt);
      fx.sparkles = fx.sparkles.filter((p) => (p.life -= dt) > 0);
      draw(ctx, s, fx, now / 1000);
      if (now - lastHud > 100 || s.event || s.done) {
        lastHud = now;
        setHud({ stars: s.stars, lives: s.lives, progress: Math.min(1, s.d / s.world.length) });
      }
      if (s.done) {
        best.current = Math.max(best.current, s.stars);
        setResult({ stars: s.stars, how: s.done });
        setPhase("done");
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Pausing a background tab would otherwise make the next frame's dt huge (step clamps it anyway).
    const onVisibility = () => { last = performance.now(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase]);

  // Keyboard.
  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") keysRef.current.left = down;
      else if (k === "arrowright" || k === "d") keysRef.current.right = down;
      else if ((k === " " || k === "enter") && down && phase !== "playing" && document.activeElement === canvasRef.current) start();
      else return;
      if (phase === "playing" || document.activeElement === canvasRef.current) e.preventDefault();
      if (down) inputRef.current.targetX = null; // keyboard takes over from touch
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, start]);

  // Touch / mouse: drag to steer toward your finger.
  const pointerX = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * WIDTH;
  };

  return (
    <div className="rapids">
      <div className="rapids-hud" aria-live="off">
        <span aria-label={`${hud.lives} lives`}>{"♥".repeat(hud.lives)}<span className="lost">{"♥".repeat(LIVES - hud.lives)}</span></span>
        <span className="track" aria-hidden><i style={{ width: `${hud.progress * 100}%` }} /><b style={{ left: `${hud.progress * 100}%` }}>🛶</b><em>🏝️</em></span>
        <span aria-label={`${hud.stars} of ${stars} stars`}>★ {hud.stars}/{stars}</span>
      </div>
      <div className="rapids-stage">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          tabIndex={0}
          aria-label="The Rapids. Steer with the arrow keys or A and D, or drag on touch screens."
          onPointerDown={(e) => {
            if (phase !== "playing") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            inputRef.current.targetX = pointerX(e);
          }}
          onPointerMove={(e) => {
            if (phase === "playing" && e.buttons) inputRef.current.targetX = pointerX(e);
          }}
          onPointerUp={() => { inputRef.current.targetX = null; }}
          onPointerCancel={() => { inputRef.current.targetX = null; }}
        />

        {phase === "ready" && (
          <div className="rapids-overlay">
            <h2>The Rapids</h2>
            <p>Timnu pointed the way. Now paddle to her island.</p>
            <p>Collect <b>★ {stars}</b> {stars === 1 ? "star" : "stars"}: each one unlocks a lead with name, LinkedIn and verified email. Dodge rocks, logs and the banks. You have three lives.</p>
            <p className="keys-help">← → or A / D to steer · on a phone, drag your finger</p>
            <button className="btn primary" onClick={start} autoFocus>🛶 Paddle!</button>
            {onSkip && <button className="btn ghost small" onClick={onSkip}>Skip the rapids</button>}
          </div>
        )}

        {phase === "done" && result && (
          <div className="rapids-overlay">
            <h2>{result.how === "island" ? "You reached the island!" : "Capsized!"}</h2>
            <p className="stars-won" aria-label={`${result.stars} of ${stars} stars`}>
              {"★".repeat(result.stars)}<span className="lost">{"★".repeat(Math.max(0, stars - result.stars))}</span>
            </p>
            <p>
              {result.stars === 0
                ? "No stars this time. Timnu only reveals leads to those who earn them."
                : `${result.stars} ${result.stars === 1 ? "star" : "stars"}: ${result.stars} ${result.stars === 1 ? "lead" : "leads"} to unlock.`}
              {result.stars < stars && " Paddle again to try for more."}
            </p>
            <div className="rapids-actions">
              {result.stars > 0 && (
                <button className="btn primary" onClick={() => onClaim(result.stars)} autoFocus>
                  Unlock {result.stars} {result.stars === 1 ? "lead" : "leads"}
                </button>
              )}
              <button className="btn ghost" onClick={start} autoFocus={result.stars === 0}>↻ Paddle again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- rendering ---------------- */

interface Sparkle { x: number; y: number; vx: number; vy: number; life: number }
interface Fx { shake: number; flash: number; sparkles: Sparkle[] }

const burst = (x: number, y: number): Sparkle[] =>
  Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const v = 60 + Math.random() * 80;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 };
  });

function setupCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Screen y of something at distance d. */
const sy = (s: State, d: number) => KAYAK_Y - (d - s.d);

function draw(ctx: CanvasRenderingContext2D, s: State, fx: Fx, t: number) {
  ctx.save();
  if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * fx.shake * 3, (Math.random() - 0.5) * 10 * fx.shake * 3);

  // Water.
  const water = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  water.addColorStop(0, "#2a6f97");
  water.addColorStop(1, "#174f73");
  ctx.fillStyle = water;
  ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);

  // Current lines drifting down the screen.
  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const d = Math.floor(s.d / 70) * 70 + 70 * (i - 6);
    const y = sy(s, d);
    const { center, half } = riverAt(d, s.world.length);
    const x = center + Math.sin(d * 12.9898) * (half - 30);
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.quadraticCurveTo(x, y - 5, x + 12, y);
    ctx.stroke();
  }

  drawBanks(ctx, s);

  // Island at the end.
  const islandY = sy(s, s.world.length + 90);
  if (islandY > -120) drawIsland(ctx, riverAt(s.world.length, s.world.length).center, islandY, t);

  for (const o of s.world.obstacles) {
    const y = sy(s, o.d);
    if (y < -40 || y > HEIGHT + 40) continue;
    drawObstacle(ctx, o, y, t);
  }
  for (const star of s.world.stars) {
    const y = sy(s, star.d);
    if (!star.taken && y > -30 && y < HEIGHT + 30) drawStar(ctx, star, y, t);
  }

  const blink = s.invulnerable > 0 && Math.floor(t * 12) % 2 === 0;
  if (!blink) drawKayak(ctx, s.x, KAYAK_Y, s.vx, t, s.done === "capsized");

  for (const p of fx.sparkles) {
    const age = 0.6 - p.life;
    ctx.fillStyle = `rgba(255,226,168,${p.life / 0.6})`;
    ctx.beginPath();
    ctx.arc(p.x + p.vx * age, p.y + p.vy * age, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (fx.flash > 0) {
    ctx.fillStyle = `rgba(226,85,79,${fx.flash})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function drawBanks(ctx: CanvasRenderingContext2D, s: State) {
  const rows: Array<{ y: number; l: number; r: number }> = [];
  for (let y = -20; y <= HEIGHT + 20; y += 8) {
    const { center, half } = riverAt(s.d + (KAYAK_Y - y), s.world.length);
    rows.push({ y, l: center - half, r: center + half });
  }
  for (const side of ["l", "r"] as const) {
    const edge = side === "l" ? -40 : WIDTH + 40;
    // Grass, then a sandy strip at the water's edge.
    for (const [inset, color] of [[0, "#e9c98b"], [10, "#5f9e4f"]] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(edge, rows[0].y);
      for (const row of rows) ctx.lineTo(side === "l" ? row.l - inset : row.r + inset, row.y);
      ctx.lineTo(edge, rows[rows.length - 1].y);
      ctx.closePath();
      ctx.fill();
    }
    // Foam along the edge.
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    rows.forEach((row, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, side === "l" ? row.l + 2 : row.r - 2, row.y));
    ctx.stroke();
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, y: number, t: number) {
  if (o.kind === "rock") {
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o.x, y + 2, o.r + 4 + Math.sin(t * 6 + o.d) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#6f7385";
    ctx.beginPath();
    ctx.arc(o.x, y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9a9fb2";
    ctx.beginPath();
    ctx.arc(o.x - o.r * 0.3, y - o.r * 0.3, o.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "rgba(255,255,255,.35)";
    roundRect(ctx, o.x1 - 3, y - 9, o.x2 - o.x1 + 6, 18, 9);
    ctx.fillStyle = "#7a5230";
    roundRect(ctx, o.x1, y - 7, o.x2 - o.x1, 14, 7);
    ctx.strokeStyle = "#5a3b1f";
    ctx.lineWidth = 1.5;
    for (let x = o.x1 + 18; x < o.x2 - 10; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.stroke();
    }
  }
}

function drawStar(ctx: CanvasRenderingContext2D, star: Star, y: number, t: number) {
  const r = 11 + Math.sin(t * 5 + star.d) * 1.5;
  ctx.save();
  ctx.translate(star.x, y);
  ctx.rotate(t * 1.2);
  ctx.shadowColor = "#ffe2a8";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#f5c26b";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawKayak(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, t: number, capsized: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((vx / 300) * 0.35);
  // Wake.
  ctx.strokeStyle = "rgba(255,255,255,.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, 16);
  ctx.lineTo(-12, 30);
  ctx.moveTo(6, 16);
  ctx.lineTo(12, 30);
  ctx.stroke();
  // Hull.
  ctx.fillStyle = capsized ? "#9b4a12" : "#f08a2c";
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a3d10";
  ctx.beginPath();
  ctx.ellipse(0, 1, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!capsized) {
    // Paddle.
    ctx.rotate(Math.sin(t * 9) * 0.5);
    ctx.strokeStyle = "#6b4a2b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-17, 0);
    ctx.lineTo(17, 0);
    ctx.stroke();
    ctx.fillStyle = "#f5c26b";
    for (const px of [-19, 19]) {
      ctx.beginPath();
      ctx.ellipse(px, 0, 4, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Paddler.
    ctx.fillStyle = "#e2554f";
    ctx.beginPath();
    ctx.arc(0, 1, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3b2a20";
    ctx.beginPath();
    ctx.arc(0, -2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawIsland(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.fillStyle = "#e9c98b";
  ctx.beginPath();
  ctx.ellipse(x, y, 120, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2d79f";
  ctx.beginPath();
  ctx.ellipse(x, y - 6, 95, 42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Palm.
  ctx.strokeStyle = "#6b4a2b";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + 45, y + 5);
  ctx.quadraticCurveTo(x + 40, y - 30, x + 52, y - 55);
  ctx.stroke();
  ctx.fillStyle = "#2f6b3a";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.sin(t) * 0.1;
    ctx.beginPath();
    ctx.ellipse(x + 52 + Math.cos(a) * 14, y - 55 + Math.sin(a) * 8, 16, 5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // Timnu, waiting with her cane.
  ctx.fillStyle = "#5b3a8c";
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 10);
  ctx.lineTo(x - 20, y - 22);
  ctx.lineTo(x - 10, y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f3eee3";
  ctx.beginPath();
  ctx.arc(x - 20, y - 26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7a5230";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 10);
  ctx.lineTo(x - 6, y - 24);
  ctx.stroke();
  ctx.fillStyle = "#f5c26b";
  ctx.beginPath();
  ctx.arc(x - 6, y - 26, 3, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
