import { App } from '@capacitor/app';
import { AudioManager } from './AudioManager';

export function installAudioFocusGuard(): void {
  // Native (Capacitor): fires reliably when activity is backgrounded/foregrounded
  // on Android, whereas the WebView's visibilitychange event is not guaranteed.
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) AudioManager.resumeAll();
    else AudioManager.pauseAll();
  }).catch(() => { /* web build: plugin not registered, ignore */ });

  // Web fallback (also catches OS focus changes on native that fire visibilitychange).
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') AudioManager.pauseAll();
      else AudioManager.resumeAll();
    });
  }
}
