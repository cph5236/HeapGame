import { describe, it, expect } from 'vitest';
import { deviceGravity, isScreenFacingDown, screenSteerDeg } from '../tiltSteer';

/*
 * These tests never hand the module hand-picked beta/gamma pairs. They build a
 * PHYSICAL pose as a rotation matrix, run the W3C extraction over it to get the
 * angles a browser would actually report, and only then call the module. Ground
 * truth is read off the original matrix. The Euler round-trip sits in the middle,
 * which is precisely where the bug lives.
 */

const D = Math.PI / 180;
type M3 = number[][];

const mul = (A: M3, B: M3): M3 =>
  A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));

const Rx = (t: number): M3 => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const Ry = (t: number): M3 => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const Rz = (t: number): M3 => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

/** The spec's ZXY matrix: what the device's orientation IS, given the angles. */
const specMatrix = (a: number, b: number, g: number): M3 =>
  mul(mul(Rz(a * D), Rx(b * D)), Ry(g * D));

/** What a browser reports for a pose, honouring gamma's restricted [-90,90) range. */
function report(R: M3): { beta: number; gamma: number } {
  const m31 = R[2][0], m32 = R[2][1], m33 = R[2][2];
  const c = Math.hypot(m31, m33);
  if (c < 1e-9) return { beta: Math.asin(Math.max(-1, Math.min(1, m32))) / D, gamma: -90 };
  return m33 >= 0
    ? { beta: Math.atan2(m32,  c) / D, gamma: Math.atan2(-m31, m33) / D }
    : { beta: Math.atan2(m32, -c) / D, gamma: Math.atan2( m31, -m33) / D };
}

/** Physical truth: world height of the screen's RIGHT edge. Negative => lower => go right. */
const rightEdgeHeight = (R: M3) => R[2][0];

/** Pose: roll the phone `steer` about its long axis, then pitch it `pitch` upright. */
const hold = (pitchDeg: number, steerDeg: number) => mul(Rx(pitchDeg * D), Ry(steerDeg * D));

describe('the reported angles round-trip through the spec matrix', () => {
  it('report() inverts specMatrix() for poses inside gamma\'s range', () => {
    for (const [a, b, g] of [[0, 45, 20], [30, 70, -30], [0, 120, -20], [0, -100, 40]]) {
      const r = report(specMatrix(a, b, g));
      expect(r.beta).toBeCloseTo(b, 6);
      expect(r.gamma).toBeCloseTo(g, 6);
    }
  });

  it('deviceGravity matches the negated bottom row of the spec matrix', () => {
    for (const [b, g] of [[45, 20], [-100, 40], [175, -80], [0, 0]]) {
      const R = specMatrix(0, b, g);
      const gv = deviceGravity(b, g);
      expect(gv.x).toBeCloseTo(-R[2][0], 12);
      expect(gv.y).toBeCloseTo(-R[2][1], 12);
      expect(gv.z).toBeCloseTo(-R[2][2], 12);
    }
  });
});

describe('ordinary portrait holds still steer the way they used to', () => {
  it.each([40, 55, 70])('pitch %i: left tilts read negative, right positive', (pitch) => {
    for (const steer of [-30, -15, 15, 30]) {
      const { beta, gamma } = report(hold(pitch, steer));
      const out = screenSteerDeg(beta, gamma);
      expect(out).not.toBeNull();
      expect(Math.sign(out!)).toBe(Math.sign(steer));
    }
  });

  it('agrees with raw gamma in the regime where raw gamma was fine', () => {
    const { beta, gamma } = report(hold(45, -20));
    // Screen-plane lean, not the body-axis roll, so it is damped by the hold angle
    // rather than equal to it -- but it must carry the same sign and rough scale.
    const out = screenSteerDeg(beta, gamma)!;
    expect(Math.sign(out)).toBe(Math.sign(gamma));
    expect(Math.abs(out)).toBeGreaterThan(5);
  });
});

describe('screen facing down — the reported bug', () => {
  // Phone held overhead, screen facing down at the player, right edge dropped.
  const overheadRightEdgeDown = specMatrix(0, 175, -20);

  it('is detected as screen-down', () => {
    const { beta, gamma } = report(overheadRightEdgeDown);
    expect(isScreenFacingDown(beta, gamma)).toBe(true);
  });

  it('raw gamma MIRRORS here (this is the defect being fixed)', () => {
    const { gamma } = report(overheadRightEdgeDown);
    expect(rightEdgeHeight(overheadRightEdgeDown)).toBeLessThan(0); // right edge IS lower
    expect(Math.sign(gamma)).toBe(-1);                              // ...but gamma says left
  });

  it('screenSteerDeg reports the physically correct direction', () => {
    const { beta, gamma } = report(overheadRightEdgeDown);
    expect(Math.sign(screenSteerDeg(beta, gamma)!)).toBe(1); // right, matching physics
  });

  it('holds across a sweep of screen-down poses', () => {
    for (let beta = 100; beta <= 180; beta += 10) {
      for (const steer of [-25, 25]) {
        const R = specMatrix(0, beta, steer);
        const out = screenSteerDeg(...Object.values(report(R)) as [number, number]);
        if (out === null) continue;
        // Physics: right edge lower (negative height) must steer right (positive).
        expect(Math.sign(out)).toBe(-Math.sign(rightEdgeHeight(R)));
      }
    }
  });
});

describe('no discontinuity as the roll passes 90 degrees', () => {
  // Rolling the phone past 90 degrees is where gamma's restricted range forces the
  // browser to re-encode the pose: beta flips past 90 and gamma mirrors back
  // through the boundary. Physically the motion is smooth, so the steer signal
  // must be smooth too.
  it('steer stays continuous where raw gamma tears', () => {
    const sample = (steer: number) => {
      const { beta: b, gamma: g } = report(hold(45, steer));
      return { steer: screenSteerDeg(b, g), gamma: g };
    };
    let maxSteerJump = 0;
    let maxGammaJump = 0;
    let prev = sample(-75);
    for (let s = -75.5; s >= -105; s -= 0.5) {
      const cur = sample(s);
      if (prev.steer !== null && cur.steer !== null) {
        maxSteerJump = Math.max(maxSteerJump, Math.abs(cur.steer - prev.steer));
      }
      maxGammaJump = Math.max(maxGammaJump, Math.abs(cur.gamma - prev.gamma));
      prev = cur;
    }
    expect(maxGammaJump).toBeGreaterThan(150); // the old signal tears apart here
    expect(maxSteerJump).toBeLessThan(2);      // the new one does not
  });
});

describe('near-vertical holds are no longer hypersensitive', () => {
  it('an upright phone rotated in its own plane reads the rotation, not full lock', () => {
    // Upright, then turned 30 degrees in the plane of the screen. The player has
    // steered 30 degrees; raw gamma pegs to -90 (full speed) because beta ~ 90 is
    // the gimbal-lock singularity.
    const R = mul(Rx(90 * D), Rz(30 * D));
    const { beta, gamma } = report(R);
    expect(Math.abs(gamma)).toBeCloseTo(90, 3);            // gamma is pegged
    expect(Math.abs(screenSteerDeg(beta, gamma)!)).toBeCloseTo(30, 3); // steer is honest
  });
});

describe('flat holds keep behaving exactly as they did before', () => {
  // The pre-existing behaviour was "steer = gamma". For a flat phone that is the
  // correct answer, so the new signal must reproduce it rather than merely agree
  // in sign — otherwise this fix would quietly retune everyone's controls.
  it.each([-30, -13.5, -4, 0, 4, 13.5, 30])('beta=0, gamma=%f reduces to gamma', (gamma) => {
    expect(screenSteerDeg(0, gamma)).toBeCloseTo(gamma, 10);
  });

  it('a level phone steers neither way', () => {
    expect(screenSteerDeg(0, 0)).toBeCloseTo(0, 12);
    expect(screenSteerDeg(180, 0)).toBeCloseTo(0, 12);
  });
});

describe('screen orientation compensation', () => {
  it('angle 0 leaves portrait steering untouched', () => {
    const { beta, gamma } = report(hold(50, -20));
    expect(screenSteerDeg(beta, gamma, 0)).toBeCloseTo(screenSteerDeg(beta, gamma)!, 12);
  });

  it('in landscape, left/right follow the SCREEN, not the device', () => {
    // Landscape: the device's natural top edge (+y) now points to the player's
    // right, so the screen's right edge is the device's +y edge. Drop that edge
    // and the player must steer right.
    const R = mul(Rx(-50 * D), Rz(0));      // beta < 0 => device +y edge is lower
    const { beta, gamma } = report(R);
    expect(R[2][1]).toBeLessThan(0);         // device +y edge IS lower
    expect(screenSteerDeg(beta, gamma, 90)!).toBeGreaterThan(0); // ...steers right
  });

  it('opposite landscape mirrors it', () => {
    const R = mul(Rx(-50 * D), Rz(0));
    const { beta, gamma } = report(R);
    expect(screenSteerDeg(beta, gamma, 270)!).toBeLessThan(0);
  });
});
