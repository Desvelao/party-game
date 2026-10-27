import { readFileSync } from 'node:fs';
import type { ServerConfig } from '../config';

export interface TlsFiles {
  cert: Buffer;
  key: Buffer;
}

/**
 * The certificate and key to serve HTTPS with, or null for plain HTTP (neither is set). Setting only one of
 * the two, or pointing at a file that cannot be read, is an error: the server must not quietly fall back to
 * HTTP when the operator asked for TLS.
 */
export function tlsFiles(cfg: Pick<ServerConfig, 'tlsCert' | 'tlsKey'>): TlsFiles | null {
  if (!cfg.tlsCert && !cfg.tlsKey) return null;
  if (!cfg.tlsCert || !cfg.tlsKey) throw new Error('TLS needs both server.tlsCert (TLS_CERT) and server.tlsKey (TLS_KEY); only one is set');
  const read = (what: string, file: string): Buffer => {
    try {
      return readFileSync(file);
    } catch (err) {
      throw new Error(`cannot read the TLS ${what} file ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    }
  };
  return { cert: read('certificate', cfg.tlsCert), key: read('key', cfg.tlsKey) };
}
