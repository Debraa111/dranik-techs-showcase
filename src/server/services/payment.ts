/**
 * Payment gateway abstraction — Paystack-ready.
 *
 * The app records payments through this interface today (mock mode). When the
 * business is ready to go live, implement `PaystackGateway` with real API
 * calls (initialize + verify) and set PAYMENT_GATEWAY=paystack. No schema or
 * router changes will be needed.
 */

export interface PaymentInitParams {
  amountNgn: number;
  email: string;
  reference: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInitResult {
  authorizationUrl: string | null;
  reference: string;
  /** true when the gateway is in mock mode and payment is auto-approved. */
  mock: boolean;
}

export interface PaymentVerifyResult {
  status: "successful" | "failed" | "pending";
  reference: string;
  amountNgn: number;
}

export interface PaymentGateway {
  initialize(params: PaymentInitParams): Promise<PaymentInitResult>;
  verify(reference: string): Promise<PaymentVerifyResult>;
}

/** Mock gateway: auto-approves payments. Used until Paystack keys are added. */
class MockGateway implements PaymentGateway {
  async initialize(params: PaymentInitParams): Promise<PaymentInitResult> {
    return { authorizationUrl: null, reference: params.reference, mock: true };
  }
  async verify(reference: string): Promise<PaymentVerifyResult> {
    return { status: "successful", reference, amountNgn: 0 };
  }
}

/**
 * Paystack implementation placeholder.
 * To activate: set PAYSTACK_SECRET_KEY env var and PAYMENT_GATEWAY=paystack.
 * Docs: https://paystack.com/docs/api/
 */
class PaystackGateway implements PaymentGateway {
  private secretKey: string;
  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }
  async initialize(params: PaymentInitParams): Promise<PaymentInitResult> {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(params.amountNgn * 100), // kobo
        email: params.email,
        reference: params.reference,
        metadata: params.metadata,
      }),
    });
    if (!res.ok) throw new Error(`Paystack initialize failed: ${res.status}`);
    const json = (await res.json()) as { data: { authorization_url: string } };
    return { authorizationUrl: json.data.authorization_url, reference: params.reference, mock: false };
  }
  async verify(reference: string): Promise<PaymentVerifyResult> {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) throw new Error(`Paystack verify failed: ${res.status}`);
    const json = (await res.json()) as { data: { status: string; amount: number } };
    return {
      status: json.data.status === "success" ? "successful" : json.data.status === "failed" ? "failed" : "pending",
      reference,
      amountNgn: json.data.amount / 100,
    };
  }
}

export function getPaymentGateway(): PaymentGateway {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (process.env.PAYMENT_GATEWAY === "paystack" && key) {
    return new PaystackGateway(key);
  }
  return new MockGateway();
}
