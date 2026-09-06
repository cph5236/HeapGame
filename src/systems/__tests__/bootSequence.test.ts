import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * Covers the cloud-save read path — loadSnapshot → parse → merge → apply →
 * rename → emit. Every link in it was already unit-tested in isolation
 * (PlayGamesClient, gpgsSession, mergeCloudSave); the chain that wires them was
 * not, because it lived inline in BootScene until A4 pulled it out here.
 *
 * The stake is the write-auth secret: if the merge drops `playerSecret`, the
 * next getPlayerSecret() mints a fresh one, the server sees a hash mismatch, and
 * the player is 403-locked out of their own data permanently.
 */

const beginSignIn    = vi.fn();
const signInSettled  = vi.fn();
const loadSnapshot   = vi.fn();
const updateName     = vi.fn();

vi.mock('../gpgsSession', () => ({
  beginSignIn:   () => beginSignIn(),
  signInSettled: () => signInSettled(),
}));
vi.mock('../PlayGamesClient', () => ({
  PlayGamesClient: { loadSnapshot: () => loadSnapshot() },
}));
vi.mock('../PlayerNameClient', () => ({
  PlayerNameClient: { updateName: (id: string, name: string) => updateName(id, name) },
}));

// initPlatform's dependencies. Imported at module load, never exercised here —
// startIdentitySession is the whole surface under test.
vi.mock('../AudioManager', () => ({ AudioManager: { init: vi.fn() } }));
vi.mock('../ads/consentGate', () => ({ beginAdConsent: vi.fn() }));
vi.mock('../ConfigClient', () => ({ primeConfig: vi.fn() }));
vi.mock('../../logging', () => ({ initLogger: vi.fn() }));

const { startIdentitySession, SAVE_MERGED_EVENT } = await import('../bootSequence');
const {
  resetCacheForTests, getPlayerSecret, getPlayerName, getBalance,
  getRawSaveForCloudSync,
} = await import('../SaveData');

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    configurable: true,
  });
});

/** A complete current-schema save, so nothing a migration touches is in play. */
function save(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 5,
    playerGuid: 'local-guid', playerName: 'Local', playerSecret: 'LOCAL-SECRET',
    balance: 10, upgrades: {}, inventory: {}, placed: {}, selectedHeapId: '',
    highScores: {}, beatenHeapIds: [], cosmeticsOwned: [], cosmeticsEquipped: {},
    tutorialDone: true,
    ...over,
  };
}

function seedLocal(over: Record<string, unknown> = {}): void {
  localStorage.setItem('heap_save', JSON.stringify(save(over)));
  resetCacheForTests();
}

let emit: ReturnType<typeof vi.fn>;
/** Stands in for Phaser.Game — startIdentitySession only ever touches events. */
function fakeGame(): any { return { events: { emit } }; }

/** Drain the promise chain startIdentitySession kicks off. A macrotask boundary
 *  flushes every pending microtask, however deep the awaits nest. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const PLAYER = { playerId: 'gpgs-1', displayName: 'CloudName' };

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(store).forEach(k => delete store[k]);
  resetCacheForTests();
  emit = vi.fn();
  signInSettled.mockResolvedValue(PLAYER);
  loadSnapshot.mockResolvedValue(null);
});

describe('startIdentitySession — sign-in gate', () => {
  it('starts sign-in', async () => {
    seedLocal();
    startIdentitySession(fakeGame());
    await settle();
    expect(beginSignIn).toHaveBeenCalledTimes(1);
  });

  it('does nothing further when sign-in yields no player', async () => {
    seedLocal();
    signInSettled.mockResolvedValue(null);
    startIdentitySession(fakeGame());
    await settle();
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(updateName).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('stays silent when sign-in rejects', async () => {
    seedLocal();
    signInSettled.mockRejectedValue(new Error('sign-in blew up'));
    startIdentitySession(fakeGame());
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('startIdentitySession — display-name sync', () => {
  it('pushes the stored name under the effective player id', async () => {
    seedLocal({ playerName: 'Stored', gpgsPlayerId: 'gpgs-1' });
    startIdentitySession(fakeGame());
    await settle();
    expect(updateName).toHaveBeenCalledWith('gpgs-1', 'Stored');
  });

  it('skips the push when the stored name fails the shared validator', async () => {
    seedLocal({ playerName: '   ' });
    startIdentitySession(fakeGame());
    await settle();
    expect(updateName).not.toHaveBeenCalled();
  });
});

describe('startIdentitySession — cloud merge', () => {
  it('skips the merge when there is no snapshot', async () => {
    seedLocal();
    loadSnapshot.mockResolvedValue(null);
    startIdentitySession(fakeGame());
    await settle();
    expect(emit).not.toHaveBeenCalled();
    expect(getBalance()).toBe(10);
  });

  it('skips the merge on malformed cloud JSON, leaving local untouched', async () => {
    seedLocal();
    loadSnapshot.mockResolvedValue('{not json');
    startIdentitySession(fakeGame());
    await settle();
    expect(emit).not.toHaveBeenCalled();
    expect(getBalance()).toBe(10);
    expect(getPlayerSecret()).toBe('LOCAL-SECRET');
  });

  it('stays silent when the snapshot read throws', async () => {
    seedLocal();
    loadSnapshot.mockRejectedValue(new Error('snapshot unavailable'));
    startIdentitySession(fakeGame());
    await settle();
    expect(emit).not.toHaveBeenCalled();
    expect(getBalance()).toBe(10);
  });

  it('merges the cloud save and announces it', async () => {
    seedLocal({ balance: 10 });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    expect(getBalance()).toBe(900);          // higher balance wins
    expect(emit).toHaveBeenCalledWith(SAVE_MERGED_EVENT);
  });

  it('persists the merge, so it survives the next load', async () => {
    seedLocal({ balance: 10 });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    resetCacheForTests();                    // force a re-read from storage
    expect(getBalance()).toBe(900);
  });

  it('lets the GPGS display name win once the merge lands', async () => {
    seedLocal({ playerName: 'Local' });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ playerName: 'OtherDevice', balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    expect(getPlayerName()).toBe('CloudName');
  });
});

describe('startIdentitySession — write-auth secret survives the round trip', () => {
  it('keeps the local secret when both sides have one', async () => {
    seedLocal({ playerSecret: 'LOCAL-SECRET' });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ playerSecret: 'CLOUD-SECRET', balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    expect(getPlayerSecret()).toBe('LOCAL-SECRET');
  });

  it('recovers the cloud secret on a fresh install that has none', async () => {
    seedLocal({ playerSecret: undefined });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ playerSecret: 'CLOUD-SECRET' })));
    startIdentitySession(fakeGame());
    await settle();
    expect(getPlayerSecret()).toBe('CLOUD-SECRET');
  });

  it('never mints a replacement secret across the merge', async () => {
    seedLocal({ playerSecret: 'LOCAL-SECRET' });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    // Read straight off the persisted record: getPlayerSecret() would mint one
    // on the spot if the merge had dropped it, hiding exactly the bug we care about.
    expect(getRawSaveForCloudSync().playerSecret).toBe('LOCAL-SECRET');
  });

  it('keeps the local GUID even when the cloud carries a different one', async () => {
    seedLocal({ playerGuid: 'local-guid' });
    loadSnapshot.mockResolvedValue(JSON.stringify(save({ playerGuid: 'cloud-guid', balance: 900 })));
    startIdentitySession(fakeGame());
    await settle();
    expect(getRawSaveForCloudSync().playerGuid).toBe('local-guid');
  });
});
