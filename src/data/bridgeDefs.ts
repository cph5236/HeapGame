export interface BridgeDef {
  minBridgesPerBand: number;
  maxBridgesPerBand: number;
  bodyHeight:        number;  // px — physics body height
  snapThresholdY:    number;  // max vertical delta between left/right surface Y
}

export const BRIDGE_DEF: BridgeDef = {
  minBridgesPerBand: 1,
  maxBridgesPerBand: 2,
  bodyHeight:        12,
  snapThresholdY:    150,
};
