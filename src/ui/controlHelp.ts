/** Mode-aware CONTROLS help copy, shared by MenuScene + GameScene info overlays.
 *  Single source of truth so both surfaces stay consistent across control modes. */
export function controlHelpLines(isMobile: boolean, mode: 'tilt' | 'joystick'): string[] {
  if (!isMobile) {
    return [
      'CONTROLS', '',
      'Move     ← →  /  A  D',
      'Jump     ↑  /  W',
      'Dash     SHIFT',
      'Dive     ↓  /  S  (airborne)',
      'Place    SPACE',
      '', 'TIP', '',
      'Left & right edges wrap around!',
    ];
  }
  const actions = mode === 'joystick' ? [
    'Move     Joystick left / right',
    'Jump     Push joystick up',
    'Dash     Dash button / double-tap',
    'Dive     Push joystick down',
    'Place    PLACE BLOCK button',
    'Ladder   Push up / down',
  ] : [
    'Move     Tilt phone left / right',
    'Jump     Tap or swipe up',
    'Dash     Swipe left / right',
    'Dive     Swipe down',
    'Place    PLACE BLOCK button',
    'Ladder   Drag up / down',
  ];
  return ['CONTROLS', '', ...actions, '', 'TIP', '', 'Left & right edges wrap around!'];
}
