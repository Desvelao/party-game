// Interface half of the transfer plugin: the "show QR / transfer code" block in the profile, and the way to adopt a
// profile from a transfer code or a #transfer=<code> link.
import type { ClientPlugin } from '../../../core/client/src/plugins/features';

/** the shape of a profile key (a plugin may not import the core's own copy) */
const PROFILE_KEY_RE = /^[0-9a-f]{32,64}$/;
const CODE_RE = /^[A-Z0-9]{8}$/;

/** The 8 characters of a code from "abcd-2345", "ABCD2345" or a link ending in #transfer=ABCD2345; null for anything else. */
export function codeFrom(raw: string): string | null {
  let s = raw.trim();
  const m = /#transfer=([^&\s]+)/.exec(s);
  if (m) s = m[1];
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(code) ? code : null;
}

const plugin: ClientPlugin = {
  profileSection(ctx) {
    const result = ctx.h('div', { role: 'status' });
    return ctx.h(
      'div',
      {},
      ctx.h(
        'ol',
        { class: 'hint' },
        ctx.h('li', {}, ctx.tr('On the device that has your profile: tap "Show QR / transfer code" (or "Copy recovery link").')),
        ctx.h('li', {}, ctx.tr('On the new device: scan the QR with the camera, or open the copied link. Or open this page, tap "Use another code" and paste the transfer code, link or profile code.')),
        ctx.h('li', {}, ctx.tr('You will land on your profile with your name, look and stats. The old device keeps working too.')),
      ),
      ctx.h('p', { class: 'hint' }, ctx.tr('The QR / transfer code works once, for a few minutes.')),
      ctx.h(
        'button',
        {
          class: 'btn small alt',
          onClick: async () => {
            try {
              const res = await fetch('/api/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ctx.profileKey }) });
              if (!res.ok) throw new Error(`transfer ${res.status}`);
              const { code, expiresIn } = (await res.json()) as { code: string; expiresIn: number };
              const qr = ctx.qr(`${location.origin}/#transfer=${code}`);
              result.replaceChildren(
                ...(qr ? [qr] : []),
                ctx.h('p', { class: 'sub' }, ctx.tr('Transfer code: {code}').replace('{code}', `${code.slice(0, 4)}-${code.slice(4)}`)),
                ctx.h('p', { class: 'hint' }, ctx.tr('Single use, valid for {min} minutes').replace('{min}', String(Math.round(expiresIn / 60)))),
              );
            } catch {
              result.replaceChildren(ctx.h('p', { class: 'err', role: 'alert' }, ctx.tr('Could not create a transfer code')));
            }
          },
        },
        ctx.tr('Show QR / transfer code'),
      ),
      result,
    );
  },

  recoveryInput: {
    hash: 'transfer',
    async resolve(raw) {
      const code = codeFrom(raw);
      if (!code) return null;
      const res = await fetch(`/api/transfer?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const body = (await res.json()) as { key?: string };
      return typeof body.key === 'string' && PROFILE_KEY_RE.test(body.key) ? body.key : null;
    },
  },
};
export default plugin;
