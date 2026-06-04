/// <reference types="vite/client" />

interface Window {
  // Injected per page-load by the dev-build-id Vite plugin (dev server only).
  __BUILD_ID__?: string;
}
