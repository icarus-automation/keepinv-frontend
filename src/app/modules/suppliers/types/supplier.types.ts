/** A vendor the shop buys stock from. Master data; products link to it later via supplierId. */
export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating or updating a supplier. */
export interface SupplierRequest {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

/** Contact platforms a supplier link can use. Mirrors the backend `SupplierPlatform` enum. */
export type SupplierPlatform =
  | 'MESSENGER'
  | 'VIBER'
  | 'SHOPEE'
  | 'LAZADA'
  | 'ALIBABA'
  | 'FACEBOOK'
  | 'WEBSITE'
  | 'OTHER';

/** A saved contact channel for a supplier (Messenger, Facebook, ...): the reorder shortcut. */
export interface SupplierLink {
  id: string;
  supplierId: string;
  platform: SupplierPlatform;
  url: string;
  label: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating or updating a supplier link. */
export interface SupplierLinkRequest {
  platform: SupplierPlatform;
  url: string;
  label?: string;
}

/** A selectable contact platform with its display icon. */
export interface PlatformOption {
  readonly label: string;
  readonly value: SupplierPlatform;
  /** PrimeIcons class, e.g. `pi pi-facebook`. */
  readonly icon: string;
}

/**
 * Known platforms offered in the channel picker. Mirrors the backend
 * `SupplierPlatform` enum. The resolver (`platformMeta`) still tolerates
 * unknown values gracefully should the enum grow.
 */
export const SUPPLIER_PLATFORMS: readonly PlatformOption[] = [
  { label: 'Messenger', value: 'MESSENGER', icon: 'pi pi-comments' },
  { label: 'Viber', value: 'VIBER', icon: 'pi pi-comment' },
  { label: 'Shopee', value: 'SHOPEE', icon: 'pi pi-shopping-bag' },
  { label: 'Lazada', value: 'LAZADA', icon: 'pi pi-shopping-cart' },
  { label: 'Alibaba', value: 'ALIBABA', icon: 'pi pi-building' },
  { label: 'Facebook', value: 'FACEBOOK', icon: 'pi pi-facebook' },
  { label: 'Website', value: 'WEBSITE', icon: 'pi pi-globe' },
  { label: 'Other', value: 'OTHER', icon: 'pi pi-link' },
];

/**
 * Best-guess the platform from a pasted link's host so the operator rarely has to
 * pick it by hand (the fast path stays the correct path). Returns `null` for
 * anything that isn't a parseable http(s) URL, so the picker simply stays empty
 * until the link is valid. A recognised store/app wins; any other valid URL
 * resolves to `WEBSITE`. Shared by the supplier channel picker and the product
 * reorder-link field (re-exported there as `detectReorderPlatform`).
 */
export function detectSupplierPlatform(rawUrl: string): SupplierPlatform | null {
  const value = rawUrl.trim();
  if (!value) {
    return null;
  }
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('shopee')) return 'SHOPEE';
  if (host.includes('lazada')) return 'LAZADA';
  if (host.includes('alibaba') || host.includes('aliexpress') || host.endsWith('1688.com')) return 'ALIBABA';
  if (host.includes('viber')) return 'VIBER';
  if (host === 'm.me' || host.includes('messenger.')) return 'MESSENGER';
  if (host.includes('facebook.') || host === 'fb.com' || host === 'fb.me') return 'FACEBOOK';
  return 'WEBSITE';
}

/** Resolve a platform value to its label + icon, tolerating values the API may add later. */
export function platformMeta(value: SupplierPlatform): PlatformOption {
  const known = SUPPLIER_PLATFORMS.find((platform) => platform.value === value);
  if (known) {
    return known;
  }
  const label = value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
  return { label: label || 'Link', value, icon: 'pi pi-link' };
}
