## BUGS

# COSMETICS
CAT hat is bugged and needs new art

# Mobile

# Scenes

# Admin
Editing a heap's enemy params in the Admin UI (`PUT /heaps/:id/enemy-params`) updates the DB but does NOT bump the heap's `version`. The client's `load()` is version-gated: when the cached version matches, the server returns `{ changed: false }` and the client keeps its stale `enemyParams` from the localStorage cache (only the `data.changed` branch refreshes them). Result: enemy-param edits aren't picked up by an already-loaded client, and even a client restart stays stale until the heap version changes for another reason (e.g. a block placement). Infinite heap is unaffected (uses `primeEnemyParams`, unconditional fetch). Fix options: bump version on enemy-params PUT, or fetch enemy-params unconditionally like `primeEnemyParams` for base heaps too.

# Gameplay