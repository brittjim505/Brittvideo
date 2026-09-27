import { HOOKS } from './templates.js';

/**
 * Script writers. Both produce the same structure; both may only use the owner-approved facts they are given.
 *  - TemplateWriter: built in, deterministic, no cost. Narration is built from the facts' own words.
 *  - ClaudeWriter: optional (needs an Anthropic API key in Settings → Integrations). Every factual scene must cite
 *    the fact ids it uses; any answer that cites unknown facts, has the wrong shape or wrong scene counts is rejected
 *    and BrittVideo falls back to the TemplateWriter. The owner approves everything either way.
 */
export interface WriterFact { id: string; text: string }
export interface WriterImage { id: string; title: string; alt?: string | null }
export interface WriterInput {
  businessName: string; industry: string; businessType?: string | null; story: string; tone: string; websiteUrl?: string | null;
  facts: WriterFact[]; images: WriterImage[]; websiteSecs: number;
}
export interface SceneDraft { name: string; start_s: number; end_s: number; visual: string; narration: string; factIds: string[]; imageId: string | null }
export interface KitDraft { website: SceneDraft[]; social_a: SceneDraft[]; social_b: SceneDraft[]; email: SceneDraft[]; writtenBy: string; note?: string }

export const SCENE_SECONDS = 5;
export const sceneCounts = (websiteSecs: number) => ({ website: Math.max(1, Math.ceil(websiteSecs / SCENE_SECONDS)), social_a: 6, social_b: 6, email: 3 });

const WORDS_PER_SCENE = 16;
/** Split facts into speakable phrases of about one scene each, keeping the source's own words. */
export function phrases(facts: WriterFact[]) {
  const out: { text: string; factId: string }[] = [];
  for (const f of facts) {
    const parts = f.text.replace(/\s+/g, ' ').split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const w = p.split(' ');
      if (w.length <= WORDS_PER_SCENE + 4) { out.push({ text: p, factId: f.id }); continue; }
      // Long sentence: break at commas, never mid-clause.
      let cur = '';
      for (const clause of p.split(/,\s+/)) {
        const cand = cur ? cur + ', ' + clause : clause;
        if (cand.split(' ').length > WORDS_PER_SCENE + 4 && cur) { out.push({ text: cur.replace(/[,;]$/, '') + '.', factId: f.id }); cur = clause; } else cur = cand;
      }
      if (cur) out.push({ text: /[.!?]$/.test(cur) ? cur : cur + '.', factId: f.id });
    }
  }
  return out.map((p) => ({ ...p, text: p.text.charAt(0).toUpperCase() + p.text.slice(1) }));
}

/** Pick the best-matching image for a line; avoid repeating the previous image; never invent one. */
export function pickImage(text: string, images: WriterImage[], prev: string | null, i: number): string | null {
  if (!images.length) return null;
  const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  let best: WriterImage | null = null, bestScore = 0;
  for (const im of images) {
    if (im.id === prev && images.length > 1) continue;
    const s = ((im.title + ' ' + (im.alt ?? '')).toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
    if (s > bestScore) { best = im; bestScore = s; }
  }
  if (best) return best.id;
  const pool = images.filter((im) => im.id !== prev);
  return (pool.length ? pool : images)[i % (pool.length || images.length)].id;
}

function visualFor(role: 'opening' | 'moment' | 'closing' | 'hook', imageTitle: string | null, vertical: boolean) {
  const subject = imageTitle ? `the approved image “${imageTitle}”` : 'approved client imagery';
  const frame = vertical ? ' Keep the subject centered so the 16:9, 9:16 and 1:1 versions all crop cleanly.' : '';
  if (role === 'opening') return `Slow establishing push-in using ${subject}; warm, natural light; one continuous shot; no on-screen text.${frame}`;
  if (role === 'hook') return `Attention-grabbing first frame built from ${subject}; gentle movement; leave clean space for a caption added in editing.${frame}`;
  if (role === 'closing') return `Closing hero view using ${subject} with a slow pull-back; clean space for logo and call to action added in editing.${frame}`;
  return `Gentle, authentic moment using ${subject} as the reference; subtle camera movement; one continuous shot.${frame}`;
}

const WEAK_END = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'for', 'with', 'from', 'in', 'on', 'at', 'by', 'since', 'our', 'your', 'their', 'is', 'are', 'has', 'have', 'that', 'who', 'every', 'each', 'offers', 'provides', 'gives', 'includes', 'features', 'makes', 'helps']);
/** A short readable scene title: up to 5 words, cut at a comma, never ending on a dangling word like "of" or "since". */
export function sceneTitle(text: string): string {
  const head = text.split(/[,;:—–(]/)[0].replace(/[.!?]+$/, '').trim();
  const w = head.split(/\s+/).slice(0, 5);
  while (w.length > 2 && WEAK_END.has(w[w.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) w.pop();
  return w.join(' ').replace(/[.,;:]$/, '');
}

export function templateWriter(inp: WriterInput): KitDraft {
  const counts = sceneCounts(inp.websiteSecs);
  const hooks = HOOKS[inp.industry] ?? HOOKS.other;
  const lines = phrases(inp.facts);
  const imgTitle = (id: string | null) => inp.images.find((i) => i.id === id)?.title ?? null;
  const build = (n: number, opts: { opening?: string; hook?: string; closing: string; vertical: boolean; startAt: number }): SceneDraft[] => {
    const scenes: SceneDraft[] = [];
    let li = opts.startAt, prev: string | null = null;
    // Spread any picture-only moments evenly between spoken scenes instead of bunching them at the end.
    const middle = Math.max(0, n - 2);
    const spoken = Math.min(middle, Math.max(0, lines.length - (opts.hook ? 0 : 1)));
    const speaks = (j: number) => middle > 0 && Math.floor((j + 1) * spoken / middle) > Math.floor(j * spoken / middle);
    for (let i = 0; i < n; i++) {
      const first = i === 0, last = i === n - 1 && n > 1;
      let narration = '', factIds: string[] = [], role: 'opening' | 'moment' | 'closing' | 'hook' = 'moment', name = '';
      if (first && opts.hook) { narration = opts.hook; role = 'hook'; name = 'The Hook'; }
      else if (first) {
        const l = lines.length ? lines[li++ % lines.length] : null;
        narration = `Welcome to ${inp.businessName}.` + (l ? ' ' + l.text : ''); factIds = l ? [l.factId] : []; role = 'opening'; name = 'Welcome';
      } else if (last) { narration = `${inp.businessName}. ${opts.closing}`; role = 'closing'; name = 'Next Step'; }
      else if (lines.length && speaks(i - 1)) {
        const l = lines[li++ % lines.length]; narration = l.text; factIds = [l.factId];
        name = sceneTitle(l.text);
      } else { narration = ''; name = 'Visual Moment'; }
      const imageId = pickImage(narration, inp.images, prev, i); prev = imageId;
      scenes.push({ name, start_s: i * SCENE_SECONDS, end_s: (i + 1) * SCENE_SECONDS, narration, factIds,
        visual: narration ? visualFor(role, imgTitle(imageId), opts.vertical) : visualFor('moment', imgTitle(imageId), opts.vertical) + ' No narration — let the picture and music carry this moment.', imageId });
    }
    return scenes;
  };
  const cta = hooks.cta + (inp.websiteUrl ? ` Visit ${inp.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}.` : '');
  return {
    website: build(counts.website, { closing: cta, vertical: false, startAt: 0 }),
    social_a: build(counts.social_a, { hook: hooks.socialA, closing: cta, vertical: true, startAt: 0 }),
    social_b: build(counts.social_b, { hook: hooks.socialB, closing: cta, vertical: true, startAt: Math.min(4, Math.max(0, lines.length - 4)) }),
    email: build(counts.email, { closing: cta, vertical: false, startAt: 1 }),
    writtenBy: 'templates',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Optional Claude writer
// ---------------------------------------------------------------------------------------------------------------
export type Fetcher = (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export async function claudeWriter(inp: WriterInput, apiKey: string, model: string, fetcher: Fetcher = fetch as any): Promise<KitDraft> {
  const counts = sceneCounts(inp.websiteSecs);
  const hooks = HOOKS[inp.industry] ?? HOOKS.other;
  const prompt = `You write short marketing video scripts for BrittVideo.
Business: ${inp.businessName} (${inp.industry === 'other' ? inp.businessType : inp.industry}). Story: "${inp.story}". Tone: ${inp.tone}.
STRICT RULES:
- Use ONLY the facts below. Never add a claim, number, award, service or promise that is not in a fact. Do not mention prices.
- Every scene whose narration states anything about the business must list the fact ids it uses in "factIds".
- Scenes with no facts are allowed only as a hook question, a welcome, or the closing call to action ("${hooks.cta}").
- Each scene is ${SCENE_SECONDS} seconds: narration at most 16 words. Visual: one continuous camera shot, no on-screen text.
- imageId must be one of the image ids below, or null.
FACTS: ${JSON.stringify(inp.facts)}
IMAGES: ${JSON.stringify(inp.images.map((i) => ({ id: i.id, title: i.title, alt: i.alt })))}
Return ONLY JSON: {"website":[${counts.website} scenes],"social_a":[6 scenes, first is a hook],"social_b":[6 scenes, a different hook and angle from social_a],"email":[3 scenes]}
Each scene: {"name": string, "visual": string, "narration": string, "factIds": string[], "imageId": string|null}`;
  const r = await fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`AI writer answered ${r.status}`);
  const body = await r.json();
  const text: string = body?.content?.find((c: any) => c.type === 'text')?.text ?? '';
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const factIds = new Set(inp.facts.map((f) => f.id)); const imageIds = new Set(inp.images.map((i) => i.id));
  // Uncited opening and closing lines are never the AI's free text: they are replaced by BrittVideo's fixed wording,
  // so nothing unsupported (an award, a ranking, a promise) can slip in there.
  const closing = `${inp.businessName}. ${hooks.cta}` + (inp.websiteUrl ? ` Visit ${inp.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}.` : '');
  const check = (list: any[], n: number, label: string, hook?: string): SceneDraft[] => {
    if (!Array.isArray(list) || list.length !== n) throw new Error(`${label}: expected ${n} scenes`);
    return list.map((s, i) => {
      const ids: string[] = Array.isArray(s.factIds) ? s.factIds : [];
      if (ids.some((id) => !factIds.has(id))) throw new Error(`${label} scene ${i + 1} cites an unknown fact`);
      let narration = String(s.narration ?? '').trim();
      if (narration.split(/\s+/).length > 24) throw new Error(`${label} scene ${i + 1} narration too long`);
      const cta = i === n - 1, opener = i === 0;
      if (!ids.length && narration && !cta && !opener) throw new Error(`${label} scene ${i + 1} has uncited narration`);
      if (!ids.length && opener) narration = hook ?? `Welcome to ${inp.businessName}.`;
      if (!ids.length && cta) narration = closing;
      return { name: String(s.name ?? `Scene ${i + 1}`).slice(0, 80), start_s: i * SCENE_SECONDS, end_s: (i + 1) * SCENE_SECONDS,
        visual: String(s.visual ?? '').slice(0, 600), narration: narration.slice(0, 300), factIds: ids,
        imageId: s.imageId && imageIds.has(s.imageId) ? s.imageId : pickImage(narration, inp.images, null, i) };
    });
  };
  return { website: check(json.website, counts.website, 'Website'), social_a: check(json.social_a, 6, 'Social A', hooks.socialA), social_b: check(json.social_b, 6, 'Social B', hooks.socialB),
    email: check(json.email, 3, 'Email'), writtenBy: `ai:${model}` };
}
