import { describe, expect, it } from "vitest";
import { createWorld, LIVES, riverAt, speedAt, startState, step, WIDTH, type Input } from "@/lib/rapids";

const idle: Input = { dir: 0, targetX: null };

describe("createWorld", () => {
  it("is deterministic per seed and places exactly the requested stars", () => {
    const a = createWorld(5, 42);
    const b = createWorld(5, 42);
    expect(a).toEqual(b);
    expect(a.stars).toHaveLength(5);
    expect(createWorld(0, 1).stars).toHaveLength(0);
    expect(createWorld(5, 43)).not.toEqual(a);
  });

  it("keeps every star inside the river and out of rocks", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld(5, seed);
      for (const s of w.stars) {
        const { center, half } = riverAt(s.d, w.length);
        expect(Math.abs(s.x - center)).toBeLessThan(half);
        for (const o of w.obstacles) {
          if (o.kind === "rock" && Math.abs(o.d - s.d) < 1) expect(Math.hypot(o.x - s.x, o.d - s.d)).toBeGreaterThan(o.r);
        }
      }
    }
  });

  it("keeps both banks on screen", () => {
    for (let d = 0; d < 9400; d += 25) {
      const { center, half } = riverAt(d, 9400);
      expect(center - half).toBeGreaterThanOrEqual(15);
      expect(center + half).toBeLessThanOrEqual(WIDTH - 15);
    }
  });

  it("always leaves a gap wide enough for the kayak past every log", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld(5, seed);
      for (const o of w.obstacles) {
        if (o.kind !== "log") continue;
        const { center, half } = riverAt(o.d, w.length);
        const open = Math.max(o.x1 - (center - half), center + half - o.x2);
        expect(open).toBeGreaterThan(40);
      }
    }
  });
});

describe("step", () => {
  it("collects a star the kayak paddles through", () => {
    const w = { length: 5000, obstacles: [], stars: [{ x: 0, d: 300, taken: false }] };
    const s = startState(w);
    w.stars[0].x = s.x;
    for (let i = 0; i < 200 && !s.stars; i++) step(s, 1 / 60, idle);
    expect(s.stars).toBe(1);
    expect(w.stars[0].taken).toBe(true);
  });

  it("loses a life on a rock, then is briefly invulnerable", () => {
    const s = startState({ length: 5000, obstacles: [], stars: [] });
    s.world.obstacles.push({ kind: "rock", x: s.x, d: 200, r: 15 });
    let hits = 0;
    for (let i = 0; i < 120; i++) if (step(s, 1 / 60, idle).event === "hit") hits++;
    expect(hits).toBe(1);
    expect(s.lives).toBe(LIVES - 1);
  });

  it("capsizes after losing every life, and reaches the island otherwise", () => {
    const crash = startState({ length: 100000, obstacles: [], stars: [] });
    for (let i = 0; i < 2000 && !crash.done; i++) step(crash, 1 / 60, { dir: 0, targetX: -WIDTH }); // steer into the bank
    expect(crash.done).toBe("capsized");

    const cruise = startState({ length: 3000, obstacles: [], stars: [] });
    for (let i = 0; i < 5000 && !cruise.done; i++) step(cruise, 1 / 60, { dir: 0, targetX: riverAt(cruise.d, 3000).center });
    expect(cruise.done).toBe("island");
    expect(cruise.lives).toBe(LIVES);
  });

  it("every course can be finished without a single hit (exhaustive reachability check)", () => {
    for (let seed = 1; seed <= 25; seed++) expect(clearRunExists(createWorld(5, seed)), `seed ${seed}`).toBe(true);
    // Control: a log across the whole river must be impossible.
    expect(clearRunExists({ length: 2000, stars: [], obstacles: [{ kind: "log", x1: -50, x2: WIDTH + 50, d: 1000 }] })).toBe(false);
  });
});

/**
 * Tracks every x the kayak could occupy, frame by frame, at the game's real speed and
 * steering limit, dropping positions that touch a bank, rock or log. True if any survive.
 */
function clearRunExists(w: ReturnType<typeof createWorld>): boolean {
  const CELL = 3;
  const dt = 1 / 60;
  const maxMove = Math.floor((260 * dt) / CELL); // a bit under the real 280-300 lateral speed
  const cells = Math.ceil(WIDTH / CELL);
  let reach = new Array<boolean>(cells).fill(false);
  const start = Math.round(riverAt(0, w.length).center / CELL);
  reach[start] = true;
  for (let d = 0; d < w.length; d += speedAt(d, w.length) * dt) {
    const next = new Array<boolean>(cells).fill(false);
    const { center, half } = riverAt(d, w.length);
    const near = w.obstacles.filter((o) => Math.abs(o.d - d) < 50);
    for (let i = 0; i < cells; i++) {
      if (!reach[i]) continue;
      for (let j = Math.max(0, i - maxMove); j <= Math.min(cells - 1, i + maxMove); j++) {
        if (next[j]) continue;
        const x = j * CELL;
        if (x < center - half + 9 || x > center + half - 9) continue;
        const blocked = near.some((o) =>
          [d + 14, d - 14].some((pd) =>
            o.kind === "rock" ? Math.hypot(o.x - x, o.d - pd) < o.r + 7 : Math.abs(o.d - pd) < 13 && x > o.x1 - 7 && x < o.x2 + 7,
          ),
        );
        if (!blocked) next[j] = true;
      }
    }
    reach = next;
    if (!reach.some(Boolean)) return false;
  }
  return true;
}
