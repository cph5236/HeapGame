export interface HeapEntry {
  x: number;     // center X in world coordinates
  y: number;     // center Y in world coordinates (Y=0 is summit, Y=max is base)
  keyid: number; // index into OBJECT_DEFS
}

export interface ObjectDef {
  width: number;
  height: number;
}
