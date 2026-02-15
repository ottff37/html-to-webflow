import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProxyBody = {
  targetUrl?: string;
  payload?: any;
};

function json(data: any, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

export async function POST(req: Request) {
  let body: ProxyBody | null = null;

  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const targetUrl = (body?.targetUrl || "").trim();
  const payload = body?.payload;

  if (!targetUrl) {
    return json({ ok: false, error: "Missing targetUrl" }, { status: 400 });
  }

  // Basic safety: only allow http(s)
  let url: URL;
  try {
    url = new URL(targetUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return json({ ok: false, error: "targetUrl must be http(s)" }, { status: 400 });
    }
  } catch {
    return json({ ok: false, error: "targetUrl is not a valid URL" }, { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // avoid caching
      cache: "no-store",
    });

    const text = await upstream.text();

    // Return upstream response as-is (JSON), preserving status
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "Upstream fetch failed",
        details: String(e?.message || e),
      },
      { status: 502 }
    );
  }
}

// Optional: quick check in browser
export async function GET() {
  return json({ ok: true, message: "Proxy alive. Use POST." });
}
