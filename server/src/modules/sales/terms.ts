import type { PackageCode } from '../pricing/service.js';

/**
 * Plain-language service terms shown at signup (M10). The exact text accepted, its version and its SHA-256 are stored
 * with every agreement. NOTE FOR OWNER REVIEW: this is a starting draft written from the approved business rules —
 * have it reviewed before live use. Changing the text creates a new TERMS_VERSION; past agreements keep their text.
 */
export const TERMS_VERSION = '2026-09-27.draft-1';

export function termsText(pkg: PackageCode, priceText: string): string {
  const common = [
    `BrittVideo — ${pkg === 'premier' ? 'Premier' : 'Standard'} Service Agreement (terms version ${TERMS_VERSION})`,
    '',
    `Price: ${priceText}.`,
    'What you receive: a custom website video of up to 120 seconds; social versions in Landscape 16:9, Vertical 9:16 and Square 1:1; and a separate Email Video.',
    'Your approval: BrittVideo shows you the script and scenes for approval. Nothing is produced as final without your approval.',
    'Your content: you confirm you have the right to let BrittVideo use the website text, images and logos you provide or that appear on your website.',
    'Ownership: once paid in full and delivered, you own and may download your finished video files.',
    'Examples: BrittVideo will not use your videos as public examples without your separate permission.',
    'Communication: BrittVideo will send service messages about your project. You may also receive occasional helpful updates; every such message has an easy unsubscribe.',
  ];
  if (pkg === 'premier') common.push(
    'Premier membership: billed monthly while active. Includes Vimeo Professional hosting while active, a monthly usage and performance report, and one fresh custom video each quarter (up to 120 seconds).',
    'Cancel anytime: when you cancel, hosting stops at the end of the paid period. You keep all files you have downloaded. Cancellation does not erase your history.',
  );
  return common.join('\n');
}
