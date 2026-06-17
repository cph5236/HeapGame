import type { Vertex } from '../systems/HeapPolygon';
import type { TutorialStep } from '../systems/TutorialDirector';
import { WORLD_WIDTH } from '../constants';

/** Short world so the climb is quick and easy. */
export const TUTORIAL_WORLD_HEIGHT = 1400;

const W = WORLD_WIDTH;
const H = TUTORIAL_WORLD_HEIGHT;

/** Closed silhouette: base across the bottom, rising staircase on the right with one
 *  vertical wall (for wall-jump) and one notch (for dash), flat plateau at the top.
 *  Y=0 is the summit; Y=H is the base. Walk up from the lower-left. */
export const TUTORIAL_HEAP: Vertex[] = [
  { x: 0,           y: H },              // bottom-left base
  { x: 0,           y: H - 120 },        // low left shoulder
  { x: W * 0.25,    y: H - 120 },        // step 1 tread
  { x: W * 0.25,    y: H - 320 },        // step 1 riser (wall-jump wall)
  { x: W * 0.45,    y: H - 320 },        // step 2 tread
  { x: W * 0.45,    y: H - 520 },        // step 2 riser
  { x: W * 0.55,    y: H - 520 },        // lip before the gap
  { x: W * 0.62,    y: H - 520 },        // far side of the dash gap (notch below cut by base)
  { x: W * 0.62,    y: H - 760 },        // step 3 riser
  { x: W * 0.85,    y: H - 760 },        // top plateau (block placement zone)
  { x: W * 0.85,    y: H - 980 },        // plateau back riser
  { x: W,           y: H - 980 },        // top-right shoulder
  { x: W,           y: H },              // bottom-right base
];

/** Rat sits on step-2 tread; item on the plateau approach. */
export const TUTORIAL_RAT_X  = W * 0.50;
export const TUTORIAL_ITEM_X = W * 0.70;

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'welcome',   message: 'Welcome to Heap! Climb to the top of the pile.',          advanceOn: 'tap',       mode: 'info' },
  { id: 'move',      message: 'Move with the joystick (or arrow keys).',                 advanceOn: 'move',      mode: 'hint' },
  { id: 'jump',      message: 'Jump up onto the next step.',                             advanceOn: 'jump',      mode: 'hint' },
  { id: 'walljump',  message: 'Facing a wall? Jump again off it to wall-jump up.',       advanceOn: 'walljump',  mode: 'hint' },
  { id: 'dash',      message: 'Dash across the gap.',                                    advanceOn: 'dash',      mode: 'hint' },
  { id: 'dive',      message: 'Dive (swipe / press down in the air) to drop fast.',      advanceOn: 'dive',      mode: 'hint' },
  { id: 'stomp',     message: 'A rat! Jump on top of it to squash it.',                  advanceOn: 'stomp',     mode: 'hint' },
  { id: 'pickup',    message: 'Grab that salvage item — carry it to the top for points.',advanceOn: 'pickup',    mode: 'hint' },
  { id: 'attop',     message: 'You reached the top zone!',                               advanceOn: 'tap',       mode: 'info' },
  { id: 'placeBlock',message: 'Hold PLACE to drop your block and grow the heap.',        advanceOn: 'placeBlock',mode: 'hint' },
  { id: 'complete',  message: "Nice — you're ready. Time for a real climb!",             advanceOn: 'tap',       mode: 'info' },
];
