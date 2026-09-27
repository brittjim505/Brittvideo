import { config } from '../config.js';
import { OwnerError } from '../lib/errors.js';

/**
 * Payment adapter contract (Y14, S3, V17). BrittVideo never sees or stores card numbers or CVV:
 * card entry always happens on the provider's hosted surface. Adapters receive the caller's idempotency key and
 * must pass it to the provider so that a retry can never create a second charge (M15).
 */
export interface PaymentRequest {
  idempotencyKey: string;
  amountCents: number;
  orderNumber: number;
  description: string;
  /** Test adapter only: simulate a card outcome. */
  testOutcome?: 'approve' | 'decline';
}
export interface PaymentResult {
  status: 'pending' | 'paid' | 'failed';
  providerRef: string | null;
  paymentLinkUrl?: string | null;
  failureMessage?: string | null;
}
export interface PaymentAdapter {
  name: 'test' | 'manual' | 'square';
  mode: 'test' | 'live';
  health(): Promise<{ status: 'normal' | 'not_configured' | 'attention'; message: string }>;
  /** Must be safe to call twice with the same idempotencyKey. */
  createPayment(req: PaymentRequest): Promise<PaymentResult>;
  /** Look up the provider's current state before any retry (Q10). */
  getPayment(providerRef: string): Promise<PaymentResult | null>;
}

/** Simulated card processor for development/test. Refuses to run in live mode (V30). */
export class TestPaymentAdapter implements PaymentAdapter {
  name = 'test' as const; mode = 'test' as const;
  private seen = new Map<string, PaymentResult>();
  async health() { return { status: 'normal' as const, message: 'Test payments (no real money moves).' }; }
  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    if (config().isLive) throw new OwnerError('Test payments are not allowed in the live BrittVideo.', 500, 'test_in_live');
    const prior = this.seen.get(req.idempotencyKey);
    if (prior) return prior;                         // provider-side idempotency, like Square's
    const r: PaymentResult = req.testOutcome === 'decline'
      ? { status: 'failed', providerRef: 'test_' + req.idempotencyKey.slice(0, 12), failureMessage: 'The card was declined. Ask for a different card, or choose another way to pay.' }
      : { status: 'paid', providerRef: 'test_' + req.idempotencyKey.slice(0, 12) };
    this.seen.set(req.idempotencyKey, r);
    return r;
  }
  async getPayment(ref: string) { for (const v of this.seen.values()) if (v.providerRef === ref) return v; return null; }
}

/** Owner records a payment received outside BrittVideo (check, cash, invoice). Nothing is charged. */
export class ManualPaymentAdapter implements PaymentAdapter {
  name = 'manual' as const;
  get mode() { return config().isLive ? 'live' as const : 'test' as const; }
  async health() { return { status: 'normal' as const, message: 'Manual payments can be recorded.' }; }
  async createPayment(req: PaymentRequest): Promise<PaymentResult> { return { status: 'pending', providerRef: 'manual_' + req.idempotencyKey.slice(0, 12) }; }
  async getPayment() { return null; }
}

/**
 * Square adapter — Phase 8. The contract, health state and configuration check exist now so the rest of BrittVideo
 * is written against it; live calls (hosted checkout / payment links, webhooks, reconciliation) are implemented
 * and certified in Phase 8 with Square sandbox credentials.
 */
export class SquarePaymentAdapter implements PaymentAdapter {
  name = 'square' as const;
  constructor(private creds: { accessToken?: string | null; locationId?: string | null }) {}
  get mode() { return config().isLive ? 'live' as const : 'test' as const; }
  async health() {
    if (!this.creds.accessToken || !this.creds.locationId) return { status: 'not_configured' as const, message: 'Square is not connected yet. Card payments can be added in Settings → Integrations.' };
    return { status: 'attention' as const, message: 'Square credentials are saved; live Square payments arrive in Phase 8.' };
  }
  async createPayment(): Promise<PaymentResult> {
    throw new OwnerError('Square card payments are not switched on yet. Record this payment manually for now (check, cash or invoice), or use test payments while testing.', 409, 'square_not_ready');
  }
  async getPayment() { return null; }
}

export function paymentAdapters(squareCreds: { accessToken?: string | null; locationId?: string | null } = {}) {
  const list: PaymentAdapter[] = [new ManualPaymentAdapter(), new SquarePaymentAdapter(squareCreds)];
  if (!config().isLive) list.unshift(testAdapter);
  return Object.fromEntries(list.map((a) => [a.name, a])) as Partial<Record<PaymentAdapter['name'], PaymentAdapter>>;
}
const testAdapter = new TestPaymentAdapter();
