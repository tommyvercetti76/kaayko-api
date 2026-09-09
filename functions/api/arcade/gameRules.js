/**
 * arcade/gameRules.js — the rules of the two surviving machines, shared by the browser
 * and the server. Mirrored byte-for-byte into
 * kaayko-api/functions/api/arcade/gameRules.js; change one and you must change both,
 * or honest players start getting rejected.
 *
 * Both games run on a FIXED timestep and a seeded RNG, so a run is fully determined by
 * (seed, input events). The client sends only its inputs; the server replays them and
 * decides the outcome. Nothing about winning is decided in the browser.
 *
 * Inputs are timed in STEP INDICES, never seconds. Rounding a float time to milliseconds
 * can push an event across a step boundary, and the two replays then diverge — which is
 * exactly what happened the first time this was written.
 */

const STEP = 1 / 60;          // seconds per simulation step, both sides
const TARGET = 12;            // franked envelopes / posts passed needed to clear

/* ── seeded RNG (mulberry32) ──────────────────────────────────────────────── */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Franking Rush — envelopes cross a three-lane desk; tap each before it exits.
   Generous by design: a wide hit window and a slow ramp. It should be winnable
   on a first try by somebody who has never seen it.
   ══════════════════════════════════════════════════════════════════════════ */

const FRANK = {
  LANES: 3,

  // The strike zone: the lit band just before the franking head. An envelope only
  // takes a mark while it is inside this, so the game is timing rather than mashing.
  // Tapping a lane with nothing in the zone is a MISFIRE and is counted against you,
  // which is what stops "hit all three lanes constantly" from being a strategy.
  ZONE_LO: 0.60,
  ZONE_HI: 0.88,

  MAX_MISSED: 8,              // envelopes allowed past the head unfranked
  MAX_MISFIRE: 8,             // taps allowed to hit nothing
  MAX_TAPS: 3000,             // a run this long is not a run
  TARGET,

  /** Every envelope this seed will ever produce, with its spawn time and speed. */
  schedule(seed, count = 40) {
    const r = rng(seed);
    const out = [];
    let t = 0.8;
    for (let i = 0; i < count; i++) {
      out.push({
        id: i,
        spawnT: t,
        lane: Math.floor(r() * FRANK.LANES),
        speed: 0.20 + r() * 0.05 + i * 0.003     // ramps, but never beyond a hand
      });
      t += Math.max(0.55, 1.25 - i * 0.022);
    }
    return out;
  },

  /** Position of an envelope at step s, in screen widths. Past ZONE_HI it is lost. */
  posAt(env, s) {
    return -0.12 + (s * STEP - env.spawnT) * env.speed;
  },

  /** The envelope a tap in `lane` would strike at step `s`, or null for a misfire. */
  targetOf(sched, struck, lane, s) {
    const mid = (FRANK.ZONE_LO + FRANK.ZONE_HI) / 2;
    let best = null, bestD = Infinity;
    for (const env of sched) {
      if (struck.has(env.id) || env.lane !== lane || s * STEP < env.spawnT) continue;
      const x = FRANK.posAt(env, s);
      if (x < FRANK.ZONE_LO || x > FRANK.ZONE_HI) continue;
      const d = Math.abs(x - mid);
      if (d < bestD) { bestD = d; best = env; }
    }
    return best;
  },

  /**
   * Replay a run. `taps` are {s, lane} where s is an integer step index.
   * @returns {{franked:number, missed:number, misfire:number, cleared:boolean, reason?:string}}
   */
  replay(seed, taps, count = 40) {
    const none = (reason) => ({ franked: 0, missed: 0, misfire: 0, cleared: false, reason });
    if ((taps || []).length > FRANK.MAX_TAPS) return none("TOO_MANY_INPUTS");

    const sched = FRANK.schedule(seed, count);
    const struck = new Set();
    let franked = 0, misfire = 0, lastS = -1;

    for (const tap of taps || []) {
      const s = Math.round(Number(tap?.s));
      const lane = Number(tap?.lane);
      if (!Number.isFinite(s) || s < 0 || s > 12000) return none("BAD_INPUT");
      if (s <= lastS) return none("NOT_MONOTONIC");
      lastS = s;
      if (!(lane >= 0 && lane < FRANK.LANES)) continue;

      const best = FRANK.targetOf(sched, struck, lane, s);
      if (best) { struck.add(best.id); franked += 1; }
      else misfire += 1;
    }

    // Envelopes that crossed the head before the run ended and were never struck.
    const endS = lastS < 0 ? 0 : lastS;
    let missed = 0;
    for (const env of sched) {
      if (struck.has(env.id)) continue;
      if (FRANK.posAt(env, endS) > FRANK.ZONE_HI) missed += 1;
    }
    return {
      franked, missed, misfire,
      cleared: franked >= FRANK.TARGET && missed <= FRANK.MAX_MISSED && misfire <= FRANK.MAX_MISFIRE
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   Mail Run — hold to climb, release to fall, thread the gaps.
   Gaps are wide and the plane is forgiving; the difficulty is staying calm.
   ══════════════════════════════════════════════════════════════════════════ */

const FLY = {
  GRAVITY: 1.05,
  LIFT: -1.30,
  VMAX: 0.62,
  PLANE_X: 0.20,
  PLANE_R: 0.035,
  POST_W: 0.035,
  SPEED: 0.30,
  MAX_EVENTS: 3000,           // one flip every other step for the whole run, and then some
  TARGET,

  posts(seed, count = 30) {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        id: i,
        x0: 1.15 + i * 0.62,                      // spacing in screen widths
        gapY: 0.30 + r() * 0.40,
        gap: Math.max(0.30, 0.42 - i * 0.004)     // stays generous
      });
    }
    return out;
  },

  /**
   * Replay from input events: [{s, down}] where s is an integer step index.
   * @returns {{passed:number, cleared:boolean, reason?:string, diedAt:number|null}}
   */
  replay(seed, events, maxSteps = 5400) {
    if ((events || []).length > FLY.MAX_EVENTS) return { passed: 0, cleared: false, reason: "TOO_MANY_INPUTS", diedAt: null };
    const posts = FLY.posts(seed);
    const evs = (events || []).slice().filter((e) => Number.isFinite(Number(e?.s)));
    for (let i = 1; i < evs.length; i++) {
      if (Number(evs[i].s) < Number(evs[i - 1].s)) return { passed: 0, cleared: false, reason: "NOT_MONOTONIC", diedAt: null };
    }

    let y = 0.5, v = 0, step = 0, ei = 0, down = false, passed = 0;
    const scored = new Set();

    while (step < maxSteps) {
      while (ei < evs.length && Math.round(Number(evs[ei].s)) <= step) { down = !!evs[ei].down; ei += 1; }
      const t = step * STEP;
      v += (down ? FLY.LIFT : FLY.GRAVITY) * STEP;
      v = Math.max(-FLY.VMAX, Math.min(FLY.VMAX, v));
      y += v * STEP;
      if (y < FLY.PLANE_R || y > 1 - FLY.PLANE_R) return { passed, cleared: false, reason: "CRASHED", diedAt: step };

      for (const p of posts) {
        const x = p.x0 - t * FLY.SPEED;
        if (Math.abs(x - FLY.PLANE_X) < FLY.POST_W + FLY.PLANE_R) {
          if (y < p.gapY - p.gap / 2 || y > p.gapY + p.gap / 2) {
            return { passed, cleared: false, reason: "HIT_POST", diedAt: step };
          }
        }
        if (!scored.has(p.id) && x < FLY.PLANE_X - FLY.POST_W) { scored.add(p.id); passed += 1; }
      }
      if (passed >= FLY.TARGET) return { passed, cleared: true, diedAt: null };
      step += 1;
    }
    return { passed, cleared: passed >= FLY.TARGET, reason: "TIMEOUT", diedAt: null };
  }
};

module.exports = { FRANK, FLY, STEP, TARGET, rng };
