import { describe, expect, it } from 'vitest';
import { LANGS } from '../../shared';
import { NAV_SCRIPT, navHtml } from './nav';

describe('server page nav', () => {
  it('ships its labels in every language of the game', () => {
    for (const lang of LANGS) expect(NAV_SCRIPT, lang).toContain(`"${lang}":{`);
  });

  it('renders the English nav and marks the active page', () => {
    const html = navHtml('rooms');
    expect(html).toContain('data-nav="rooms" href="/rooms" aria-current="page">Rooms</a>');
  });
});
