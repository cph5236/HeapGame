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

### Live reload (faster iteration)

Serves from the Vite dev server so changes reflect instantly without rebuilding:
```bash
npx cap run android --livereload --external
```

### Open in Android Studio

```bash
npm run cap:android
```
