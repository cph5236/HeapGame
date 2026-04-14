export interface HeapEntry {
  x: number;     // center X in world coordinates
  y: number;     // center Y in world coordinates (Y=0 is summit, Y=max is base)
  keyid: number; // index into OBJECT_DEFS
}

export interface HeapChunk {
  bandTop: number;
  entries: HeapEntry[];
}

export interface ObjectDef {
  textureKey: string; // Phaser texture key (used when loading and rendering)
  filename: string;   // PNG path relative to src/sprites/
  width: number;      // scaled game width in px (preserves aspect ratio)
  height: number;     // scaled game height in px
  rarity: number;     // 0→1 spawn weight relative to folder peers (set in sprite-config.mjs)
}
