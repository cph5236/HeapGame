export interface BridgeDef {
  bodyHeight:     number;  // px — visual sprite thickness
  colliderHeight: number;  // px — physics segment height (keep small for accurate diagonals)
}

export const BRIDGE_DEF: BridgeDef = {
  bodyHeight:     30,
  colliderHeight: 10,
};
