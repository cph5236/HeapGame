import { describe, it, expect } from 'vitest';
import { buildAnnouncementBeats } from '../announcementLogic';

describe('buildAnnouncementBeats', () => {
  it('includes the refund beat with the player\'s actual amount', () => {
    const beats = buildAnnouncementBeats(1550);
    expect(beats).toHaveLength(3);
    expect(beats[2]).toContain('1,550');
    expect(beats[2]).toContain('Scrap');
  });

  it('omits the refund beat entirely at zero rather than saying "0 Scrap"', () => {
    const beats = buildAnnouncementBeats(0);
    expect(beats).toHaveLength(2);
    expect(beats.join(' ')).not.toContain('0 Scrap');
  });

  it('always explains the pool and the unlocks', () => {
    const beats = buildAnnouncementBeats(600);
    expect(beats[0].toLowerCase()).toContain('stamina');
    expect(beats[1].toLowerCase()).toContain('dash');
  });
});
