import { NextResponse } from "next/server";

const WORKER = "https://html-to-webflow.moden.workers.dev/";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const payload = body?.payload ?? body;
    const target = body?.targetUrl || WORKER;

    const r = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Proxy error" },
      { status: 500 }
    );
  }
}
