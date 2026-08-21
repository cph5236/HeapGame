import { describe, it, expect } from 'vitest';
import { privacyRow } from '../privacyRow';

describe('privacyRow', () => {
  it('offers a tappable entry point where consent applies', () => {
    const row = privacyRow(true);

    expect(row).not.toBeNull();
    expect(row?.label).toBe('Privacy options');
  });

  it('renders nothing outside regulated regions', () => {
    // A permanently greyed row reads as a broken control, so it is omitted
    // entirely rather than shown disabled.
    expect(privacyRow(false)).toBeNull();
  });
});
