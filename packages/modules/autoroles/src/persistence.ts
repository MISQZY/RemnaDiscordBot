import type { AutorolesConfig } from './config.js';

/** Roles kept when a member leaves and restored when they come back. */
export function persistedRoles(roleIds: readonly string[], persistence: AutorolesConfig['persistence']): string[] {
  const listed = new Set(persistence.roleIds);
  switch (persistence.mode) {
    case 'all':
      return [...roleIds];
    case 'whitelist':
      return roleIds.filter((id) => listed.has(id));
    case 'blacklist':
      return roleIds.filter((id) => !listed.has(id));
  }
}
