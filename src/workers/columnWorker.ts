import { appendColumnEntries } from '../systems/InfiniteColumnGenerator';
import type { HeapEntry } from '../data/heapTypes';

export interface ColumnExtendRequest {
  colIndex: number;
  seed: number;
  xMin: number;
  xMax: number;
  startIndex: number;
  existingEntries: HeapEntry[];
  numBlocks: number;
  heapTopY: number;
}

export interface ColumnExtendResponse {
  colIndex: number;
  newEntries: HeapEntry[];
}

self.onmessage = (e: MessageEvent<ColumnExtendRequest>): void => {
  const { colIndex, seed, xMin, xMax, startIndex, existingEntries, numBlocks, heapTopY } = e.data;
  const newEntries = appendColumnEntries(seed, xMin, xMax, startIndex, existingEntries, numBlocks, heapTopY);
  (self as unknown as Worker).postMessage({ colIndex, newEntries } satisfies ColumnExtendResponse);
};
