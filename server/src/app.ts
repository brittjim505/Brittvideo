import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { config } from './config.js';
import { APP_VERSION, APP_BUILD_LABEL } from './version.js';
import { OwnerError, notSignedIn, translateDbError, forbidden } from './lib/errors.js';
import { randomToken } from './lib/util.js';
import { type Actor, prospectActor } from './auth/permissions.js';
import * as auth from './auth/service.js';
import * as crm from './modules/crm/service.js';
import * as pricing from './modules/pricing/service.js';
import * as sales from './modules/sales/service.js';
import * as demo from './modules/demo/service.js';
import * as projects from './modules/projects/service.js';
import * as work from './modules/work/service.js';
import * as secrets from './modules/integrations/secrets.js';
import { runHealthChecks, summarise } from './modules/support/health.js';
import { buildSupportReport, markReportSent } from './modules/support/report.js';
import { logDiagnostic } from './modules/support/diagnostics.js';
import { createBackup } from './modules/backup/service.js';
import { importPrototypeExport } from './modules/migration/importer.js';
import { auditTrail } from './modules/audit/service.js';
import { objectPath } from './integrations/storage.js';
import { TERMS_VERSION, termsText } from './modules/sales/terms.js';
import * as analysis from './modules/builder/analysis.js';
import * as images from './modules/builder/images.js';
import * as kit from './modules/builder/kit.js';
import { money, sha256 } from './lib/util.js';

declare module 'fastify' {
  interface FastifyRequest { actor: Actor | null; sessionId: string | null; sessionLocked: boolean }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

export async function buildApp(pool: pg.Pool, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 60 * 1024 * 1024, trustProxy: true, genReqId: () => randomToken(9) });
  await app.register(cookie);
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('sessionLocked', false);

  // ---- Security headers (V18, V25). Referrer is suppressed so demo tokens in URLs never leak to other sites.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; frame-src https://player.vimeo.com https://www.youtube.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (config().isLive) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  // ---- Authentication + CSRF. Mutating API calls must carry X-BrittVideo (cross-site forms cannot set it).
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-brittvideo'] !== '1') {
      throw new OwnerError('This request was blocked for your security. Please refresh the page.', 403, 'csrf');
    }
    const token = req.cookies[auth.SESSION_COOKIE];
    const u = await auth.userForToken(pool, token);
    if (u) {
      req.actor = auth.actorFromUser(u);
      req.sessionId = u.session_id;
      req.sessionLocked = !!u.locked_at;
    }
  });

  const actor = (req: FastifyRequest): Actor => {
    if (!req.actor) throw notSignedIn();
    // While an in-person iPad demo is running, admin data stays locked until the owner's password is entered (V13, V14).
    if (req.sessionLocked) throw new OwnerError('BrittVideo is locked during a prospect demo. Enter your password to unlock.', 423, 'locked_for_demo');
    return req.actor;
  };
  const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') });
  const body = (req: FastifyRequest) => (req.body ?? {}) as any;
  const params = (req: FastifyRequest) => req.params as any;
  const requireWork = (req: FastifyRequest) => auth.requirePerm(actor(req), 'work');

  // ---- Errors: owner-facing sentences only (Q11).
  app.setErrorHandler(async (err: any, req, reply) => {
    const owner = err instanceof OwnerError ? err : translateDbError(err);
    if (owner) return reply.status(owner.status).send({ error: { code: owner.code, message: owner.message, details: owner.details } });
    if (err.validation || err.statusCode === 400 || err.statusCode === 415) return reply.status(400).send({ error: { code: 'bad_request', message: 'Some information was missing or not in the expected form. Please check and try again.' } });
    if (err.statusCode === 413) return reply.status(413).send({ error: { code: 'too_large', message: 'That file is too large.' } });
    await logDiagnostic(pool, 'error', 'server', err.message ?? 'Unexpected error', { url: req.url.replace(/\/demo\/(s|l)\/[^/?]+/, '/demo/$1/[token]').replace(/\/public\/demo\/(s|l)\/[^/?]+/, '/public/demo/$1/[token]'), method: req.method, stack: String(err.stack ?? '').split('\n').slice(0, 6).join(' | ') }, req.id);
    return reply.status(500).send({ error: { code: 'unexpected', message: 'Something went wrong on BrittVideo\'s side. Your saved work is safe. Try again, and if it happens again use GET SUPPORT — you don\'t need to figure out what happened.', reference: req.id } });
  });

  const cookieOpts = () => ({ path: '/', httpOnly: true, sameSite: 'strict' as const, secure: config().isLive || config().PUBLIC_BASE_URL.startsWith('https://'), maxAge: config().SESSION_DAYS * 86400 });

  // =============================================================================================================
  // Setup + auth
  // =============================================================================================================
  app.get('/api/version', async () => ({ version: APP_VERSION, label: APP_BUILD_LABEL, env: config().APP_ENV }));
  app.get('/api/health/live', async () => { await pool.query('SELECT 1'); return { ok: true, version: APP_VERSION }; });

  app.get('/api/setup/status', async () => {
    const n = (await pool.query(`SELECT count(*)::int n FROM users`)).rows[0].n;
    return { needsFirstUser: n === 0, env: config().APP_ENV };
  });
  // First run only: creates the owner's Super User account. Refused once any user exists.
  app.post('/api/setup/first-user', async (req, reply) => {
    const b = body(req);
    const client = await pool.connect();
    try {
      await client.query(`SELECT pg_advisory_lock(815002)`);
      const n = (await client.query(`SELECT count(*)::int n FROM users`)).rows[0].n;
      if (n > 0) throw new OwnerError('BrittVideo is already set up. Please sign in.', 409, 'already_setup');
      await auth.createUser(pool, null, { email: b.email, displayName: b.displayName, role: 'super_user', password: b.password });
    } finally { await client.query(`SELECT pg_advisory_unlock(815002)`).catch(() => {}); client.release(); }
    const s = await auth.login(pool, b.email, b.password, meta(req));
    reply.setCookie(auth.SESSION_COOKIE, s.token, cookieOpts());
    return { user: s.user };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = body(req);
    const s = await auth.login(pool, b.email, b.password, meta(req));
    reply.setCookie(auth.SESSION_COOKIE, s.token, cookieOpts());
    return { user: s.user };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await auth.logout(pool, req.cookies[auth.SESSION_COOKIE]);
    reply.clearCookie(auth.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => {
    if (!req.actor) throw notSignedIn();
    const u = (await pool.query(`SELECT * FROM users WHERE id=$1`, [req.actor.userId])).rows[0];
    return { user: auth.publicUser(u), locked: req.sessionLocked, version: APP_VERSION, env: config().APP_ENV };
  });
  app.post('/api/auth/unlock', async (req) => {
    if (!req.actor || !req.sessionId) throw notSignedIn();
    const u = (await pool.query(`SELECT email FROM users WHERE id=$1`, [req.actor.userId])).rows[0];
    const ok = await auth.confirmPassword(pool, req.actor.userId!, body(req).password);
    await pool.query(`INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,$3)`, [u.email.toLowerCase(), req.ip, ok]);
    if (!ok) {
      const fails = (await pool.query(`SELECT count(*)::int n FROM login_attempts WHERE lower(email)=$1 AND success=false AND at > now() - interval '15 minutes'`, [u.email.toLowerCase()])).rows[0].n;
      // Too many wrong guesses on a locked (demo) device: end this session entirely; a full sign-in is needed.
      if (fails >= 5) { await pool.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1`, [req.sessionId]); throw new OwnerError('Too many wrong passwords. For your security you have been signed out — please sign in again.', 401, 'not_signed_in'); }
      throw new OwnerError('That password is not correct.', 401, 'bad_credentials');
    }
    await pool.query(`UPDATE sessions SET locked_at=NULL WHERE id=$1`, [req.sessionId]);
    await pool.query(`UPDATE demo_sessions SET ended_at=coalesce(ended_at, now()) WHERE started_by=$1 AND channel='ipad_in_person' AND ended_at IS NULL`, [req.actor.userId]);
    return { ok: true };
  });
  app.post('/api/auth/password', async (req) => {
    const a = actor(req); const b = body(req);
    await auth.setPassword(pool, a, a.userId!, b.newPassword, b.currentPassword);
    return { ok: true };
  });

  // Users (Super User)
  app.get('/api/users', async (req) => auth.listUsers(pool, actor(req)));
  app.post('/api/users', async (req) => { const b = body(req); return auth.createUser(pool, actor(req), { email: b.email, displayName: b.displayName, role: b.role, password: b.password, mustChangePassword: true }); });
  app.patch('/api/users/:id', async (req) => auth.updateUser(pool, actor(req), params(req).id, body(req)));
  app.post('/api/users/:id/elevate', async (req) => auth.elevateUser(pool, actor(req), params(req).id, body(req).grants ?? [], Number(body(req).hours)));
  app.post('/api/users/:id/password', async (req) => { await auth.setPassword(pool, actor(req), params(req).id, body(req).newPassword); return { ok: true }; });

  // =============================================================================================================
  // Command Center, search, drafts, activity
  // =============================================================================================================
  app.get('/api/command-center', async (req) => {
    const a = actor(req);
    const checks = await runHealthChecks(pool);
    return { ...(await work.commandCenter(pool, a)), health: summarise(checks), healthChecks: checks };
  });
  app.get('/api/search', async (req) => work.globalSearch(pool, actor(req), String((req.query as any).q ?? '')));
  app.get('/api/drafts/:key', async (req) => ({ draft: await work.getDraft(pool, actor(req), params(req).key) }));
  app.put('/api/drafts/:key', async (req) => work.saveDraft(pool, actor(req), params(req).key, body(req).payload, body(req).baseRevision ?? null));
  app.delete('/api/drafts/:key', async (req) => { await work.deleteDraft(pool, actor(req), params(req).key); return { ok: true }; });
  app.put('/api/activity', async (req) => { await work.setActivity(pool, actor(req), body(req)); return { ok: true }; });

  // =============================================================================================================
  // Prospects & clients
  // =============================================================================================================
  app.get('/api/prospects', async (req) => crm.listProspects(pool, actor(req), { search: (req.query as any).q }));
  app.post('/api/prospects', async (req) => { requireWork(req); return crm.upsertProspect(pool, actor(req), body(req)); });
  app.get('/api/prospects/:id', async (req) => crm.getProspect(pool, actor(req), params(req).id));
  app.patch('/api/prospects/:id', async (req) => crm.updateProspect(pool, actor(req), params(req).id, body(req)));
  app.post('/api/prospects/:id/archive', async (req) => crm.archiveProspect(pool, actor(req), params(req).id));
  app.get('/api/clients', async (req) => crm.listClients(pool, actor(req), { search: (req.query as any).q }));
  app.get('/api/clients/:id', async (req) => crm.getClient(pool, actor(req), params(req).id));
  app.patch('/api/clients/:id', async (req) => crm.updateClient(pool, actor(req), params(req).id, body(req)));
  app.post('/api/clients/:id/marketing', async (req) => { const b = body(req); return crm.setMarketingPreference(pool, actor(req), params(req).id, b.status, b.reason, b.resubscribeEvidence); });

  // =============================================================================================================
  // Pricing
  // =============================================================================================================
  app.get('/api/pricing', async (req) => {
    const a = actor(req); auth.requirePerm(a, 'work');
    const pb = await pricing.currentPriceBook(pool);
    return { version: pb.version_no, publishedAt: pb.published_at, items: pb.items, packages: pricing.publicPackages(pb), canEdit: a.permissions.has('pricing') };
  });
  app.post('/api/pricing', async (req) => { const b = body(req); return pricing.publishPriceBook(pool, actor(req), b.changes ?? {}, b.note); });
  app.get('/api/pricing/history', async (req) => pricing.priceBookHistory(pool, actor(req)));

  // =============================================================================================================
  // Sales & payments (owner side: Mac/Zoom, manual, returning client)
  // =============================================================================================================
  app.post('/api/sales', async (req) => { const b = body(req); return sales.completeSale(pool, actor(req), { ...b, meta: meta(req) }); });
  app.get('/api/orders/:id', async (req) => { requireWork(req); return sales.getOrderForPayment(pool, params(req).id); });
  app.post('/api/orders/:id/pay', async (req) => { const b = body(req); return sales.payOrder(pool, actor(req), params(req).id, { attemptKey: b.attemptKey, provider: b.provider ?? 'test', testOutcome: b.testOutcome }); });
  app.post('/api/orders/:id/manual-payment', async (req) => { const b = body(req); return sales.recordManualPayment(pool, actor(req), params(req).id, { attemptKey: b.attemptKey, amountCents: Number(b.amountCents), note: b.note }); });

  // =============================================================================================================
  // Demo & Sales — owner controls
  // =============================================================================================================
  app.post('/api/demo/sessions', async (req) => demo.startDemoSession(pool, actor(req), body(req), req.sessionId ?? undefined));
  app.post('/api/demo/sessions/:id/end', async (req) => { await demo.endDemoSession(pool, actor(req), params(req).id); return { ok: true }; });
  app.get('/api/demo/links', async (req) => demo.listDemoLinks(pool, actor(req)));
  app.post('/api/demo/links', async (req) => demo.createDemoLink(pool, actor(req), body(req)));
  app.post('/api/demo/links/:id/disable', async (req) => { await demo.disableDemoLink(pool, actor(req), params(req).id); return { ok: true }; });
  app.get('/api/demo/library', async (req) => demo.listLibrary(pool, actor(req)));
  app.post('/api/demo/library', async (req) => demo.saveLibraryItem(pool, actor(req), null, body(req)));
  app.put('/api/demo/library/:id', async (req) => demo.saveLibraryItem(pool, actor(req), params(req).id, body(req)));

  // =============================================================================================================
  // Demo & Sales — PROSPECT-SAFE public API. Scoped entirely by the demo token; never uses the admin session.
  // =============================================================================================================
  const demoCtx = (req: FastifyRequest, count = false) => demo.resolveDemo(pool, params(req).kind, params(req).token, count);
  app.get('/api/public/demo/:kind/:token', async (req) => demo.publicDemoView(pool, await demoCtx(req, true)));
  // The exact agreement text is shown before the prospect accepts it (M10).
  app.get('/api/public/demo/:kind/:token/terms', async (req) => {
    await demoCtx(req);
    const pkg = String((req.query as any).package) === 'premier' ? 'premier' : 'standard';
    const pub = pricing.publicPackages(await pricing.currentPriceBook(pool)).find((p) => p.code === pkg)!;
    const priceText = pub.monthlyCents ? `${money(pub.oneTimeCents)} one-time + ${money(pub.monthlyCents)} per month` : `${money(pub.oneTimeCents)} one-time`;
    const text = termsText(pkg, priceText);
    return { package: pkg, version: TERMS_VERSION, text, sha256: sha256(text) };
  });
  app.post('/api/public/demo/:kind/:token/signup', async (req) => {
    const ctx = await demoCtx(req);
    if (!ctx.allowSignup) throw new OwnerError('Signup is not available from this link. Please contact BrittVideo.', 403, 'signup_disabled');
    const b = body(req);
    // Business name, website and industry come from the demo record — the prospect never re-enters them (Delta).
    let sessionId = ctx.kind === 'session' ? ctx.id : null;
    if (ctx.kind === 'link') {
      const s = (await pool.query(`SELECT id FROM demo_sessions WHERE demo_link_id=$1 ORDER BY started_at LIMIT 1`, [ctx.id])).rows[0]
        ?? (await pool.query(`INSERT INTO demo_sessions (channel, prospect_id, demo_link_id, business_name, website_url, industry, business_type, expires_at)
            VALUES ('demo_link',$1,$2,$3,$4,$5,$6, now() + interval '30 days') RETURNING id`, [ctx.prospectId, ctx.id, ctx.businessName, ctx.websiteUrl, ctx.industry, ctx.businessType])).rows[0];
      sessionId = s.id;
    }
    const r = await sales.completeSale(pool, prospectActor(`Prospect signup (${ctx.channel.replace(/_/g, ' ')})`), {
      saleKey: String(b.saleKey ?? ''), channel: ctx.channel as any, demoSessionId: sessionId, prospectId: ctx.prospectId,
      business: { businessName: ctx.businessName, websiteUrl: ctx.websiteUrl, industry: ctx.industry, businessType: ctx.businessType,
        contactName: b.contactName, email: b.email, phone: b.phone },
      package: b.package, agreement: { accepted: !!b.agreementAccepted, name: b.agreementName, email: b.email, shownTermsSha256: b.termsSha256 }, meta: meta(req),
    });
    return publicOrder(r.orderId);
  });
  const publicOrder = async (orderId: string) => {
    const o = await sales.getOrderForPayment(pool, orderId);
    return { orderId: o.id, orderNumber: o.order_number, status: o.status, businessName: o.business_name, package: o.package,
      lines: o.lines.map((l: any) => ({ label: l.label, billing: l.billing, amountCents: l.sold_price_cents })), dueTodayCents: o.dueTodayCents, monthlyCents: o.monthlyCents,
      paymentOptions: config().isLive ? ['arranged_by_owner'] : ['test'] };
  };
  const demoOrderId = async (req: FastifyRequest) => {
    const ctx = await demoCtx(req);
    const row = ctx.kind === 'session'
      ? (await pool.query(`SELECT converted_order_id AS id FROM demo_sessions WHERE id=$1`, [ctx.id])).rows[0]
      : (await pool.query(`SELECT converted_order_id AS id FROM demo_sessions WHERE demo_link_id=$1 AND converted_order_id IS NOT NULL LIMIT 1`, [ctx.id])).rows[0];
    if (!row?.id) throw new OwnerError('There is no signup for this demo yet.', 404, 'no_order');
    return row.id as string;
  };
  app.get('/api/public/demo/:kind/:token/order', async (req) => publicOrder(await demoOrderId(req)));
  app.post('/api/public/demo/:kind/:token/pay', async (req) => {
    const orderId = await demoOrderId(req); const b = body(req);
    if (config().isLive) throw new OwnerError('BrittVideo will send you a secure payment link. Nothing more is needed on this screen.', 409, 'arranged_by_owner');
    await sales.payOrder(pool, prospectActor('Prospect payment (test)'), orderId, { attemptKey: String(b.attemptKey ?? ''), provider: 'test', testOutcome: b.testOutcome === 'decline' ? 'decline' : 'approve' });
    return publicOrder(orderId);
  });

  // =============================================================================================================
  // Projects & approvals
  // =============================================================================================================
  app.get('/api/projects', async (req) => projects.listProjects(pool, actor(req), req.query as any));
  app.get('/api/projects/:id', async (req) => projects.getProject(pool, actor(req), params(req).id));
  app.post('/api/projects/:id/approve', async (req) => { const b = body(req); return projects.approve(pool, actor(req), params(req).id, { type: b.type, id: b.type === 'kit' ? params(req).id : b.id, expectedHash: b.expectedHash }); });
  app.patch('/api/projects/:id/scenes/:sceneId', async (req) => projects.updateScene(pool, actor(req), params(req).id, params(req).sceneId, body(req)));
  app.put('/api/projects/:id/deliverables/:did/script', async (req) => projects.updateScript(pool, actor(req), params(req).id, params(req).did, String(body(req).text ?? '')));
  app.get('/api/projects/:id/checkpoints', async (req) => projects.listCheckpoints(pool, actor(req), params(req).id));
  app.post('/api/projects/:id/checkpoints', async (req) => { const a = actor(req); auth.requirePerm(a, 'work'); return projects.createCheckpoint(pool, params(req).id, 'manual', body(req).reason || 'Saved by owner', a.label); });
  app.post('/api/projects/:id/checkpoints/:cid/restore', async (req) => projects.restoreCheckpoint(pool, actor(req), params(req).id, params(req).cid));
  // =============================================================================================================
  // Builder (Phase 3): website analysis, facts, images, build, scene images, downloads, delivery, Quick Video
  // =============================================================================================================
  app.get('/api/projects/:id/builder', async (req) => {
    const a = actor(req); auth.requirePerm(a, 'work'); const id = params(req).id;
    const detail = await projects.getProject(pool, a, id);
    const latest = (await pool.query(`SELECT id, url, status, owner_message, pages, created_at FROM website_analyses WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] ?? null;
    return { ...detail, facts: await analysis.listFacts(pool, id), images: await images.projectImages(pool, id), analysis: latest,
      options: kit.builderOptions(detail.project.industry ?? 'other'), deliveries: await kit.deliveryHistory(pool, id) };
  });
  app.post('/api/projects/:id/analyze', async (req) => analysis.analyzeWebsite(pool, actor(req), params(req).id, body(req).url));
  app.post('/api/projects/:id/facts', async (req) => analysis.addFact(pool, actor(req), params(req).id, body(req).text));
  app.patch('/api/projects/:id/facts/:fid', async (req) => analysis.updateFact(pool, actor(req), params(req).id, params(req).fid, body(req)));
  app.post('/api/projects/:id/images/:assetId', async (req) => images.setProjectImage(pool, actor(req), params(req).id, params(req).assetId, !!body(req).selected));
  app.post('/api/projects/:id/build', async (req) => { const b = body(req); return kit.buildKit(pool, actor(req), params(req).id, { story: b.story, tone: b.tone, websiteSecs: Number(b.websiteSecs), platform: b.platform, confirmReplaceApproved: !!b.confirmReplaceApproved }); });
  app.put('/api/projects/:id/scenes/:sceneId/image', async (req) => kit.setSceneImage(pool, actor(req), params(req).id, params(req).sceneId, body(req).assetId ?? null));
  app.post('/api/projects/:id/approve-many', async (req) => {
    const a = actor(req); const items: { id: string; expectedHash: string }[] = Array.isArray(body(req).items) ? body(req).items : [];
    if (!items.length || items.length > 60) throw new OwnerError('Choose the scenes to approve.');
    let st: any = null;
    for (const it of items) st = await projects.approve(pool, a, params(req).id, { type: 'scene', id: it.id, expectedHash: it.expectedHash });
    return st;
  });
  app.get('/api/projects/:id/download/kit', async (req, reply) => {
    const r = await kit.buildKitZip(pool, actor(req), params(req).id);
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${r.fileName}"`).header('Cache-Control', 'no-store').send(r.data);
  });
  app.get('/api/projects/:id/download/script/:did', async (req, reply) => {
    const r = await kit.scriptDownload(pool, actor(req), params(req).id, params(req).did);
    return reply.header('Content-Type', 'text/plain; charset=utf-8').header('Content-Disposition', `attachment; filename="${r.fileName}"`).header('Cache-Control', 'no-store').send(r.data);
  });
  app.post('/api/projects/:id/delivery', async (req) => kit.recordDelivery(pool, actor(req), params(req).id, body(req)));
  app.post('/api/quick-videos', async (req) => kit.createQuickVideo(pool, actor(req), body(req)));

  // Image Library
  app.get('/api/images', async (req) => { const qy = req.query as any; return images.listLibrary(pool, actor(req), { view: qy.view, clientId: qy.clientId, search: qy.q, category: qy.category }); });
  app.post('/api/images', async (req) => images.uploadImage(pool, actor(req), body(req)));
  app.patch('/api/images/:id', async (req) => images.updateImage(pool, actor(req), params(req).id, body(req)));
  app.post('/api/images/delete', async (req) => images.deleteImages(pool, actor(req), body(req).ids ?? [], !!body(req).confirmInUse));
  app.post('/api/images/restore', async (req) => images.restoreImages(pool, actor(req), body(req).ids ?? []));
  app.post('/api/images/purge', async (req) => images.purgeImages(pool, actor(req), body(req).ids ?? []));

  app.get('/api/audit', async (req) => {
    const a = actor(req); const qy = req.query as any;
    if (qy.entityId) auth.requirePerm(a, 'work'); else auth.requirePerm(a, 'users', 'view the full audit trail');
    return auditTrail(pool, { entityType: qy.entityType, entityId: qy.entityId, limit: Number(qy.limit) || 100 });
  });

  // =============================================================================================================
  // Support, health, backups, integrations, migration
  // =============================================================================================================
  app.get('/api/health', async (req) => { actor(req); const c = await runHealthChecks(pool); return { summary: summarise(c), checks: c }; });
  app.get('/api/recovery-events', async (req) => { actor(req); return (await pool.query(`SELECT id, at, area, what_happened, outcome, resolved_at FROM recovery_events ORDER BY at DESC LIMIT 50`)).rows; });
  app.post('/api/support/report', async (req) => {
    // GET SUPPORT is available to every role (Q14). While a demo lock is on, the owner unlocks first so a prospect
    // holding the iPad cannot read diagnostics.
    return buildSupportReport(pool, { actor: actor(req), ownerNote: body(req).note, area: body(req).area });
  });
  app.post('/api/support/report/:id/sent', async (req) => { const a = actor(req); await markReportSent(pool, a, params(req).id, String(body(req).via ?? 'shared')); return { ok: true }; });
  app.get('/api/support/reports', async (req) => { const a = actor(req); auth.requirePerm(a, 'support'); return (await pool.query(`SELECT id, created_at, created_by_label, trigger, summary, sent_at, sent_via FROM support_reports ORDER BY created_at DESC LIMIT 50`)).rows; });
  app.post('/api/diagnostics/client-error', async (req) => {
    if (!req.actor) return { ok: true };
    const b = body(req); await logDiagnostic(pool, 'error', 'browser', String(b.message ?? 'Browser error').slice(0, 500), { where: b.where, route: b.route }); return { ok: true };
  });
  app.get('/api/backups', async (req) => { const a = actor(req); auth.requirePerm(a, 'backup', 'view backups');
    return (await pool.query(`SELECT id, kind, status, file_name, bytes, started_at, finished_at, verify_status, owner_message FROM backups ORDER BY started_at DESC LIMIT 50`)).rows; });
  app.post('/api/backups', async (req) => {
    const a = actor(req); auth.requirePerm(a, 'backup', 'make backups');
    const r = await createBackup(pool, 'manual');
    return { ok: true, file: path.basename(r.file), bytes: r.bytes };
  });
  app.get('/api/integrations', async (req) => { const a = actor(req); auth.requirePerm(a, 'work');
    const c = await runHealthChecks(pool);
    return { checks: c.filter((x) => ['square', 'video_provider', 'vimeo', 'communications'].includes(x.component)),
      secrets: a.permissions.has('integrations') ? await secrets.secretStatus(pool) : [], canEdit: a.permissions.has('integrations') }; });
  app.put('/api/integrations/secrets/:name', async (req) => { await secrets.setSecret(pool, actor(req), params(req).name, body(req).value); return { ok: true }; });
  app.delete('/api/integrations/secrets/:name', async (req) => { await secrets.clearSecret(pool, actor(req), params(req).name); return { ok: true }; });
  app.post('/api/migration/prototype', async (req) => {
    const a = actor(req); auth.requirePerm(a, 'backup', 'import data');
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    await createBackup(pool, 'pre_import');
    return importPrototypeExport(pool, a, text);
  });

  // Media for signed-in users only (library images etc.).
  app.get('/media/*', async (req, reply) => {
    const u = await auth.userForToken(pool, req.cookies[auth.SESSION_COOKIE]);
    if (!u || u.locked_at) throw forbidden('view this file');
    const key = 'media/' + (params(req)['*'] as string);
    const p = objectPath(key);
    if (!p) return reply.status(404).send('Not found');
    const asset = (await pool.query(`SELECT mime, status FROM assets WHERE storage_key=$1 LIMIT 1`, [key])).rows[0];
    if (!asset || asset.status === 'permanently_deleted') return reply.status(404).send('Not found');
    reply.header('Content-Type', asset.mime ?? 'application/octet-stream').header('Cache-Control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(p));
  });

  // =============================================================================================================
  // Web client: /app/* (owner) and /demo/* (prospect-safe) are separate HTML entry points and bundles (Y15).
  // =============================================================================================================
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/assets-root/', serve: false });
    const assetsDir = path.join(WEB_DIST, 'assets');
    if (fs.existsSync(assetsDir)) await app.register(fastifyStatic, { root: assetsDir, prefix: '/assets/', decorateReply: false, immutable: true, maxAge: '365d' });
    const page = (file: string) => async (_req: FastifyRequest, reply: FastifyReply) => reply.header('Cache-Control', 'no-store').type('text/html').send(fs.readFileSync(path.join(WEB_DIST, file)));
    app.get('/', async (_req, reply) => reply.redirect('/app'));
    app.get('/app', page('index.html'));
    app.get('/app/*', page('index.html'));
    app.get('/demo/*', page('demo.html'));
    app.get('/favicon.svg', async (_req, reply) => reply.type('image/svg+xml').send(fs.readFileSync(path.join(WEB_DIST, 'favicon.svg'))));
  }
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'not_found', message: 'That was not found.' } });
    return reply.status(404).type('text/html').send('<h1>Not found</h1><p><a href="/app">Go to BrittVideo</a></p>');
  });
  return app;
}
