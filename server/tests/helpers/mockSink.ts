import type { Sink, StampedLogEntry } from '../../src/logging/Sink';

export class MockSink implements Sink {
  written: StampedLogEntry[] = [];

  async write(entries: StampedLogEntry[]): Promise<void> {
    this.written.push(...entries);
  }
}
