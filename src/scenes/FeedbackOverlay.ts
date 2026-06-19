import { submitFeedback } from '../systems/FeedbackClient';
import type { FeedbackCategory } from '../../shared/feedbackTypes';

export interface FeedbackOverlayOpts {
  heapId: string | null;
  /** Called after the overlay is removed (re-enable menu input). */
  onClose: () => void;
}

const MAX_LEN = 3000;

/** Opens a DOM feedback modal over the game canvas. Self-contained lifecycle. */
export function openFeedbackOverlay(opts: FeedbackOverlayOpts): void {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  let category: FeedbackCategory = 'bug';

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
    'display:flex', `align-items:${isMobile ? 'flex-start' : 'center'}`, 'justify-content:center',
    'z-index:9999', 'font-family:monospace', isMobile ? 'padding-top:6vh' : '',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#0d0d20', 'border:2px solid #4488ff', 'border-radius:12px',
    'padding:24px 22px 20px', 'text-align:center', 'width:320px',
    'box-shadow:0 0 32px rgba(68,136,255,0.18)', 'box-sizing:border-box',
  ].join(';');

  const heading = document.createElement('div');
  heading.style.cssText = 'color:#4488ff;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:14px';
  heading.textContent = 'SEND FEEDBACK';

  // ── Category toggle ──────────────────────────────────────────────────────
  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
  const mkTab = (label: string, value: FeedbackCategory) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'flex:1', 'padding:9px 0', 'border-radius:8px', 'border:2px solid #4488ff',
      'font-family:monospace', 'font-size:13px', 'font-weight:bold', 'cursor:pointer',
    ].join(';');
    b.addEventListener('click', () => { category = value; paintTabs(); });
    return b;
  };
  const bugTab = mkTab('🐛 Bug', 'bug');
  const ideaTab = mkTab('💡 Suggestion', 'suggestion');
  const paintTabs = () => {
    for (const [b, v] of [[bugTab, 'bug'], [ideaTab, 'suggestion']] as const) {
      const active = category === v;
      b.style.background = active ? '#4488ff' : 'transparent';
      b.style.color = active ? '#0a0818' : '#6699cc';
    }
  };
  paintTabs();
  toggleRow.append(bugTab, ideaTab);

  // ── Message textarea ─────────────────────────────────────────────────────
  const textarea = document.createElement('textarea');
  textarea.maxLength = MAX_LEN;
  textarea.rows = 5;
  textarea.placeholder = 'What happened? What would you change?';
  textarea.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'background:#060612',
    'border:1px solid #335', 'border-radius:8px', 'color:#fff', 'font-size:14px',
    'font-family:monospace', 'padding:10px', 'outline:none', 'resize:vertical',
    'margin-bottom:6px',
  ].join(';');

  const counter = document.createElement('div');
  counter.style.cssText = 'color:#556677;font-size:11px;text-align:right;margin-bottom:10px';
  const paintCounter = () => { counter.textContent = `${textarea.value.trim().length} / ${MAX_LEN}`; };
  paintCounter();

  const msg = document.createElement('div');
  msg.style.cssText = 'min-height:16px;font-size:12px;margin-bottom:12px;color:#88aacc';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'SEND';
  sendBtn.style.cssText = [
    'width:100%', 'padding:13px', 'background:#4488ff', 'border:none',
    'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
    'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
  ].join(';');

  const cancelEl = document.createElement('div');
  cancelEl.textContent = 'close';
  cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

  panel.append(heading, toggleRow, textarea, counter, msg, sendBtn, cancelEl);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = (): void => {
    if (overlay.parentNode) document.body.removeChild(overlay);
    opts.onClose();
  };

  // Submit is disabled while the trimmed message is empty.
  const refreshEnabled = (): void => {
    const empty = textarea.value.trim().length === 0;
    sendBtn.disabled = empty;
    sendBtn.style.opacity = empty ? '0.5' : '1';
    sendBtn.style.cursor = empty ? 'default' : 'pointer';
  };
  refreshEnabled();

  let busy = false;
  const submit = async (): Promise<void> => {
    if (busy || textarea.value.trim().length === 0) return;
    busy = true;
    sendBtn.disabled = true;
    msg.style.color = '#88aacc';
    msg.textContent = 'Sending…';
    const result = await submitFeedback(category, textarea.value, opts.heapId);
    if (result.status === 'success') {
      msg.style.color = '#88ff88';
      msg.textContent = result.message;
      setTimeout(close, 900);
    } else {
      msg.style.color = '#ff9988';
      msg.textContent = result.message;
      busy = false;
      refreshEnabled();
    }
  };

  textarea.addEventListener('input', () => { paintCounter(); refreshEnabled(); });
  sendBtn.addEventListener('click', () => void submit());
  cancelEl.addEventListener('click', close);
  overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) close(); });

  requestAnimationFrame(() => textarea.focus());
}
