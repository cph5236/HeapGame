// src/systems/hotbarLayout.ts

/** Tray dimension constants (logical px). */
export const HOTBAR = {
  slotW: 64, slotH: 58, slotGap: 7, slotStride: 71,   // stride = slotW + slotGap
  headerH: 22, padX: 11, padTop: 8, padBottom: 11,
  scrollBtnW: 26, scrollBtnGap: 7,
  bottomMargin: 80,        // panel bottom edge = gameHeight - bottomMargin
  cornerRadius: 12,
  slotRadius: 9,
  stripeH: 6,
} as const;

export interface HotbarLayoutParams {
  gameWidth:    number;
  gameHeight:   number;
  ownedCount:   number;
  scrollOffset: number;
}

export interface HotbarLayout {
  panelCx: number; panelCy: number; panelW: number; panelH: number;
  headerCy: number;            // y-center for the BACKPACK title
  slotCy:   number;            // y-center of the slot row
  slotCxs:  number[];          // x-center per visible slot (left→right)
  visibleCount: number;
  scrollOffset: number;        // clamped to a valid page
  showLeft: boolean; showRight: boolean;
  leftBtnCx: number; rightBtnCx: number;
}

/** Max slots that fit, always reserving room for both scroll buttons so the
 *  layout width stays stable whether or not arrows are currently shown. */
function maxVisible(gameWidth: number): number {
  const reserved = 2 * HOTBAR.padX + 2 * (HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap);
  const avail = gameWidth - reserved + HOTBAR.slotGap; // +gap: last slot has no trailing gap
  return Math.max(1, Math.floor(avail / HOTBAR.slotStride));
}

export function computeHotbarLayout(p: HotbarLayoutParams): HotbarLayout {
  const mv          = maxVisible(p.gameWidth);
  const needsScroll = p.ownedCount > mv;
  const maxOffset   = Math.max(0, p.ownedCount - mv);
  const scrollOffset = Math.min(Math.max(0, p.scrollOffset), maxOffset);
  const visibleCount = Math.min(p.ownedCount, mv);

  const scrollSpace = needsScroll ? 2 * (HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap) : 0;
  const slotsW      = Math.max(0, visibleCount * HOTBAR.slotStride - HOTBAR.slotGap);
  const panelW      = Math.min(slotsW + 2 * HOTBAR.padX + scrollSpace, p.gameWidth - 10);
  const panelH      = HOTBAR.headerH + HOTBAR.padTop + HOTBAR.slotH + HOTBAR.padBottom;

  const panelCx = p.gameWidth / 2;
  const panelBottom = p.gameHeight - HOTBAR.bottomMargin;
  const panelTop    = panelBottom - panelH;
  const panelCy     = panelTop + panelH / 2;

  const headerCy = panelTop + HOTBAR.headerH / 2;
  const slotCy   = panelTop + HOTBAR.headerH + HOTBAR.padTop + HOTBAR.slotH / 2;

  const leftEdge   = panelCx - panelW / 2;
  const rightEdge  = panelCx + panelW / 2;
  const startX = leftEdge + HOTBAR.padX
    + (needsScroll ? HOTBAR.scrollBtnW + HOTBAR.scrollBtnGap : 0)
    + HOTBAR.slotW / 2;

  const slotCxs: number[] = [];
  for (let i = 0; i < visibleCount; i++) slotCxs.push(startX + i * HOTBAR.slotStride);

  return {
    panelCx, panelCy, panelW, panelH, headerCy, slotCy, slotCxs,
    visibleCount, scrollOffset,
    showLeft:  needsScroll && scrollOffset > 0,
    showRight: needsScroll && scrollOffset < maxOffset,
    leftBtnCx:  leftEdge + HOTBAR.padX + HOTBAR.scrollBtnW / 2,
    rightBtnCx: rightEdge - HOTBAR.padX - HOTBAR.scrollBtnW / 2,
  };
}
