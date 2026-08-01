/**
 * Origin allowlist matching for the CORS middleware.
 *
 * Entries are matched exactly, except for a leading `*.` in the host position,
 * which matches one or more subdomain labels. The wildcard form exists for
 * itch.io: it serves HTML5 games from randomized per-build subdomains
 * (e.g. https://v6p9d9t4.ssl.hwcdn.net), so the itch embed cannot be
 * allowlisted by exact origin.
 *
 *   https://*.hwcdn.net  matches      https://v6p9d9t4.ssl.hwcdn.net
 *                                     https://foo.hwcdn.net
 *                        rejects      https://hwcdn.net      (no subdomain)
 *                                     https://evilhwcdn.net  (not a label boundary)
 *                                     https://foo.hwcdn.net.evil.com
 *                                     http://foo.hwcdn.net   (scheme differs)
 *
 * Matching is anchored to both the scheme and a leading dot on the suffix, so a
 * lookalike registration cannot satisfy a wildcard entry.
 */

export interface OriginAllowlist {
  /** True when the list is the bare `*` wildcard — every origin is echoed back. */
  allowAll: boolean;
  /** Exact-or-wildcard match for a single Origin header value. */
  allows(origin: string): boolean;
}

const WILDCARD_ENTRY = /^([a-z][a-z0-9+.-]*:\/\/)\*\.(.+)$/i;

export function parseOriginAllowlist(raw: string | undefined): OriginAllowlist {
  const trimmed = (raw ?? '*').trim();

  if (trimmed === '*') {
    return { allowAll: true, allows: () => true };
  }

  const exact = new Set<string>();
  const wildcards: Array<{ scheme: string; suffix: string }> = [];

  for (const entry of trimmed.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(WILDCARD_ENTRY);
    if (m) {
      wildcards.push({
        scheme: m[1].toLowerCase(),
        suffix: `.${m[2].toLowerCase()}`,
      });
    } else {
      exact.add(entry);
    }
  }

  return {
    allowAll: false,
    allows(origin: string): boolean {
      if (exact.has(origin)) return true;
      const lower = origin.toLowerCase();
      return wildcards.some(({ scheme, suffix }) =>
        lower.startsWith(scheme) && lower.slice(scheme.length).endsWith(suffix),
      );
    },
  };
}
