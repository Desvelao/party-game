// Server half of the transfer plugin: one-time codes that hand a profile key to another device.
//   POST /api/transfer  { key }       -> { code, expiresIn }   (the key is the caller's own profile key)
//   GET  /api/transfer?code=...       -> { key }               (the code is burnt)
import { apiLimiter } from '../../../core/shared/kit/ratelimit';
import type { PluginHttpRequest, PluginHttpResponse, ServerPlugin } from '../../../core/shared';
import { TRANSFER_TTL_MS, TransferCodes } from './codes';

/** the shape of a profile key (a plugin may not import the core's own copy) */
const PROFILE_KEY_RE = /^[0-9a-f]{32,64}$/;

let codes = new TransferCodes();
const limiter = apiLimiter();

export function handle(req: PluginHttpRequest): PluginHttpResponse | undefined {
  if (req.kind !== 'api' || req.path !== '/') return undefined;
  if (!limiter.allow(req.ip)) return { status: 429, body: { error: 'rate limited' } };
  if (req.method === 'POST') {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!PROFILE_KEY_RE.test(key)) return { status: 401, body: { error: 'missing or invalid profile key' } };
    const code = codes.issue(key);
    if (!code) return { status: 503, body: { error: 'try again later' } };
    return { status: 200, body: { code, expiresIn: TRANSFER_TTL_MS / 1000 } };
  }
  if (req.method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
  const key = codes.redeem(req.query.code ?? '');
  if (!key) return { status: 404, body: { error: 'unknown or expired code' } };
  return { status: 200, body: { key } };
}

const plugin: ServerPlugin = {
  start() {
    codes = new TransferCodes();
    limiter.clear();
  },
  http: handle,
};
export default plugin;
