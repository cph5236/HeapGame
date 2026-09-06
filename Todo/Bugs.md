## BUGS

# Server

# COSMETICS

# Mobile


# Web

# Scenes

# Enemies
- jumper enemy needs sounds 
# Admin
- Reward-code "Expires At" is silently dropped when the time half is left blank.
  Repro: mint a code, set only the date (field reads e.g. `09/12/2026, --:-- --`),
  hit Mint Code -> the code is created with EXPIRES `-` (never expires).
  Cause is client-side only, in admin/index.html onCreateCode (~L1337):
    const expiresRaw = $('rc-expires').value;
    const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;
  An <input type="datetime-local"> reports value === "" whenever the control is
  incomplete, so a date with no time yields "" -> null, and null is what actually
  reaches the server. Nothing is wrong in the DB or the API: codes.ts validates
  expiresAt and codeDb.ts binds it correctly, so expires_at is legitimately NULL.
  Fix: don't let an incomplete control mint silently. Either block submit when
  rc-expires.validity.badInput is true (or value === "" while the user has typed
  into it), or default a date-only entry to 23:59 local. Either way surface it —
  the current failure is invisible until you read the codes table.
  Found 2026-08-28 minting HEAPDAY for the Grand Opening launch event.

# Gameplay
Air jump needs some animation / cloud jumping


