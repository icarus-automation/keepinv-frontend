import { OrgRole } from './types/organization.types';

/**
 * The user's role in the shop, title-cased for display. Null when they hold no membership
 * (e.g. the platform operator). Note this is the *org* role — never the platform-level
 * `AuthUser.role`, which says nothing about what someone may do inside a shop.
 */
export function orgRoleLabel(role: OrgRole | null | undefined): string | null {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'member':
      return 'Member';
    default:
      return null;
  }
}

/**
 * Up to two uppercase initials from an organization name, used as the logo
 * fallback wherever the org has no image set. Mirrors the user-avatar initials
 * pattern so the two read as a family.
 */
export function orgMonogram(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    return '·';
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || trimmed[0].toUpperCase();
}
