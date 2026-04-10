export type TrashWallDef = {
  /** px below player Y at spawn */
  spawnBelowPlayerDistance: number;
  /** wall can never be more than this many px below player (slightly > ENEMY_CULL_DISTANCE) */
  maxLaggingDistance: number;
  /** px/s at world bottom (MOCK_HEAP_HEIGHT_PX) */
  speedMin: number;
  /** px/s at yForMaxSpeed */
  speedMax: number;
  /** world Y where speedMax is reached (high up the heap; smaller Y = higher) */
  yForMaxSpeed: number;
  /** px above wall top to set isWarning flag (future: play warningSound) */
  warningDistance: number;
  /** sound key — reserved for future audio pass */
  warningSound: string;
  /** px thickness of lethal band at wall's top edge */
  killZoneHeight: number;
  /** px trash sprites protrude above wall surface */
  undulateAmplitude: number;
  /** oscillation cycles per second */
  undulateSpeed: number;
  /** number of trash sprite images in the undulation pool */
  undulateCount: number;
};

export const TRASH_WALL_DEF: TrashWallDef = {
  spawnBelowPlayerDistance: 1200,//1200,
  maxLaggingDistance:       2200,  // slightly above ENEMY_CULL_DISTANCE (2000)
  speedMin:                   40,  // px/s near world floor
  speedMax:                  120,  // px/s at high altitude
  yForMaxSpeed:             5000,  // world Y (small = near heap summit)
  warningDistance:           600,
  warningSound:   'trashwall-warning', // placeholder — no audio hooked up yet
  killZoneHeight:             30,
  undulateAmplitude:          20,
  undulateSpeed:             0.6,
  undulateCount:              24,
};
