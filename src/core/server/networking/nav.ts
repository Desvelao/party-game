/** Top nav shared by the server-rendered pages; mirrors #topnav in the client (style.css). */
const LABELS = {
  en: { play: 'Play', rooms: 'Rooms', status: 'Status', profile: 'Profile' },
  es: { play: 'Jugar', rooms: 'Salas', status: 'Estado', profile: 'Perfil' },
  fr: { play: 'Jouer', rooms: 'Salons', status: 'État', profile: 'Profil' },
  de: { play: 'Spielen', rooms: 'Räume', status: 'Status', profile: 'Profil' },
  pt: { play: 'Jogar', rooms: 'Salas', status: 'Estado', profile: 'Perfil' },
  it: { play: 'Gioca', rooms: 'Stanze', status: 'Stato', profile: 'Profilo' },
};

export type NavPage = 'play' | 'rooms' | 'status' | 'profile';

export const NAV_CSS = `
:root{--bg:#1b1033;--panel:#2c1b52;--accent:#ffd23f}
body{padding-top:72px!important}
#topnav{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:12;display:flex;gap:8px;padding:6px;border:3px solid var(--accent);border-radius:16px;background:color-mix(in srgb,var(--panel) 92%,transparent);box-shadow:0 4px 0 rgba(0,0,0,.35)}
#topnav a{color:var(--accent);font:800 1rem ui-rounded,system-ui,sans-serif;text-decoration:none;padding:6px 14px;border-radius:10px}
#topnav a:hover,#topnav a:focus-visible,#topnav a[aria-current]{background:var(--accent);color:var(--bg);outline:none}
`;

export function navHtml(active: NavPage): string {
  const link = (page: NavPage, href: string) =>
    `<a data-nav="${page}" href="${href}"${page === active ? ' aria-current="page"' : ''}>${LABELS.en[page]}</a>`;
  return `<nav id="topnav">${link('play', '/')}${link('rooms', '/rooms')}${link('status', '/status')}${link('profile', '/profile')}</nav>`;
}

/** Applies the language the player picked in the game (same localStorage key as src/core/shared/i18n.ts). */
export const NAV_SCRIPT = `<script>try{var T=${JSON.stringify(LABELS)},l=localStorage.getItem('party-game:lang');if(l&&l!=='en'&&T[l]){document.documentElement.lang=l;document.querySelectorAll('#topnav a').forEach(function(a){a.textContent=T[l][a.dataset.nav]})}}catch(e){}</script>`;
