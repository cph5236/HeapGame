// Shared player-name rules: one implementation for client (rename modal) and
// server (rename endpoint + first-seen seeding). Grandfathered DB names are
// never re-validated — only new names pass through here.
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

export const MAX_PLAYER_NAME_LEN = 20;

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'profanity' };

export function validatePlayerName(raw: string): NameValidation {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (name.length > MAX_PLAYER_NAME_LEN) return { ok: false, reason: 'too-long' };
  if (matcher.hasMatch(name)) return { ok: false, reason: 'profanity' };
  return { ok: true, name };
}

export function generateDefaultPlayerName(): string {
  const n = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');
  return `Trashbag#${n}`;
}
