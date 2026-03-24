import Phaser from 'phaser';
import { Platform } from '../entities/Platform';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';

export class HeapGenerator {
  private readonly scene: Phaser.Scene;
  private readonly group: Phaser.Physics.Arcade.StaticGroup;

  onPlatformSpawned?: (entry: HeapEntry, platformTopY: number) => void;

  // Data sorted by Y descending (highest Y = bottom of heap = index 0).
  // This matches the order the player encounters them: bottom first, summit last.
  private readonly data: HeapEntry[];

  // Pointer into data[]. Everything before this index has already been spawned.
  private nextLoadIndex: number = 0;

  constructor(
    scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.StaticGroup,
    data: HeapEntry[],
  ) {
    this.scene = scene;
    this.group = group;
    // Sort defensively in case caller passes unsorted data
    this.data = [...data].sort((a, b) => b.y - a.y);
  }

  /** Live read-only view of all entries — used by findSurfaceY at runtime. */
  get entries(): readonly HeapEntry[] {
    return this.data;
  }

  /**
   * Y of the heap's topmost surface (smallest top-edge Y across all entries).
   * Used to define the player placement zone.
   */
  get topY(): number {
    let min = MOCK_HEAP_HEIGHT_PX;
    for (const e of this.data) {
      const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      const top = e.y - def.height / 2;
      if (top < min) min = top;
    }
    return min;
  }

  /**
   * Instantiate all heap objects whose center Y is >= toY that haven't been
   * spawned yet. Call this as the player climbs (toY decreases over time).
   */
  generateUpTo(toY: number): void {
    while (
      this.nextLoadIndex < this.data.length &&
      this.data[this.nextLoadIndex].y >= toY
    ) {
      this.spawnEntry(this.data[this.nextLoadIndex]);
      this.nextLoadIndex++;
    }
  }

  /**
   * Add a new block to the heap at runtime and spawn it immediately.
   * Used when the player places a block at the summit.
   * Bypasses the streaming pointer — entry is spawned directly.
   */
  addEntry(entry: HeapEntry): void {
    this.data.push(entry);
    this.spawnEntry(entry);
  }

  private spawnEntry(entry: HeapEntry): void {
    const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
    new Platform(this.scene, this.group, entry.x, entry.y, def.width, def.height);
    const platformTopY = entry.y - def.height / 2;
    this.onPlatformSpawned?.(entry, platformTopY);
  }
}
