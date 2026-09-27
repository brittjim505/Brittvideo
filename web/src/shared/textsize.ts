import { local } from './api';
/** Owner-chosen text size (Normal / Large / Extra Large). Remembered on this device; Large by default. */
export const SIZES = [{ key: 'normal', label: 'A', zoom: 1 }, { key: 'large', label: 'A+', zoom: 1.15 }, { key: 'xl', label: 'A++', zoom: 1.3 }] as const;
export type SizeKey = (typeof SIZES)[number]['key'];
export function currentSize(): SizeKey { const v = local.get('bv-text-size'); return (SIZES.some((s) => s.key === v) ? v : 'large') as SizeKey; }
export function applySize(k: SizeKey = currentSize()) {
  const z = SIZES.find((s) => s.key === k)!.zoom;
  (document.documentElement.style as any).zoom = String(z);
  local.set('bv-text-size', k);
}
