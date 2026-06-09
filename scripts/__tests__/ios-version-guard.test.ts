import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', 'ios-version-guard.sh');

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}
function writePkg(cwd: string, version: string): void {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'heap-game', version }) + '\n');
}
function runGuard(cwd: string): string {
  return execFileSync('bash', [SCRIPT], { cwd, encoding: 'utf8' }).trim();
}

describe('ios-version-guard', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ios-guard-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t.t');
    git(dir, 'config', 'user.name', 'tester');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('builds when the version changed between commits', () => {
    writePkg(dir, '0.2.5'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'v1');
    writePkg(dir, '0.2.6'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'v2');
    expect(runGuard(dir)).toBe('should_build=true');
  });

  it('skips when the version is unchanged between commits', () => {
    writePkg(dir, '0.2.5'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'v1');
    writeFileSync(join(dir, 'other.txt'), 'x'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'noop');
    expect(runGuard(dir)).toBe('should_build=false');
  });

  it('builds on the first commit (no previous package.json)', () => {
    writePkg(dir, '0.2.5'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'v1');
    expect(runGuard(dir)).toBe('should_build=true');
  });
});
