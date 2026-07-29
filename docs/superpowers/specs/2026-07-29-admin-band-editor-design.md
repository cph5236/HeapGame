# Admin Band Editor — Design

**Origin:** `Todo/Todo.md` — "Heap silhouette rendered in the Admin UI. Renders the
layers at the 20px bands as horizontal bars… X min and max can be edited. This will
allow fixing points from the admin UI. Likely needs a new Admin api server route."
The `2026-07-28-admin-ui-tailwind-design.md` spec deferred this line explicitly.
Brainstormed 2026-07-29.

Motivating problem: migration `heap_core/0004` converted the old vertex blobs into
band rows, and some of that geometry came out wrong — in **both** the live band rows
and the frozen base blob. There is currently no way to inspect or repair either.

## Context

The heap's shape lives in two places, nominally split by the freeze line:

| Layer | Storage | Covers | Mutability |
|-------|---------|--------|------------|
| Live zone | `heap_band` rows — `(heap_id, band, min_x, max_x, version)` | bands `< bandOf(freeze_y)` | MIN/MAX-merged by `upsertBands`; deleted by `freezeAtomic` once buried |
| Base | `heap_base.vertices` blob, referenced by `heap.base_id` | bands at or below the freeze line | immutable and content-hashed — changing it means minting a new row |

A band is 20 world px (`BAND_SIZE_PX`), and a band holds exactly two numbers: the
leftmost and rightmost x. That is the whole shape model — `bandEnvelope.ts` states
the invariant that this is precisely what the client renders, which is why editing
extents is editing the silhouette rather than an approximation of it.

The base blob is itself an envelope, serialised at `bandMidY` by
`envelopeToVertices`. So one band-row editing model covers both layers; the layers
differ in how a write is *committed*, not in what is being edited.

### The layers overlap, and the render is their union

The table above is the *intent*. In practice a band can exist in both layers at once,
and the client renders the union of the two:

```ts
// HeapClient.buildPolygon
return [...base, ...liveVertices];   // bucketed to bands downstream, min/max per band
```

Two ways a band ends up in both. First, `liveBandsOf` treats `freeze_y = 0` as a
sentinel meaning "nothing is frozen yet", so on a never-frozen heap **every** band row
is live while the base blob still covers those same bands. Second, migration `0004`
backfilled `heap_band` from the live zone *and* from the base, so those heaps have
full overlap by construction — and they are exactly the heaps this feature exists to
repair.

The consequence drives the write rule in Part 1: **narrowing a band in one layer does
not narrow what players see**, because the other layer's wider extent still wins the
union. An edit has to reach every layer that holds the band.

Three further facts constrain every decision below:

1. **`admin/index.html` is standalone** — 864 lines, inline script, no bundler, no
   imports, opened from disk. It cannot import anything from `shared/`.
2. **`getHeap` is KV-cached for 60s** (`CachedHeapDB`), while `getHeapFresh` and
   `getBandRange` deliberately read through.
3. **The delta protocol merges with MIN/MAX on the client.** `HeapClient` line 200
   applies `mergeBands(bandsToEnvelope(cache.bands), wireToBands(data.bands))`, and
   `mergeBands` is `Math.min`/`Math.max`. A *narrowed* band delivered as a delta is
   merged straight back to its old width.

## Goal

Let one operator inspect a heap's silhouette band by band and repair damaged
geometry in either layer, safely, against a named environment.

Non-goals: no change to placement, freeze, or the delta protocol; no new client-side
code in `src/`; no band add/delete as distinct operations (re-derive covers gap
filling); no bulk clamp/smooth tooling.

## Part 1 — Server

Two new admin-gated routes on `/heaps/:id/bands`. No existing route, payload, or
response shape changes.

### `GET /heaps/:id/bands`

Returns everything the editor needs in one uncached read:

```jsonc
{
  "version": 412,
  "baseId": "…",
  "freezeY": 48640,
  "worldHeight": 50000,
  "liveBands": [ { "band": 2103, "minX": -1840, "maxX": 1902.5 }, … ],
  "baseBands": [ { "band": 2098, "minX": -2360, "maxX": 2300 }, … ]
}
```

`liveBands` comes from `getAllBandsVersioned` filtered by `liveBandsOf` (its
`version` field dropped); `baseBands` from `getBaseVerticesById` through
`verticesToEnvelope` → `envelopeToRows`.

`getAllBandsVersioned` rather than `getAllBands` because **`getAllBands` is cached
and `getAllBandsVersioned` deliberately reads through** — its doc comment already says
it "must never be served from a cached snapshot". That comment names the freeze path
as its only caller and must be updated: this route becomes the second.

`getBaseVerticesById` is cached, and that is safe here without any change: base rows
are immutable and the cache is keyed on `baseId`, so a newly minted base is a
guaranteed miss and can never be served stale.

The response mirrors what players see: bands below the freeze line are filtered out of
`liveBands` even when straggler rows exist there (`freezeAtomic` can leave rows above
its watermark). Those rows render for nobody and would only confuse the picture. They
are still handled correctly on write, because the routing rule is evaluated against
database state, not against what the editor loaded.

Why this exists rather than reusing `GET /heaps/:id` + `GET /heaps/:id/base`:

- **The admin page cannot import `verticesToEnvelope`.** The alternative is
  reimplementing band maths inline in a file with no tests, where it would drift
  from the real implementation. The server already imports the module.
- **`getHeap` is cached.** Loading the editor off a 60s-old snapshot means CAS-ing
  against a stale version, which could fail repeatedly for a minute on an active
  heap. This route reads through, for the same reason `getBandRange` does.

Reads go through `getHeapFresh`. The route is admin-gated for consistency with the
write, not because the geometry is secret — `GET /heaps/:id` already serves it.

### `PUT /heaps/:id/bands`

```jsonc
{
  "expectedVersion": 412,
  "expectedBaseId": "…",
  "bands": [ { "band": 2103, "minX": -460, "maxX": 440 }, … ]
}
```

`bands` is the full dirty set across **both** layers, unsorted. Which layer a row
lands in is decided server-side, not by the caller — the UI has one edit gesture and
the server routes it.

**The routing rule.** For each dirty band `b` with new extents:

1. If the base envelope already contains `b`, set the base's `b` to those extents.
2. If a live row already exists for `b`, replace it with those extents.
3. If neither layer contains `b` — a gap being filled by re-derive — create it in the
   layer the freeze line assigns: the base when `freeze_y > 0 && b >= bandOf(freeze_y)`,
   otherwise a live row.

Rules 1 and 2 both firing is the normal case, not an exception: after the write both
layers carry identical extents for `b`, so their union is exactly what the operator
asked for. Writing only one layer would leave the other's stale extent winning the
union — see "The layers overlap" above. This is the rule the whole feature turns on.

Responses:

- `200 { version, baseId }` — the new values after the write.
- `409 { error, version, baseId }` — a guard failed; nothing was written. The
  current values are returned so the UI can report the drift.
- `400` — validation (below).
- `404` — no such heap.

### Every save mints a fresh `baseId`

This is the keystone, and it is unconditional — a live-only edit mints one too.

Because `mergeBands` is MIN/MAX, a narrowed band delivered as a delta is merged back
to its old width: the repair would look correct in D1 and be invisible in-game. A
changed `baseId` is the existing, tested signal that forces a client to discard its
bands and take a full response. `PUT /heaps/:id/reset` already depends on exactly
this, and says so in its own comment: *"a stable id over changed base content strands
every client on stale geometry — the id change is what tells a client to discard its
bands and take a full response."*

Making it unconditional, rather than branching on "did this narrow anything?", means
one code path instead of two protocol behaviours to test. The cost is that clients
re-download the base blob after a repair — the same cost reset already pays, on an
operation run deliberately and rarely.

The new base's content is the current base envelope with routing-rule steps 1 and 3
applied, re-serialised by `envelopeToVertices`. When no dirty band touches the base at
all, that reduces to the current vertices verbatim: the id changes, the content does
not.

### One transaction

Guarded the way `freezeAtomic` is — correlated subqueries rather than a JS check
between statements, because a D1 batch fixes every statement's bind params before any
of them run and executes all of them regardless of what the others did.

1. `INSERT` the new `heap_base` row via `SELECT … WHERE EXISTS (SELECT 1 FROM heap
   WHERE id = ? AND version = ? AND base_id = ?)`, so a loser mints no orphan base.
2. `UPDATE heap SET base_id = ?, version = ? WHERE id = ? AND version = ? AND
   base_id = ?` — CAS on both `version` and `base_id`. The new version is
   `expectedVersion + 1`, computed in JS because the CAS makes the prior value known.
3. Live band upserts — `INSERT … ON CONFLICT(heap_id, band) DO UPDATE SET min_x =
   excluded.min_x, max_x = excluded.max_x, version = excluded.version`, each guarded
   on whether the heap now points at *our* new base. That is the same stronger test
   `freezeAtomic` uses for its DELETE: two racers can compute the same version, but
   `base_id` is unique per attempt.

Success is detected from the `UPDATE`'s `meta.changes`.

**This cannot reuse `upsertBands`.** That method is MIN/MAX by design and
structurally cannot narrow a band. The new method needs replace semantics, so it is a
separate `HeapDB` member — `adminReplaceBands(args): Promise<boolean>` — implemented
across all three variants the repo keeps in step: `D1HeapDB`, the in-memory mock used
by the route tests, and a `CachedHeapDB` decorator that calls `invalidateHeap` like
every other write.

### Validation

Reject with `400`:

- `bands` absent, not an array, or empty.
- More than **500** bands in one request. Base edits are O(1) statements regardless
  of how many bands they touch (one blob rewrite), so this bounds only the live-row
  statement count; the live zone is ~77 bands, so the cap is generous.
- Any `band` that is not a non-negative integer, or exceeds
  `floor(world_height / BAND_SIZE_PX)`.
- Any non-finite `minX`/`maxX`, or `minX > maxX`.
- Duplicate `band` values.

### What is deliberately untouched

- **`top_y` and `freeze_y`.** No operation can create a band above the highest
  existing one: re-derive only fills gaps *between* known bands, and a band with no
  row in either layer renders nothing, so there is nothing above the summit to select.
  The summit cannot move.
- **`heap_parameters`, params, locks.** Out of scope.

### A documented side effect: the base is normalised on every save

Rewriting the base round-trips it through `verticesToEnvelope` →
`envelopeToVertices`. Legacy vertices at arbitrary y collapse to band extents at
`bandMidY`. This is lossless against what the client renders (the invariant
`bandEnvelope.ts` is built on) and produces exactly the same shape `freezeAtomic`
already writes. It may repair some conversion damage on its own.

## Part 2 — Admin UI

A third collapsible sub-section inside the existing Edit Heap panel, alongside Heap
Params and Enemy Params — the same card idiom as the rest of the page. It loads
lazily behind a **Load silhouette** button so opening a heap to change `coinMult`
does not pull thousands of bands.

### Panes

The two silhouette panes share one x-domain, computed once from every band, so a
handle's horizontal position means the same thing in the overview and the detail
window.

Both silhouette panes draw the **merged** envelope — the union of the two layers,
which is what players actually see — and use colour to show which layer(s) hold each
band: green live-only, blue base-only, teal both, amber dirty. Drawing the layers as
two separate shapes would show two pictures, neither of which is the game.

- **Overview** — `<canvas>`, the whole heap, one `fillRect` per band. No per-band hit
  testing beyond the drag window, and 2,500 rects is trivial. Draws the freeze line
  as an amber rule and a green window rect that drags to scrub.
- **Detail** — `<svg>`, the windowed ~40 bands. SVG rather than canvas because the
  handles must be real pointer targets, and it is ~120 nodes. Bars render at reduced
  opacity beneath two polylines drawn through the merged `min_x` and `max_x` handles —
  the two edges the client renders. Segments spanning an absent band are dashed, which
  is what makes a gap visible: an empty row looks like an empty row, but a dashed run
  jumping across it is the forward-fill sawtooth itself.
- **Inspector** — always present, not summoned. Band index, its y-range, which
  layer(s) hold it, `min_x` and `max_x` as editable floats, computed width. It edits
  the merged extents; the server fans the result out to whichever layers apply, so the
  operator never picks a layer. This is load-bearing rather than a
  convenience: a band with `min_x === max_x` collapses both handles onto one pixel,
  and that single-point band is exactly the defect class being hunted, so the
  inspector is the only way to address one of its two values.

### Interaction

- Pointerdown on a handle selects its band and begins a drag. Horizontal movement
  snaps to whole pixels — bands are floats in D1, but pixel granularity on a 20px
  band is already finer than anything visible. Typed inspector values accept any
  float.
- `min_x` clamps at `max_x` rather than swapping past it.
- Clicking anywhere in a band's row selects without dragging.
- Handles drag **inward as well as outward**. Narrowing is what fixes a spike, and it
  is why the write needs replace semantics.

### Re-derive from neighbours

Select a band range, then re-derive: find the nearest band above the range and the
nearest below it that each have two distinct extents and lie outside the range, then
linearly interpolate `min_x` and `max_x` across every band in between — including
bands that do not currently exist, which is how "adding points into the base" from
the Todo line is covered without a separate add operation.

It borrows two rules from `interpolateBandSeed`: single-extent bands are skipped as
seed sources (their unknown side is itself a forward-filled guess, and interpolating
from a guess propagates it), and a neighbour is required on *both* sides. It is not
the same operation — that one seeds a single new band during placement; this one
recomputes an operator-chosen range — so it is implemented separately rather than
shared.

**It runs client-side**, staging its output like any other edit. The tradeoff is that
~12 lines of interpolation live in a file with no test harness. Accepted because the
operator sees the re-derived silhouette before saving, and for this operation a
visual preview is stronger verification than a unit test. Reversible: if that proves
wrong it becomes `POST /heaps/:id/bands/rederive`, proposing rows without saving.

### Staging and save

Edits accumulate in an in-memory `Map<band, {minX, maxX}>` of merged extents, against
a pristine copy of the loaded state. Dirty bands render amber in both panes; a footer
shows `N bands dirty` with **Save** and **Discard**. Save sends the whole dirty set in
one `PUT`.

Save confirmation reuses the page's existing `confirm()` pattern with the environment
name interpolated, as the delete dialogs already do. When any dirty band is held by
the base — which the `GET` response makes computable client-side — the dialog names
the cost: rewriting the base means every client re-downloads it.

On `409` the status bar reports the server's current version and offers **Reload**;
reloading discards staged edits behind a confirm. Rebasing staged edits onto the
fresh read was considered and rejected — real complexity for a case that only arises
when someone is actively placing on the heap being repaired.

### Preserved

Every existing fetch path, `escapeHtml` call site, the inline `onclick` handler
pattern for generated rows, and the environment switcher / per-env secret behaviour
introduced by the Tailwind spec. `adminFetch` is reused as-is, including its 401
handling.

## Testing

**Server (`server/tests/`)** — this is where the coverage lives:

1. CAS wins on matching `version` + `baseId`; loses on a stale `version`; loses on a
   stale `baseId` (a freeze landing mid-edit).
2. A losing CAS writes **nothing** — no orphan `heap_base` row, no band change.
3. A narrowed band actually narrows. This is the case `upsertBands` cannot do and the
   reason the new method exists.
4. **A band held by both layers is narrowed in both** — routing rules 1 and 2
   together. The regression this guards is the whole feature silently not working:
   the live row narrows, the base does not, and the union keeps the old width.
5. A `freeze_y = 0` heap, where every band is nominally live but the base covers the
   same bands, narrows correctly end to end.
6. A frozen-band edit mints a new base with the edited geometry and repoints
   `heap.base_id`.
7. A dirty band held only by live rows still mints a new base id, with vertices
   identical to the old.
8. A band absent from both layers is created in the layer the freeze line assigns
   (rule 3), on both sides of the line.
9. A save spanning both layers applies in one transaction.
10. Validation rejects each case listed above.
11. `GET /heaps/:id/bands` splits live and base rows at the freeze line, excludes
    straggler rows below it, and reads fresh rather than from cache.
12. `CachedHeapDB` invalidates on `adminReplaceBands`.

**Admin page** — manual, plus Playwright screenshots against a local Worker,
consistent with the existing admin spec: a standalone file with no module boundary
offers nothing to import.

1. Load against a seeded local heap; both layers render, freeze line in the right
   place.
2. Drag a handle; the inspector number tracks it and snaps to whole pixels.
3. Narrow a spike, save, reload — it stayed narrow. Verify in-game too, not just in
   the editor: this is the path the layer-union bug would hide in.
4. Edit a frozen band, save, confirm `baseId` changed.
5. Re-derive across a gap; the dashed run disappears in the preview.
6. Force a `409` by bumping the version behind the editor's back; the banner reports
   the drift and does not wedge.
7. Select a `min_x === max_x` band and edit each side from the inspector.
8. Screenshots at desktop and ~500px wide; no horizontal page scroll.

`npm run build` and `npm test` as the usual regression check.

## Risks

- **A bad save is destructive and there is no undo past Discard.** Replace semantics
  means a mistyped `min_x` overwrites real geometry. Mitigated by staging (nothing
  is written until Save), the environment-named confirmation, and the fact that the
  previous base row is never deleted — the old geometry remains recoverable by hand
  from `heap_base` if needed.
- **The operator cannot edit one layer independently.** Editing is on merged extents
  and the server fans out. Deliberate: independent layer editing lets you produce a
  state where the union is not what either pane showed, which is how the geometry got
  into this condition in the first place. If a genuine need for per-layer editing
  appears, it is a later addition, not a thing to leave half-open now.
- **Every save forces a full re-download of the base for every client.** Accepted;
  it is the price of narrowing reaching players at all, and it matches reset.
- **Old `heap_base` rows accumulate.** Each save leaves the previous row orphaned.
  Freeze already does this, so this adds to an existing pattern rather than
  introducing one. Not addressed here.
- **Editing a heap under active placement will lose CAS races.** Correct but
  annoying. The uncached read narrows the window; beyond that, repair a heap when it
  is quiet.
- **Re-derive maths is untested code in a standalone file.** Accepted, with the
  visual preview as the check and a named path to move it server-side.
