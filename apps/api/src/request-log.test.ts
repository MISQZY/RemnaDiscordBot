import { describe, expect, it } from 'vitest';
import { requestLogPath } from './request-log.js';

describe('request log paths', () => {
  it('removes OAuth query values and webhook bearer credentials', () => {
    expect(requestLogPath('/v1/auth/callback?code=secret&state=nonce')).toBe('/v1/auth/callback');
    expect(requestLogPath('/v1/public/guilds/123/modules/notifications/hooks/sub/token-secret?event=push')).toBe(
      '/v1/public/guilds/123/modules/notifications/hooks/sub/[redacted]',
    );
  });
});
