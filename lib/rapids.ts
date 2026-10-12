/**
 * The Rapids: a tiny top-down kayak game. Collect stars on the way to Timnu's island;
 * each star unlocks one lead. Pure logic (no DOM) so it can be unit tested.
 *
 * Coordinates: x runs 0..WIDTH across the river, d is distance travelled downstream.
 */

export const WIDTH = 360;
export const HEIGHT = 540;
/** Where the kayak sits on screen, in logical pixels from the top. */
export const KAYAK_Y = 400;
export const LIVES = 3;
const KAYAK_HALF = 14; // half-length; collisions use a circle at bow and stern
const KAYAK_R = 7;
const STAR_R = 20;
const INVULNERABLE_S = 1.4;

export interface Rock { kind: "rock"; x: number; d: number; r: number }
export interface Log { kind: "log"; x1: number; x2: number; d: number }
export type Obstacle = Rock | Log;
export interface Star { x: number; d: number; taken: boolean }

export interface World {
  length: number;
  obstacles: Obstacle[];
  stars: Star[];
}

export interface State {
  world: World;
  d: number;
  x: number;
  vx: number;
  lives: number;
  stars: number;
  invulnerable: number;
  time: number;
  /** Set on the frame something happened, for effects. */
  event: "hit" | "star" | null;
  done: null | "island" | "capsized";
}

export interface Input {
  /** -1 left, 0 none, 1 right (keyboard). */
  dir: number;
  /** Logical x the player is pointing at (touch / mouse drag), or null. */
  targetX: number | null;
}

/** Small seeded PRNG (mulberry32) so a run can be replayed and tested. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** River centre and half-width at distance d. Narrows and winds more as you go. */
export function riverAt(d: number, length: number): { center: number; half: number } {
  const p = Math.min(1, Math.max(0, d / length));
  const half = Math.min(150, Math.max(78, 146 - 50 * p + 14 * Math.sin(d / 260)));
  const wander = WIDTH / 2 + (40 + 30 * p) * Math.sin(d / 430) + 22 * Math.sin(d / 171 + 1.3);
  // Keep both banks on screen so every bank you can hit is a bank you can see.
  const center = Math.min(WIDTH - half - 16, Math.max(half + 16, wander));
  return { center, half };
}

export function createWorld(starCount: number, seed: number, length = 9400): World {
  const rand = rng(seed);
  const obstacles: Obstacle[] = [];

  // Leave the start calm and the island approach clear.
  for (let d = 420; d < length - 450; ) {
    const p = d / length;
    const { center, half } = riverAt(d, length);
    const left = center - half;
    if (p > 0.15 && rand() < 0.35) {
      // A log reaching in from one bank, leaving at least 40% of the river open.
      const span = 2 * half * (0.32 + rand() * 0.26);
      const fromLeft = rand() < 0.5;
      obstacles.push({ kind: "log", x1: fromLeft ? left - 20 : center + half - span, x2: fromLeft ? left + span : center + half + 20, d });
    } else {
      const r = 11 + rand() * 9;
      const x = center + (rand() * 2 - 1) * (half - r - 12);
      obstacles.push({ kind: "rock", x, d, r });
      // Later on, sometimes a second rock, always leaving a gap wide enough to pass.
      if (p > 0.4 && rand() < 0.35) {
        const r2 = 10 + rand() * 7;
        const x2 = x < center ? x + r + r2 + 52 + rand() * 40 : x - r - r2 - 52 - rand() * 40;
        if (x2 - r2 > left + 10 && x2 + r2 < center + half - 10) obstacles.push({ kind: "rock", x: x2, d: d + (rand() * 30 - 15), r: r2 });
      }
    }
    d += 200 - 90 * p + rand() * 70;
  }

  const stars: Star[] = [];
  const first = 700;
  const last = length - 650;
  for (let i = 0; i < starCount; i++) {
    const d = starCount === 1 ? (first + last) / 2 : first + (i * (last - first)) / (starCount - 1);
    const { center, half } = riverAt(d, length);
    let x = center + (rand() * 2 - 1) * (half - 30);
    // Don't hide a star inside a rock or under a log.
    for (const o of obstacles) {
      if (Math.abs(o.d - d) > 40) continue;
      if (o.kind === "rock" && Math.abs(o.x - x) < o.r + STAR_R + 6) x = o.x + (o.x < center ? 1 : -1) * (o.r + STAR_R + 10);
      if (o.kind === "log" && x > o.x1 - STAR_R && x < o.x2 + STAR_R) x = o.x1 < center - half + 1 ? o.x2 + STAR_R + 12 : o.x1 - STAR_R - 12;
    }
    stars.push({ x, d, taken: false });
  }
  return { length, obstacles, stars };
}

export function startState(world: World): State {
  return {
    world,
    d: 0,
    x: riverAt(0, world.length).center,
    vx: 0,
    lives: LIVES,
    stars: 0,
    invulnerable: 0,
    time: 0,
    event: null,
    done: null,
  };
}

export const speedAt = (d: number, length: number) => 170 + 140 * Math.min(1, d / length);

/** Advances the game by dt seconds. Mutates and returns the state. */
export function step(s: State, dt: number, input: Input): State {
  s.event = null;
  if (s.done) return s;
  dt = Math.min(dt, 0.05);
  s.time += dt;
  s.d += speedAt(s.d, s.world.length) * dt;
  s.invulnerable = Math.max(0, s.invulnerable - dt);

  if (input.targetX !== null) {
    s.vx = clamp((input.targetX - s.x) * 7, -300, 300);
  } else if (input.dir !== 0) {
    s.vx = clamp(s.vx + input.dir * 1100 * dt, -280, 280);
  } else {
    s.vx *= Math.max(0, 1 - 5 * dt);
  }
  s.x += s.vx * dt;

  const { center, half } = riverAt(s.d, s.world.length);
  const minX = center - half + KAYAK_R + 2;
  const maxX = center + half - KAYAK_R - 2;
  if (s.x < minX || s.x > maxX) {
    s.x = clamp(s.x, minX, maxX);
    s.vx = (s.x === minX ? 1 : -1) * 120;
    hurt(s);
  }

  const bow = { x: s.x, d: s.d + KAYAK_HALF };
  const stern = { x: s.x, d: s.d - KAYAK_HALF };
  for (const o of s.world.obstacles) {
    if (Math.abs(o.d - s.d) > 50) continue;
    if (hits(o, bow) || hits(o, stern)) {
      hurt(s);
      break;
    }
  }

  for (const star of s.world.stars) {
    if (!star.taken && Math.hypot(star.x - s.x, star.d - s.d) < STAR_R + KAYAK_R) {
      star.taken = true;
      s.stars++;
      s.event = "star";
    }
  }

  if (s.lives <= 0) s.done = "capsized";
  else if (s.d >= s.world.length) s.done = "island";
  return s;
}

function hits(o: Obstacle, p: { x: number; d: number }): boolean {
  if (o.kind === "rock") return Math.hypot(o.x - p.x, o.d - p.d) < o.r + KAYAK_R;
  return Math.abs(o.d - p.d) < 6 + KAYAK_R && p.x > o.x1 - KAYAK_R && p.x < o.x2 + KAYAK_R;
}

function hurt(s: State) {
  if (s.invulnerable > 0) return;
  s.lives--;
  s.invulnerable = INVULNERABLE_S;
  s.event = "hit";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
