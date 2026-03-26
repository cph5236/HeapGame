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
  filename: string;   // PNG filename in src/sprites/
  width: number;      // scaled game width in px (preserves aspect ratio)
  height: number;     // scaled game height in px
}
