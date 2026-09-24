import { describe, it, expect } from 'vitest';
import { html, raw } from '../ui';

describe('html', () => {
  it('escapes every interpolation by default', () => {
    const name = '<img src=x onerror=alert(1)>"\'&';
    expect(html`<b title="${name}">${name}</b>`.s).toBe(
      '<b title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</b>');
  });

  it('passes nested html and raw() through unescaped, and flattens arrays', () => {
    const items = ['<a>', '<b>'].map((x) => html`<li>${x}</li>`);
    expect(html`<ul>${items}</ul>${raw('<hr>')}`.s).toBe('<ul><li>&lt;a&gt;</li><li>&lt;b&gt;</li></ul><hr>');
  });

  it('renders null, undefined and false as nothing, but keeps 0', () => {
    expect(html`${null}${undefined}${false}${0}`.s).toBe('0');
  });
});
