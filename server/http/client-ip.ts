/**
 * The address a public endpoint limits by (readiness review 2026-10-07).
 *
 * It used to be the first `X-Forwarded-For` value, which the client writes
 * itself: every request could pick a new address and so pass every per-address
 * limit. Now the peer is the socket's address (the Node adapter passes the
 * incoming request as `c.env.incoming`); `X-Forwarded-For` and `X-Real-IP`
 * count only when that peer is one of `publicEndpoints.trustedProxies`, and
 * then the right-most address that is not itself a trusted proxy is the
 * client (the left-most values are whatever the client sent).
 *
 * Without a socket (an embedded host, or `app.request()` in tests) the
 * address is `unknown`, one shared bucket: limits then hold for everyone
 * rather than for no one.
 */
import { BlockList, isIP } from 'node:net';

import type { Context } from 'hono';

export const UNKNOWN_CLIENT = 'unknown';

/** Strips the IPv4-mapped IPv6 prefix and an IPv6 zone. */
function normalize(address: string | undefined): string | null {
  if (!address) return null;
  let value = address.trim();
  if (value.startsWith('[') && value.includes(']'))
    value = value.slice(1, value.indexOf(']'));
  value = value.replace(/%.*$/u, '');
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/iu.test(value)) value = value.slice(7);
  return isIP(value) ? value : null;
}

/** A matcher for addresses and CIDR ranges; invalid entries are ignored. */
export function trustedProxyMatcher(
  entries: readonly string[],
): (address: string) => boolean {
  const list = new BlockList();
  let any = false;
  for (const raw of entries) {
    const [base = '', prefix] = raw.trim().split('/');
    const address = normalize(base);
    if (!address) continue;
    const type = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, type);
    else {
      const bits = Number(prefix);
      if (
        !Number.isInteger(bits) ||
        bits < 0 ||
        bits > (type === 'ipv6' ? 128 : 32)
      )
        continue;
      list.addSubnet(address, bits, type);
    }
    any = true;
  }
  if (!any) return () => false;
  return (address) => {
    const value = normalize(address);
    if (!value) return false;
    return list.check(value, isIP(value) === 6 ? 'ipv6' : 'ipv4');
  };
}

/** The socket peer of a request served by the Node adapter. */
export function peerAddress(c: Context): string | null {
  const env = c.env as
    { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return normalize(env?.incoming?.socket?.remoteAddress);
}

/** The client's address as the per-address limits see it. */
export function clientIp(
  c: Context,
  trusted: (address: string) => boolean,
): string {
  const peer = peerAddress(c);
  if (!peer) return UNKNOWN_CLIENT;
  if (!trusted(peer)) return peer;
  const forwarded = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => normalize(part))
    .filter((part): part is string => Boolean(part));
  for (let i = forwarded.length - 1; i >= 0; i--)
    if (!trusted(forwarded[i])) return forwarded[i];
  // Every hop is a trusted proxy (or there is no list): X-Real-IP, then the left-most hop, then the proxy.
  return normalize(c.req.header('x-real-ip')) ?? forwarded[0] ?? peer;
}

/** `clientIp` bound to `publicEndpoints.trustedProxies` of the application's configuration. */
export function clientIpResolver(config: {
  get<T>(path: string): T | undefined;
}): (c: Context) => string {
  const trusted = trustedProxyMatcher(
    config.get<readonly string[]>('publicEndpoints.trustedProxies') ?? [],
  );
  return (c) => clientIp(c, trusted);
}
