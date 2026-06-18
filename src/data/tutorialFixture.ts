import type { Vertex } from '../systems/HeapPolygon';
import type { TutorialStep } from '../systems/TutorialDirector';
import { WORLD_WIDTH } from '../constants';

/** Short world so the climb is quick and easy. */
export const TUTORIAL_WORLD_HEIGHT = 1600;

const W = WORLD_WIDTH;        // 960
const H = TUTORIAL_WORLD_HEIGHT;

/**
 * Hand-authored Trash Heap silhouette: a single organic MOUND that peaks in the
 * middle, with both flanks mirror-symmetric about the world centre (x = W/2). The
 * player climbs the LEFT flank up to the central summit; the RIGHT flank is an exact
 * mirror, so a player who walks off one screen edge WRAPS seamlessly to the other
 * side at the same height and can climb that flank too. Traced as one closed
 * boundary: bottom-left base, up the left climbing face (the polygon's TOP edge is
 * the walkable/feature surface), across the summit, down the mirrored right face,
 * back to the base. Y=0 is the summit (top of screen); Y=H is the base (bottom).
 *
 * Both outer edges sit at the SAME height (y = H-120), which is what makes the wrap
 * seamless. There are no containment walls — the player can't fall off the map
 * because TutorialScene sets player.worldHeight = TUTORIAL_WORLD_HEIGHT, so the
 * Player's floor clamp stops any fall at the world base.
 *
 * Slope rule (collider): a surface is *walkable* only if its slope ≤ 35°
 * (MAX_WALKABLE_SLOPE_DEG); steeper faces are *walls* (you slide / wall-jump them).
 * So ramps here stay ≤ ~33° and the deliberate walls are vertical.
 *
 * Features up the LEFT flank (each teaches one move), then mirrored on the right:
 *   - gentle shoulder + walk ........ MOVE (and wrap-around demo)
 *   - 120px vertical step ........... JUMP onto the ledge
 *   - 320px vertical wall ........... WALL-JUMP (too tall for a single jump)
 *   - gently curved DOME summit .... DASH practice (taught as the move you use to
 *                                     cross the open gap when wrapping sides),
 *                                     then STOMP the rat, PICKUP the item, PLACE a block
 *
 * The summit is a gently curved DOME (peak at the centre, ~21° max flank), not a flat
 * top. This is deliberate: a perfectly flat top whose Y lands on the scanline grid is
 * misread by the collider as a vertical wall and ejects the player. A dome makes every
 * scanline row's left/right extent change, so each row classifies as the real (gentle,
 * walkable) slope. See Todo/Bugs.md ("Flat plateau top misclassified as a vertical
 * wall"); the dome sidesteps that bug rather than relying on the 1px-tilt hack.
 */
export const TUTORIAL_HEAP: Vertex[] = [
  { x: 0,   y: H },          // 0  bottom-left base
  { x: 0,   y: H - 120 },    // 1  left edge shoulder (MOVE start / wrap point)
  { x: 150, y: H - 150 },    // 2  move ramp top (~11° — walkable)
  { x: 150, y: H - 270 },    // 3  jump-step top (120px vertical riser)
  { x: 215, y: H - 270 },    // 4  flat after the jump
  { x: 215, y: H - 590 },    // 5  top of the tall wall / dome left edge (wall-jump up to here)
  { x: 290, y: H - 619 },    // 6  dome flank (~21°)
  { x: 370, y: H - 640 },    // 7  dome flank (~15°)
  { x: 430, y: H - 648 },    // 8  dome (rat sits here)
  { x: 480, y: H - 650 },    // 9  dome PEAK (centre)
  { x: 530, y: H - 648 },    // 10 dome (item sits here, mirror of 8)
  { x: 590, y: H - 640 },    // 11 dome flank (mirror of 7)
  { x: 670, y: H - 619 },    // 12 dome flank (mirror of 6)
  { x: 745, y: H - 590 },    // 13 dome right edge / right wall top (mirror of 5)
  { x: 745, y: H - 270 },    // 14 right wall base (320px drop, mirror of 4)
  { x: 810, y: H - 270 },    // 15 flat before right jump-step (mirror of 3)
  { x: 810, y: H - 150 },    // 16 right jump-step base (mirror of 2)
  { x: W,   y: H - 120 },    // 17 right edge shoulder (wrap point, mirror of 1)
  { x: W,   y: H },          // 18 bottom-right base
];

/** Player spawn: on the left move-shoulder (x < 150), dropped in from just above so
 *  gravity settles them onto the ramp. The world floor (y=H) is inside the heap
 *  body, so spawning there would bury the player. */
export const TUTORIAL_SPAWN_X = 30;
export const TUTORIAL_SPAWN_Y = H - 250;

/** Rat: stands on the dome just left of the peak (vertex 8, surface y=H-648). */
export const TUTORIAL_RAT_X         = 430;
export const TUTORIAL_RAT_SURFACE_Y = H - 648;

/** Item: sits on the dome just right of the peak (vertex 10, surface y=H-648). */
export const TUTORIAL_ITEM_X         = 530;
export const TUTORIAL_ITEM_SURFACE_Y = H - 648;

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'welcome',    message: 'Welcome to Heap! Climb to the top of the Trash Heap.', advanceOn: 'tap',        mode: 'info' },
  { id: 'move',       message: 'Move left and right to start climbing.',               advanceOn: 'move',       mode: 'hint' },
  { id: 'jump',       message: 'Jump up onto the next ledge.',                          advanceOn: 'jump',       mode: 'hint' },
  { id: 'walljump',   message: 'This wall is too tall to jump — wall-jump up it: Jump into the wall, then jump while pressing away from it.', advanceOn: 'walljump', mode: 'hint' },
  { id: 'dash',       message: 'Try a dash — jump and dash to cross big gaps.',          advanceOn: 'dash',       mode: 'hint' },
  { id: 'dive',       message: 'Jump up, then dive straight back down.',                advanceOn: 'dive',       mode: 'hint' },
  { id: 'stomp',      message: 'A rat! Land on top of it to squash it.',               advanceOn: 'stomp',      mode: 'hint' },
  { id: 'pickup',     message: 'Grab the salvage item — carry it up for points.',      advanceOn: 'pickup',     mode: 'hint' },
  { id: 'attop',      message: 'You reached the top of the Trash Heap!',               advanceOn: 'tap',        mode: 'info' },
  { id: 'placeBlock', message: 'Add your block to the Trash Heap.',                     advanceOn: 'placeBlock', mode: 'hint' },
  { id: 'complete',   message: 'Nice work! Dash, Wall-Jump, and Dive were just for the tutorial — unlock them for real in the Upgrades store. Now go climb!', advanceOn: 'tap', mode: 'info' },
];

/** Control scheme the player is using, for instruction copy. */
export interface ControlHintOpts {
  mobile: boolean;
  mode: 'tilt' | 'joystick';
}

/** Keyboard (desktop) instruction copy, keyed by step id. */
const DESKTOP_MESSAGES: Record<string, string> = {
  welcome:    'Welcome to Heap! Climb to the top of the Trash Heap.',
  move:       'Use the ← → arrow keys (or A and D) to move. Tip: walk off one edge of the screen to wrap around to the other side.',
  jump:       'Press ↑ (or W) to jump onto the ledge.',
  walljump:   'Wall-jump up the tall wall: press → into the wall to cling, then press ↑ and ← together to spring up and off it. Repeat to climb.',
  dash:       'Press Shift to dash. Try it mid-air too (jump, then dash) — a jump-dash is how you cross the big open gap when you wrap to the other side of the heap.',
  dive:       'Jump up, then hold ↓ (or S) to dive straight down.',
  stomp:      'A rat! Land on top of it to squash it.',
  pickup:     'Grab the salvage item — carry it to the top for points.',
  attop:      'You reached the top of the Trash Heap!',
  placeBlock: 'Press Space to add your block to the Trash Heap.',
  complete:   'Nice work! Dash, Wall-Jump, and Dive were just for the tutorial — unlock them for real in the Upgrades store. Now go climb!',
};

/** Touch (mobile) instruction copy, keyed by step id. `move` is filled per control mode. */
const MOBILE_MESSAGES: Record<string, string> = {
  welcome:    'Welcome to Heap! Climb to the top of the Trash Heap.',
  move:       '', // set from control mode in tutorialMessage
  jump:       'Swipe up to jump onto the ledge.',
  walljump:   'Wall-jump up the tall wall: move into the wall and tilt to cling to it, then swipe up-and-away from the wall to spring off. Repeat to climb.',
  dash:       'Swipe left or right to dash. Try it mid-air too (jump, then swipe) — a jump-dash is how you cross the big open gap when you wrap to the other side of the heap.',
  dive:       'Jump up, then swipe down to dive straight down.',
  stomp:      'A rat! Land on top of it to squash it.',
  pickup:     'Grab the salvage item — carry it to the top for points.',
  attop:      'You reached the top of the Trash Heap!',
  placeBlock: 'Hold the PLACE button to add your block to the Trash Heap.',
  complete:   'Nice work! Dash, Wall-Jump, and Dive were just for the tutorial — unlock them for real in the Upgrades store. Now go climb!',
};

/**
 * Resolve a step's instruction text for the player's actual control scheme. Falls
 * back to the step's authored `message` for any id without a specific override.
 */
export function tutorialMessage(step: TutorialStep, opts: ControlHintOpts): string {
  if (opts.mobile) {
    if (step.id === 'move') {
      return opts.mode === 'joystick'
        ? 'Use the joystick to move and start climbing. Tip: go off one edge of the screen to wrap around to the other side.'
        : 'Tilt your device left and right to move. Tip: go off one edge of the screen to wrap around to the other side.';
    }
    return MOBILE_MESSAGES[step.id] ?? step.message;
  }
  return DESKTOP_MESSAGES[step.id] ?? step.message;
}
