import { computeBandScanlines, computeBandPolygon, simplifyPolygon, Vertex, ScanlineRow } from '../systems/HeapPolygon';
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
  rows?: ScanlineRow[];
}

export interface WorkerResponse {
  bands: WorkerBandResult[];
  /** Each processed entry exactly once — for callbacks and bucket tracking. */
  entries: WorkerEntry[];
  processedCount: number;
}

export interface LayersWorkerRequest {
  type: 'layers';
  bands: { bandTop: number; rows: ScanlineRow[] }[];
}

self.onmessage = (e: MessageEvent<WorkerRequest | LayersWorkerRequest>): void => {
  const msg = e.data;

  // Pre-computed scanlines path — skip computeBandScanlines entirely
  if ((msg as LayersWorkerRequest).type === 'layers') {
    const req = msg as LayersWorkerRequest;
    const resultBands: WorkerBandResult[] = [];
    for (const { bandTop, rows } of req.bands) {
      const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
      if (polygon.length >= 3) resultBands.push({ bandTop, polygon, rows });
    }
    (self as unknown as Worker).postMessage({
      bands: resultBands,
      entries: [],
      processedCount: 0,
    } satisfies WorkerResponse);
    return;
  }

  // Existing entries path (no type field on legacy messages)
  const { bands, newEntries } = e.data as WorkerRequest;
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
