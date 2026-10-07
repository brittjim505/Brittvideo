import type { Queryable } from '../../db/pool.js';
import type { Actor } from '../../auth/permissions.js';
import { requirePerm } from '../../auth/service.js';
import { OwnerError } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { money } from '../../lib/util.js';

export type Billing = 'one_time' | 'monthly';
export interface PriceItem { label: string; billing: Billing; amount_cents: number | null; description?: string }
export interface PackageDef { label: string; lines: string[]; summary: string; includes: string[] }
export type PackageCode = 'standard' | 'premier' | 'quick_video';
export const PACKAGE_ORDER: PackageCode[] = ['standard', 'premier', 'quick_video'];

/**
 * Owner-confirmed products (Jim, 2026-09-27; updated 2026-10-07):
 *  - Standard $597 one-time — five videos.
 *  - Premier $997 one-time + $149/month — the same five videos plus hosting, a monthly report and a fresh video each quarter.
 *  - One-Off Video $197 — one Quick Video for a single purpose.
 */
export const DEFAULT_ITEMS: Record<string, PriceItem> = {
  standard_kit: { label: 'Standard Video Kit', billing: 'one_time', amount_cents: 59700 },
  premier_kit: { label: 'Premier Video Kit', billing: 'one_time', amount_cents: 99700 },
  premier_membership: { label: 'Premier Membership', billing: 'monthly', amount_cents: 14900 },
  quick_video: { label: 'One-Off Video', billing: 'one_time', amount_cents: 19700 },
};

const KIT_INCLUDES = [
  'Website video up to 90 seconds — landscape, square or portrait, your choice',
  'Two social media videos: one portrait (9:16) and one landscape (16:9)',
  'A thank-you video for your customers',
  'A separate email video',
  'You own and can download your finished files',
];
export const DEFAULT_PACKAGES: Record<PackageCode, PackageDef> = {
  standard: {
    label: 'Standard', lines: ['standard_kit'],
    summary: 'Five custom videos for your business — one-time project price.',
    includes: KIT_INCLUDES,
  },
  premier: {
    label: 'Premier', lines: ['premier_kit', 'premier_membership'],
    summary: 'The same five videos plus ongoing hosting, reporting and a fresh video every quarter.',
    includes: [
      ...KIT_INCLUDES,
      'Vimeo Professional hosting while your membership is active',
      'Monthly usage and performance report',
      'One fresh custom video each quarter (up to 120 seconds)',
      'Cancel anytime — you keep your downloaded files; hosting stops',
    ],
  },
  quick_video: {
    label: 'One-Off Video', lines: ['quick_video'],
    summary: 'One custom video for a single purpose.',
    includes: [
      'One custom video, 15 to 120 seconds',
      'For one purpose: thank-you, follow-up, review or referral request, promotion, announcement, seasonal or email',
      'You own and can download your finished file',
    ],
  },
};

export async function ensureDefaultPriceBook(q: Queryable) {
  const r = await q.query(`SELECT * FROM price_book_versions ORDER BY version_no DESC LIMIT 1`);
  if (r.rowCount) {
    // Upgrade (2026-10-07): a price book from before the One-Off Video product gets a new version with the owner's
    // confirmed product list. Prices the owner changed are kept; past sales keep their prices either way.
    const cur = r.rows[0];
    if (cur.packages?.quick_video) return;
    const items = { ...cur.items, quick_video: { ...DEFAULT_ITEMS.quick_video, amount_cents: cur.items?.quick_video?.amount_cents ?? DEFAULT_ITEMS.quick_video.amount_cents } };
    await q.query(`INSERT INTO price_book_versions (version_no, items, packages, note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [cur.version_no + 1, JSON.stringify(items), JSON.stringify(DEFAULT_PACKAGES),
        'Products updated by owner (2026-10-07): Standard = five videos (website, social portrait, social landscape, thank-you, email); One-Off Video $197']);
    return;
  }
  await q.query(`INSERT INTO price_book_versions (version_no, items, packages, note) VALUES (1,$1,$2,$3) ON CONFLICT DO NOTHING`,
    [JSON.stringify(DEFAULT_ITEMS), JSON.stringify(DEFAULT_PACKAGES), 'Initial prices confirmed by owner: Standard $597; Premier $997 + $149/month; One-Off Video $197']);
}

export async function currentPriceBook(q: Queryable) {
  const v = (await q.query(`SELECT * FROM price_book_versions ORDER BY version_no DESC LIMIT 1`)).rows[0];
  if (!v) throw new OwnerError('Prices have not been set up yet. Open Settings → Pricing.', 409, 'no_price_book');
  return v as { id: string; version_no: number; items: Record<string, PriceItem>; packages: Record<PackageCode, PackageDef>; published_at: Date; note: string | null };
}

/** Prospect-safe package presentation: list prices and what's included only — no history, overrides or costs. */
export function publicPackages(pb: Awaited<ReturnType<typeof currentPriceBook>>) {
  return PACKAGE_ORDER.filter((c) => pb.packages[c]).map((code) => {
    const p = pb.packages[code];
    const lines = p.lines.map((l) => ({ code: l, label: pb.items[l].label, billing: pb.items[l].billing, amountCents: pb.items[l].amount_cents }));
    const oneTime = lines.filter((l) => l.billing === 'one_time').reduce((s, l) => s + (l.amountCents ?? 0), 0);
    const monthly = lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + (l.amountCents ?? 0), 0);
    const priceText = monthly ? `${money(oneTime)} + ${money(monthly)}/month` : `${money(oneTime)} one-time`;
    return { code, label: p.label, summary: p.summary, includes: p.includes, lines, oneTimeCents: oneTime, monthlyCents: monthly, priceText };
  });
}

/**
 * Publish new default prices (M7, V27). Creates a new version; every existing order keeps the prices it was sold at.
 */
export async function publishPriceBook(q: Queryable, actor: Actor, changes: Record<string, number | null>, note?: string) {
  requirePerm(actor, 'pricing', 'change default prices');
  const cur = await currentPriceBook(q);
  const items: Record<string, PriceItem> = JSON.parse(JSON.stringify(cur.items));
  const changed: string[] = [];
  for (const [code, cents] of Object.entries(changes)) {
    if (!items[code]) throw new OwnerError(`Unknown price item: ${code}`);
    if (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > 10_000_000)) throw new OwnerError('Prices must be whole cents between $0 and $100,000.');
    if (cents === null) throw new OwnerError(`${items[code].label} needs a price.`);
    if (items[code].amount_cents !== cents) { changed.push(`${items[code].label}: ${money(items[code].amount_cents)} → ${money(cents)}`); items[code].amount_cents = cents; }
  }
  if (!changed.length) throw new OwnerError('No prices were changed.');
  const v = (await q.query(`INSERT INTO price_book_versions (version_no, items, packages, note, published_by)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [cur.version_no + 1, JSON.stringify(items), JSON.stringify(cur.packages), note ?? null, actor.userId])).rows[0];
  await audit(q, actor, 'price_book.published', { type: 'price_book', id: v.id },
    `New default prices (version ${v.version_no}): ${changed.join('; ')}. Past sales keep their original prices.`, cur.items, items);
  return v;
}

export async function priceBookHistory(q: Queryable, actor: Actor) {
  requirePerm(actor, 'revenue', 'view pricing history');
  return (await q.query(`SELECT v.id, v.version_no, v.items, v.note, v.published_at, u.display_name AS published_by
    FROM price_book_versions v LEFT JOIN users u ON u.id=v.published_by ORDER BY version_no DESC`)).rows;
}
