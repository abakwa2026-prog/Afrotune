import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "../../../../../lib/api";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json();
  try {
    const result = await apiFetch(`/api/songs/${params.id}/rating`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
