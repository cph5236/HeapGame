import { computeBandScanlines, computeBandPolygon, simplifyPolygon, Vertex } from '../systems/HeapPolygon';
import { CHUNK_BAND_HEIGHT } from '../constants';

export interface WorkerEntry {
  x: number;
  y: number;
  keyid: number;
  w?: number;
  h?: number;
}

export interface WorkerBandInput {
  bandTop: number;
  entries: WorkerEntry[];  // complete set: existing + new entries for this band
}

export interface WorkerRequest {
  bands: WorkerBandInput[];      // one per band with ≥1 new entry; entries are pre-assembled
  newEntries: WorkerEntry[];     // the raw batch — for response tracking only
}

export interface WorkerBandResult {
  bandTop: number;
  polygon: Vertex[];
}

export interface WorkerResponse {
  bands: WorkerBandResult[];
  /** Each processed entry exactly once — for callbacks and bucket tracking. */
  entries: WorkerEntry[];
  processedCount: number;
}

self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const { bands, newEntries } = e.data;
  const resultBands: WorkerBandResult[] = [];
  for (const { bandTop, entries } of bands) {
    const rows = computeBandScanlines(
      entries as Parameters<typeof computeBandScanlines>[0],
      bandTop,
      bandTop + CHUNK_BAND_HEIGHT,
    );
    const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
    if (polygon.length >= 3) resultBands.push({ bandTop, polygon });
  }

  const response: WorkerResponse = {
    bands: resultBands,
    entries: newEntries,
    processedCount: newEntries.length,
  };

  (self as unknown as Worker).postMessage(response);
};
