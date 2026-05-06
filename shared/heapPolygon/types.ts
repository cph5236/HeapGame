// shared/heapPolygon/types.ts
//
// Pure types used by the polygon generator. Mirrors src/data/heapTypes.ts
// for the fields the polygon math actually reads (no Phaser-coupled fields).

export interface HeapEntry {
  x: number;
  y: number;
  keyid: number;
  w?: number;
  h?: number;
}

export interface ItemDef {
  width: number;
  height: number;
}

export type ItemDefs = Record<number, ItemDef>;

export interface Vertex {
  x: number;
  y: number;
}

export interface ScanlineRow {
  y: number;
  leftX: number;
  rightX: number;
}
