import { describe, expect, it } from 'vitest';
import { authenticateClient, clientRedirect, parseLinkClients } from './link-clients.js';

const SECRET = 'a'.repeat(32);

describe('parseLinkClients', () => {
  it('reads id, secret and a callback URL with its own colons', () => {
    expect(parseLinkClients(`remnaweb:${SECRET}:https://web.example.com:8443/api/discord/link/callback`)).toEqual([
      { id: 'remnaweb', secret: SECRET, callbackUrl: 'https://web.example.com:8443/api/discord/link/callback' },
    ]);
  });

  it('reads several clients and nothing from an empty value', () => {
    expect(parseLinkClients(`a1:${SECRET}:https://a.test/cb, b2:${SECRET}:http://b.test/cb`)).toHaveLength(2);
    expect(parseLinkClients(undefined)).toEqual([]);
    expect(parseLinkClients('  ')).toEqual([]);
  });

  it('refuses short secrets and bad URLs', () => {
    expect(() => parseLinkClients('remnaweb:short:https://a.test/cb')).toThrow(/secret/);
    expect(() => parseLinkClients(`remnaweb:${SECRET}:javascript:alert(1)`)).toThrow(/URL/);
    expect(() => parseLinkClients(`Bad Id:${SECRET}:https://a.test/cb`)).toThrow(/id/);
  });
});

describe('authenticateClient', () => {
  const clients = parseLinkClients(`remnaweb:${SECRET}:https://a.test/cb`);
  const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;

  it('accepts the right secret only', () => {
    expect(authenticateClient(clients, basic(`remnaweb:${SECRET}`))?.id).toBe('remnaweb');
    expect(authenticateClient(clients, basic('remnaweb:wrong'))).toBeNull();
    expect(authenticateClient(clients, basic(`other:${SECRET}`))).toBeNull();
    expect(authenticateClient(clients, `Bearer ${SECRET}`)).toBeNull();
    expect(authenticateClient(clients, undefined)).toBeNull();
  });
});

describe('clientRedirect', () => {
  it('keeps the callback query and adds parameters', () => {
    const [client] = parseLinkClients(`remnaweb:${SECRET}:https://a.test/cb?from=bot`);
    expect(clientRedirect(client!, { code: 'c', state: 's' })).toBe('https://a.test/cb?from=bot&code=c&state=s');
  });
});
