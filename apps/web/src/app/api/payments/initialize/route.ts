import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "../../../../lib/api";

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const result = await apiFetch("/api/payments/initialize", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
