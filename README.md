# Heap Game

A Phaser 3 game built with TypeScript + Vite, deployable to web and Android via Capacitor.

## Prerequisites

```bash
npm install
```

---

## Web

### Dev server
```bash
npm run dev
```
Opens at `http://localhost:3000`.

### Production build + preview
```bash
npm run build
npm run preview
```

---

## Android

### First-time setup

1. Install [Android Studio](https://developer.android.com/studio)
2. In Android Studio, open **SDK Manager** and install the Android SDK
3. Set the `ANDROID_HOME` env var (add to `~/.bashrc` or `~/.zshrc`):
   ```bash
   export ANDROID_HOME=~/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```
4. Verify your environment:
   ```bash
   npx cap doctor
   ```

### Running on a physical device (wireless)

Android 11+ supports wireless debugging — no USB required after initial pairing.

1. On your phone: **Settings → Developer Options → Wireless Debugging → enable**
2. Tap **Pair device with pairing code** — note the IP and pairing port
3. On your machine:
   ```bash
   adb pair <ip>:<pairing-port>
   # enter the code shown on your phone
   ```
4. Back in Wireless Debugging, note the **IP address and port** shown on the main screen (different from the pairing port)
5. Connect:
   ```bash
   adb connect <ip>:<connect-port>
   ```
6. Verify the device is listed:
   ```bash
   adb devices
   ```

### Build and run

```bash
npm run build       # build web assets
npm run cap:sync    # copy assets into Android project + sync plugins
npx cap run android # select your device and deploy
```

### Fast local iteration (live reload)

Deploy to the phone **once**, then serve from the Vite dev server so JS/TS
changes hot-reload without rebuilding, syncing, or redeploying:

```bash
npm run dev           # terminal 1: start Vite on :3000 (leave running)
npm run dev:android   # terminal 2: deploy with live reload
```

`dev:android` runs `cap run android --live-reload --host localhost --port 3000
--forwardPorts 3000:3000`. The `--forwardPorts` flag runs `adb reverse` so the
phone loads `localhost:3000` tunneled through the ADB connection — no LAN IP to
configure and works on any network. Re-run it only when native plugins or
Capacitor config change.

**Wireless ADB** (Android 11+) avoids flaky USB cables. On the phone, enable
Developer Options → Wireless debugging, then:

```bash
adb pair <ip>:<pair-port>      # use the pairing code shown on the phone
adb connect <ip>:<connect-port>
```

The device then shows up for `cap run` with no cable attached.

**Side-by-side install:** the debug build uses `applicationIdSuffix ".debug"`
(see `android/app/build.gradle`), so it installs as a separate app and never
overwrites the Play Store release. Note: GPGS sign-in / AdMob don't work in the
debug variant since they're tied to the production package + signing key.

### Open in Android Studio

```bash
npm run cap:android
```
