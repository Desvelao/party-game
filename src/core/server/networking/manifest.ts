/** Web app manifest: what a browser needs to offer "install". Built per request so the name follows `branding.name`. */
export function webManifest(brandName: string) {
  return {
    id: '/',
    name: brandName,
    short_name: brandName.length > 12 ? brandName.slice(0, 12).trimEnd() : brandName,
    description: 'Party game for browsers: phones are the controllers.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1b1033',
    theme_color: '#1b1033',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
