/** Request paths safe for logs and error messages: query credentials and webhook tokens are omitted. */
export function requestLogPath(url: string): string {
  return url.split('?')[0]!.replace(/(\/hooks\/[^/]+\/)[^/]+/g, '$1[redacted]');
}
