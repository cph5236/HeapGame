/**
 * Separate entry from main.ts so the page chrome initialises even if the game
 * bundle is slow or fails outright — the rails and the Play link are the whole
 * point of the marketing page and should not depend on Phaser booting.
 */

import { initPageChrome } from './pageChrome';

initPageChrome();
