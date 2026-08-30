import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://api.paystack.co";

export interface PaystackClientOptions {
  secretKey: string;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: { status: string; amount: number; currency: string };
}

export class PaystackClient {
  constructor(private opts: PaystackClientOptions) {}

  /** amountMinorUnits is kobo for NGN. Reference must be unique - caller generates it. */
  async initializeTransaction(params: {
    email: string;
    amountMinorUnits: number;
    currencyCode: string;
    reference: string;
    metadata?: Record<string, unknown>;
    callbackUrl?: string;
  }): Promise<InitializeTransactionResult> {
    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email,
        amount: params.amountMinorUnits,
        currency: params.currencyCode,
        reference: params.reference,
        metadata: params.metadata,
        callback_url: params.callbackUrl,
      }),
    });

    const data = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !data.status) {
      throw new Error(`Paystack initialize failed: ${JSON.stringify(data)}`);
    }

    return {
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    };
  }

  /**
   * Server-side verification - the source of truth for whether a payment
   * really succeeded. The webhook only tells us to go check; we never credit
   * a wallet purely because the webhook or the client says payment succeeded.
   */
  async verifyTransaction(reference: string): Promise<{
    success: boolean;
    amountMinorUnits: number;
    currencyCode: string;
    raw: unknown;
  }> {
    const response = await fetch(
      `${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.opts.secretKey}` } },
    );
    const data = (await response.json()) as PaystackVerifyResponse;
    if (!response.ok) {
      throw new Error(`Paystack verify failed: ${JSON.stringify(data)}`);
    }
    return {
      success: data.data?.status === "success",
      amountMinorUnits: data.data?.amount,
      currencyCode: data.data?.currency,
      raw: data,
    };
  }
}

/** Paystack signs webhook bodies with HMAC-SHA512 of the raw body using the secret key. */
export function verifyPaystackSignature(params: {
  secretKey: string;
  signatureHeader: string | undefined;
  rawBody: Buffer;
}): boolean {
  if (!params.signatureHeader) return false;
  const expected = createHmac("sha512", params.secretKey).update(params.rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
