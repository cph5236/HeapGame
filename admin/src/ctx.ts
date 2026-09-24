// admin/src/ctx.ts
//
// What a view is handed when it renders.
//
// `alive()` turns false the moment the operator navigates away or switches
// environment. Every view checks it after each await, so a slow response from
// the environment you just left can never paint over the one you are now on.

export interface Ctx {
  root: HTMLElement;
  /** Path segments after the view name: `#/heaps/abc` → ['abc']. */
  params: string[];
  /** `#/players?tab=banned` → tab=banned. */
  query: URLSearchParams;
  alive(): boolean;
  /** Re-run the current view from scratch (e.g. after a write). */
  reload(): void;
  /** Change the hash route. */
  go(path: string): void;
}

export type View = (ctx: Ctx) => void | Promise<void>;
