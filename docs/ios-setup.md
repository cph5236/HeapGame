# iOS Build — One-Time Setup

The iOS TestFlight pipeline ([.github/workflows/ios.yml](../.github/workflows/ios.yml))
is fully automated, but these steps require a human with the Apple account and
cannot be done by CI. Do them once.

## 1. Apple Developer Program
- Enrol at https://developer.apple.com/programs/ ($99/yr).
- Approval can take a few hours to a couple of days — start this first.

## 2. Register the App ID
- App Store Connect → Certificates, IDs & Profiles → Identifiers → new App ID
  `com.hanlinsoftware.heapgame.app` (must match `capacitor.config.ts` `appId`).

## 3. Create the App Store Connect app record
- App Store Connect → Apps → + → New App.
- Platform: iOS · Bundle ID: `com.hanlinsoftware.heapgame.app` · Name: Heap.
- This record must exist before the first TestFlight upload.

## 4. App Store Connect API key (TEAM key, not Individual)
- App Store Connect → Users and Access → Integrations → App Store Connect API.
- **Generate a Team key** (Individual keys cannot use the provisioning endpoints
  automatic signing relies on — they fail at build time).
- Role: App Manager (or Admin). Download the `.p8` (one-time download).
- Note the **Key ID** and the **Issuer ID** (shown on that page).

## 5. Find your Team ID
- Apple Developer → Membership → Team ID (10 characters).

## 6. Add GitHub repository secrets
Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|--------|-------|
| `VITE_HEAP_SERVER_URL` | Production Worker URL (same value the Android workflow uses) |
| `ASC_KEY_ID` | API Key ID from step 4 |
| `ASC_ISSUER_ID` | Issuer ID from step 4 |
| `ASC_API_KEY_P8` | The `.p8` file contents, base64-encoded: `base64 -i AuthKey_XXXX.p8` |
| `APPLE_TEAM_ID` | 10-char Team ID from step 5 |

## 7. Trigger a build
- Bump the version (`npm run version:patch`) and push to `main`, **or** run the
  "iOS Build" workflow manually (Actions → iOS Build → Run workflow).
- The build appears in App Store Connect → TestFlight after processing.
- The first run often needs a signing fix or two — that's expected; subsequent
  runs stay green.
