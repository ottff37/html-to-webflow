"use client";
import React, { useMemo, useState } from "react";

/**
 * HTML → Webflow Converter
 *
 * Expected behavior (Worker mode):
 * - Paste HTML (optionally CSS/JS)
 * - Click "Convert to Webflow"
 * - App POSTs a JSON payload to the Worker endpoint (directly or via Proxy URL)
 * - Receives { ok: true, xscp, stats }
 * - Copies xscp to clipboard as application/json so you can paste into Webflow Designer.
 *
 * Notes:
 * - If you see NetworkError/Failed to fetch, it’s usually CORS/CSP/sandbox/VPN/adblock or endpoint downtime.
 * - If Worker mode fails, Helper mode still provides a checklist + class mapping (no network).
 */

// ---------------------------
// Helpers (DOM → Webflow-ish)
// ---------------------------

function safeText(node: any) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim();
}

function toSlug(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/g, "")
    .replace(/-$/g, "");
}

function isProbablyContainer(el: any) {
  const cls = (el.getAttribute("class") || "").toLowerCase();
  return (
    /container|wrapper|wrap|inner|content/.test(cls) ||
    (el.tagName === "DIV" && el.children.length > 0 && el.children.length <= 6)
  );
}

function isProbablySection(el: any) {
  const tag = el.tagName;
  const cls = (el.getAttribute("class") || "").toLowerCase();
  return (
    tag === "SECTION" ||
    /section|hero|footer|header|main|nav/.test(cls) ||
    (tag === "DIV" && /section/.test(cls))
  );
}

function isProbablyGrid(el: any) {
  const cls = (el.getAttribute("class") || "").toLowerCase();
  return /grid|cols|columns|row/.test(cls);
}

function isProbablyFlex(el: any) {
  const cls = (el.getAttribute("class") || "").toLowerCase();
  return /flex|stack|hstack|vstack|align|justify/.test(cls);
}

function guessWebflowRole(el: any) {
  if (!el || el.nodeType !== 1) return "";
  if (el.tagName === "NAV") return "Navbar";
  if (el.tagName === "HEADER") return "Header";
  if (el.tagName === "FOOTER") return "Footer";
  if (el.tagName === "MAIN") return "Main";
  if (el.tagName === "SECTION") return "Section";
  if (isProbablySection(el)) return "Section";
  if (isProbablyGrid(el)) return "Grid";
  if (isProbablyFlex(el)) return "Flex";
  if (isProbablyContainer(el)) return "Container";
  if (el.tagName === "BUTTON") return "Button";
  if (el.tagName === "A") return "Link";
  if (el.tagName === "IMG") return "Image";
  if (/H[1-6]/.test(el.tagName)) return "Heading";
  if (el.tagName === "P") return "Paragraph";
  if (el.tagName === "UL" || el.tagName === "OL") return "List";
  if (el.tagName === "LI") return "List item";
  if (el.tagName === "FORM") return "Form";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")
    return "Form field";
  return "Div";
}

function clientFirstName(role: string, hint: string) {
  const h = toSlug(hint);
  switch (role) {
    case "Section":
      return `section_${h || "main"}`;
    case "Container":
      return `container_${h || "main"}`;
    case "Grid":
      return `layout_grid_${h || "main"}`;
    case "Flex":
      return `layout_flex_${h || "main"}`;
    case "Navbar":
      return `section_nav_${h || "main"}`;
    case "Footer":
      return `section_footer_${h || "main"}`;
    case "Heading":
      return `text_heading_${h || "main"}`;
    case "Paragraph":
      return `text_body_${h || "main"}`;
    case "Button":
      return `button_${h || "primary"}`;
    case "Link":
      return `link_${h || "default"}`;
    case "Image":
      return `image_${h || "main"}`;
    case "List":
      return `component_list_${h || "main"}`;
    case "Form":
      return `component_form_${h || "main"}`;
    case "Form field":
      return `form_field_${h || "main"}`;
    default:
      return `component_${h || "block"}`;
  }
}

function pickHint(el: any) {
  if (!el) return "";
  const cls = (el.getAttribute("class") || "").trim();
  if (cls) return cls.split(/\s+/)[0];
  const id = (el.getAttribute("id") || "").trim();
  if (id) return id;
  const h = el.querySelector("h1,h2,h3");
  const ht = safeText(h);
  if (ht) return ht.slice(0, 24);
  return el.tagName.toLowerCase();
}

function walk(el: any, depth = 0, acc: any[] = []) {
  if (!el || el.nodeType !== 1) return acc;
  const role = guessWebflowRole(el);
  const hint = pickHint(el);
  const cls = (el.getAttribute("class") || "").trim();
  const id = (el.getAttribute("id") || "").trim();
  const webflowClass = clientFirstName(role, hint);

  acc.push({
    depth,
    tag: el.tagName.toLowerCase(),
    role,
    hint,
    sourceClass: cls,
    sourceId: id,
    webflowClass,
    textSample:
      role === "Heading" || role === "Paragraph" || role === "Link" || role === "Button"
        ? safeText(el).slice(0, 80)
        : "",
  });

  if (depth >= 10) return acc;
  const children = Array.from(el.children || []);
  for (const c of children) walk(c, depth + 1, acc);
  return acc;
}

function buildChecklist(nodes: any[]) {
  const lines: string[] = [];
  const major = nodes.filter((n) =>
    ["Navbar", "Header", "Section", "Main", "Footer", "Container", "Grid", "Flex"].includes(n.role)
  );

  if (!major.length) {
    lines.push("1) Create a Section (Hero/Main)");
    lines.push("2) Add a Container inside");
    lines.push("3) Recreate inner layout using Grid/Flex");
    lines.push("4) Add text/images/buttons as needed");
    return lines.join("\n");
  }

  let step = 1;
  for (const m of major) {
    const indent = "  ".repeat(Math.min(3, m.depth));
    const label = `${m.role} (${m.tag})`;
    const name = m.webflowClass;
    const src =
      m.sourceClass || m.sourceId
        ? ` — from: ${m.sourceClass || ""}${m.sourceId ? `#${m.sourceId}` : ""}`
        : "";
    lines.push(`${step}) ${indent}${label} → class: ${name}${src}`);
    step++;
  }

  lines.push("\nNotes:");
  lines.push("- Build Section → Container → Layout (Grid/Flex) first, then fill content.");
  lines.push("- If something is complex (SVG/3rd-party widgets), keep it as an Embed.");
  return lines.join("\n");
}

function buildClassMap(nodes: any[]) {
  const map = new Map<string, string>();
  for (const n of nodes) {
    if (!n.sourceClass) continue;
    const tokens = n.sourceClass.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (!map.has(t)) map.set(t, n.webflowClass);
    }
  }
  const arr = Array.from(map.entries()).slice(0, 120);
  if (!arr.length) return "(No source classes found in HTML.)";
  return arr.map(([src, wf]) => `- ${src}  →  ${wf}`).join("\n");
}

function buildEmbed(html: string) {
  const trimmed = (html || "").trim();
  if (!trimmed) return "";
  return `<!-- Paste into a Webflow Embed element -->\n${trimmed}`;
}

function prettyJson(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * URL validation:
 * - accepts absolute http(s)
 * - ALSO accepts same-origin relative paths like "/api/html-to-webflow"
 */
function isValidUrl(s: string) {
  if (!s) return false;
  if (typeof s === "string" && s.startsWith("/")) return true;

  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label = "timeout") {
  let t: number | undefined;
  const timeout = new Promise<T>((_, rej) => {
    t = window.setTimeout(() => rej(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(t));
}

function classifyFetchError(err: any) {
  const msg = String(err?.message || err);
  if (/NetworkError when attempting to fetch resource/i.test(msg)) return { kind: "network", msg };
  if (/Failed to fetch/i.test(msg)) return { kind: "network", msg };
  if (/timeout/i.test(msg)) return { kind: "timeout", msg };
  return { kind: "unknown", msg };
}

function isChatGPTPreviewEnv() {
  try {
    const h = window.location.hostname || "";
    return /chat\.openai\.com|chatgpt\.com|oaiusercontent\.com/i.test(h);
  } catch {
    return false;
  }
}

function buildCurlCommand(url: string, payload: any) {
  const body = JSON.stringify(payload).replace(/'/g, "'\\''");
  return `curl -X POST '${url}' \\\n  -H 'content-type: application/json' \\\n  --data '${body}'`;
}

function buildHelpText({
  kind,
  msg,
  target,
  workerUrl,
  payload,
}: {
  kind: string;
  msg: string;
  target: string;
  workerUrl: string;
  payload: any;
}) {
  const curl = buildCurlCommand(workerUrl, payload);
  return [
    `Conversion failed (${kind}): ${msg}`,
    "",
    "Most common causes:",
    "- CORS: Worker does not allow your origin.",
    "- CSP/Sandbox: your environment blocks outbound requests.",
    "- Network: VPN/adblock/corporate proxy blocks workers.dev.",
    "- Endpoint is down.",
    "",
    "What you can do right now:",
    "1) Click 'Ping worker' to see if GET works.",
    "2) If you are in a sandbox, try running on http://localhost or deploy to Netlify/Vercel.",
    "3) If CORS is the problem, set up a same-origin proxy and paste its URL into 'Proxy URL'.",
    "   Proxy contract: POST " + target + " with { targetUrl, payload } returning JSON.",
    "4) Use the curl command below to test outside the browser.",
    "",
    "curl:",
    curl,
    "",
    "Fallback:",
    "- Switch to Helper mode to get a build checklist (no network needed).",
  ].join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ---------------------------
// Component
// ---------------------------

export default function HtmlToWebflowCanvasMVP() {
  const DEFAULT_WORKER_URL = "https://html-to-webflow.moden.workers.dev/";

  const [tab, setTab] = useState<"html" | "css" | "js">("html");
  const [workerUrl, setWorkerUrl] = useState(DEFAULT_WORKER_URL);
  const [proxyUrl, setProxyUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(12000);
  const [retries, setRetries] = useState(2);

  const [html, setHtml] = useState(
    `<!-- Paste your HTML here -->\n<section class="hero">\n  <div class="container">\n    <h1>Title</h1>\n    <p>Subtitle text</p>\n    <a class="btn" href="#">CTA</a>\n  </div>\n</section>`
  );
  const [css, setCss] = useState("");
  const [js, setJs] = useState("");

  const [status, setStatus] = useState<"idle" | "converting" | "ok" | "error">("idle");
  const [toast, setToast] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [lastJson, setLastJson] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);

  const [mode, setMode] = useState<"worker" | "helper">(() => (isChatGPTPreviewEnv() ? "helper" : "worker"));

  // Helper mode outputs
  const helperParsed = useMemo(() => {
    try {
      const p = new DOMParser();
      const doc = p.parseFromString(html || "", "text/html");
      const nodes = walk(doc.body, 0, []);
      return { ok: true, nodes };
    } catch (e: any) {
      return { ok: false, error: String(e), nodes: [] };
    }
  }, [html]);

  const helperOut = useMemo(() => {
    if (!helperParsed.ok) return { checklist: "Parse error", map: "", embed: "" };
    return {
      checklist: buildChecklist(helperParsed.nodes),
      map: buildClassMap(helperParsed.nodes),
      embed: buildEmbed(html),
    };
  }, [helperParsed, html]);

  function showToast(msg: string) {
    setToast(msg);
    // @ts-ignore
    window.clearTimeout((showToast as any)._t);
    // @ts-ignore
    (showToast as any)._t = window.setTimeout(() => setToast(""), 2800);
  }

  function serializeDomNode(node: any) {
    if (!node) return null;

    const TEXT = 3;
    const ELEMENT = 1;

    if (node.nodeType === TEXT) {
      return { t: "t", v: node.nodeValue ?? "" };
    }

    if (node.nodeType === ELEMENT) {
      const tag = (node.tagName || "").toLowerCase();
      const attrs = Array.from(node.attributes || []).map((a: any) => [a.name, a.value ?? ""]);
      const children = Array.from(node.childNodes || [])
        .map(serializeDomNode)
        .filter(Boolean);

      const out: any = { t: "e", tag, attrs, c: children };
      if (tag === "script" || tag === "style") out.text = node.textContent || "";
      return out;
    }

    return null;
  }

  function buildWorkerPayload({ html, css, js }: { html: string; css: string; js: string }) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html || "", "text/html");

    const inlineCss = Array.from(doc.body?.querySelectorAll("style") || [])
      .map((s: any) => s.textContent || "")
      .filter((t: string) => t.trim())
      .join("\n");

    const linkCssHtml = Array.from(doc.head?.querySelectorAll("link[rel='stylesheet']") || [])
      .map((l: any) => l.outerHTML)
      .join("\n");

    const headNodes = Array.from(doc.head?.childNodes || [])
      .map(serializeDomNode)
      .filter(Boolean);

    const bodyNodes = Array.from(doc.body?.childNodes || [])
      .map(serializeDomNode)
      .filter(Boolean);

    return {
      headNodes,
      bodyNodes,
      inlineCss,
      linkCssHtml,
      css: css || "",
      js: js || "",
    };
  }

  function validateInputs({ html }: { html: string }) {
    const h = (html || "").trim();
    if (!h) return { ok: false, msg: "HTML is required (Webflow nodes come from HTML)." };
    return { ok: true };
  }

  async function copyWebflowJSON(xscp: any) {
    const str = JSON.stringify(xscp);

    try {
      if (navigator.clipboard && (window as any).ClipboardItem) {
        const item = new (window as any).ClipboardItem({
          "application/json": new Blob([str], { type: "application/json" }),
          "text/plain": new Blob([str], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
        return { ok: true, mime: "application/json" };
      }
    } catch (_) {}

    try {
      let wroteJson = false;
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const onCopy = (e: any) => {
        let didSet = false;
        try {
          if (e.clipboardData && typeof e.clipboardData.setData === "function") {
            e.clipboardData.setData("application/json", str);
            didSet = true;
            wroteJson = true;
          }
        } catch (_) {}

        // Only prevent default if we successfully wrote custom MIME.
        if (didSet) {
          e.preventDefault();
        }
      };

      ta.addEventListener("copy", onCopy);
      document.execCommand("copy");
      ta.removeEventListener("copy", onCopy);
      document.body.removeChild(ta);

      if (wroteJson) return { ok: true, mime: "application/json" };
    } catch (_) {}

    try {
      await navigator.clipboard?.writeText(str);
      return { ok: true, mime: "text/plain" };
    } catch (_) {
      return { ok: false, mime: "none" };
    }
  }

  function resolveTargetUrl() {
    const useProxy = (proxyUrl || "").trim();
    return useProxy ? useProxy : workerUrl;
  }

  function buildRequestBody(payload: any) {
    const useProxy = (proxyUrl || "").trim();
    return useProxy ? { targetUrl: workerUrl, payload } : payload;
  }

  function toAbsoluteUrl(maybeRelative: string) {
    const s = (maybeRelative || "").trim();
    if (!s) return s;
    if (s.startsWith("/")) return window.location.origin + s;
    return s;
  }

  async function pingWorker() {
    const target = (workerUrl || "").trim();
    if (!isValidUrl(target)) {
      showToast("Worker URL is not a valid http(s) URL.");
      return;
    }

    setErrorDetails("");
    showToast("Pinging worker…");

    try {
      const res = await withTimeout(
        fetch(target, { method: "GET", cache: "no-store", mode: "cors" }),
        Math.max(3000, Math.min(15000, Number(timeoutMs) || 12000)),
        "ping_timeout"
      );
      showToast(`Worker responded: ${res.status}`);
    } catch (e: any) {
      const c = classifyFetchError(e);
      setErrorDetails(`Ping failed (${c.kind}): ${c.msg}`);
      showToast("Ping failed (see details).");
    }
  }

  async function doConvertOnce(payload: any) {
    const targetUrl = resolveTargetUrl();
    if (!isValidUrl(targetUrl)) throw new Error("Target URL is invalid");

    const absTargetUrl = toAbsoluteUrl(targetUrl);
    const bodyObj = buildRequestBody(payload);

    const res = await withTimeout(
      fetch(absTargetUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyObj),
        cache: "no-store",
        mode: "cors",
        referrerPolicy: "no-referrer",
      }),
      Math.max(3000, Math.min(45000, Number(timeoutMs) || 12000)),
      "convert_timeout"
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
    if (data.ok !== true) throw new Error(data.error || data.message || "Worker returned ok=false");
    return data;
  }

  async function handleConvert() {
    if (status === "converting") return;

    const input = { html, css, js };
    const v = validateInputs(input);
    if (!v.ok) {
      showToast(v.msg);
      return;
    }

    if (!isValidUrl(workerUrl)) {
      showToast("Worker URL is not a valid http(s) URL.");
      return;
    }

    if ((proxyUrl || "").trim() && !isValidUrl(proxyUrl)) {
      showToast("Proxy URL is not a valid URL. Use https://... or /api/...");
      return;
    }

    setStatus("converting");
    setErrorDetails("");
    showToast("Converting…");

    const payload = buildWorkerPayload(input);

    let lastErr: any = null;
    const tries = Math.max(1, Math.min(6, Number(retries) + 1 || 1));

    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const data = await doConvertOnce(payload);
        const { xscp, stats } = data;
        setLastJson(xscp);
        setStats(stats || null);

        const copied = await copyWebflowJSON(xscp);
        if (copied.ok && copied.mime === "application/json") {
          showToast("Converted & copied (application/json)! Paste into Webflow.");
        } else if (copied.ok) {
          showToast("Converted, but copied as text/plain — Webflow paste may fail.");
        } else {
          showToast("Converted, but could not copy to clipboard.");
        }

        setStatus("ok");
        return;
      } catch (e: any) {
        lastErr = e;
        if (attempt < tries) await sleep(350 * attempt);
      }
    }

    const c = classifyFetchError(lastErr);
    const target = resolveTargetUrl();
    const help = buildHelpText({ kind: c.kind, msg: c.msg, target, workerUrl, payload });

    setErrorDetails(help);
    showToast("Conversion failed (see details).");
    setStatus("error");
  }

  async function handleCopyAgain() {
    if (!lastJson) {
      showToast("Nothing to copy yet.");
      return;
    }
    const copied = await copyWebflowJSON(lastJson);
    showToast(copied.ok ? `Copied (${copied.mime})` : "Copy failed");
  }

  async function handleCopyPayload() {
    const input = { html, css, js };
    const v = validateInputs(input);
    if (!v.ok) {
      showToast(v.msg);
      return;
    }

    try {
      const payload = buildWorkerPayload(input);
      await navigator.clipboard?.writeText(JSON.stringify(payload));
      showToast("Request payload copied.");
    } catch (e) {
      console.error(e);
      showToast("Could not copy payload.");
    }
  }

  function handleDownloadPayload() {
    const input = { html, css, js };
    const v = validateInputs(input);
    if (!v.ok) {
      showToast(v.msg);
      return;
    }

    try {
      const payload = buildWorkerPayload(input);
      downloadText("html-to-webflow-payload.json", JSON.stringify(payload, null, 2));
      showToast("Payload downloaded.");
    } catch (e) {
      console.error(e);
      showToast("Could not download payload.");
    }
  }

  function handleClear() {
    setHtml("");
    setCss("");
    setJs("");
    setLastJson(null);
    setStats(null);
    setStatus("idle");
    setErrorDetails("");
    showToast("Cleared.");
  }

  // ---------------------------
  // Tests (lightweight, in-app)
  // ---------------------------

  function runSelfTests() {
    const results: { name: string; pass: boolean; details: string }[] = [];

    function expect(name: string, cond: any, details = "") {
      results.push({ name, pass: !!cond, details: cond ? "" : details });
    }

    // Test 1: buildWorkerPayload shape
    try {
      const payload = buildWorkerPayload({
        html: "<html><head><link rel='stylesheet' href='x.css'></head><body><div class='a'><p>Hello</p></div></body></html>",
        css: "body{margin:0}",
        js: "console.log('x')",
      });
      expect("payload.hasHeadNodes", Array.isArray(payload.headNodes), "headNodes should be array");
      expect("payload.hasBodyNodes", Array.isArray(payload.bodyNodes), "bodyNodes should be array");
      expect("payload.hasInlineCss", typeof payload.inlineCss === "string", "inlineCss should be string");
      expect("payload.hasLinkCssHtml", typeof payload.linkCssHtml === "string", "linkCssHtml should be string");
      expect("payload.cssPassthrough", payload.css.includes("margin"), "css should passthrough");
      expect("payload.jsPassthrough", payload.js.includes("console"), "js should passthrough");
    } catch (e: any) {
      expect("payload.noThrow", false, String(e?.message || e));
    }

    // Test 2: helper parsing doesn’t crash on basic HTML
    try {
      const p = new DOMParser();
      const doc = p.parseFromString("<div><h1>Hi</h1></div>", "text/html");
      const nodes = walk(doc.body, 0, []);
      expect("walk.returnsArray", Array.isArray(nodes) && nodes.length > 0, "walk should return nodes");
    } catch (e: any) {
      expect("walk.noThrow", false, String(e?.message || e));
    }

    // Test 3: curl command contains URL and JSON
    try {
      const cmd = buildCurlCommand("https://example.com/", { a: 1, b: "x" });
      expect("curl.includesUrl", cmd.includes("https://example.com/"), "curl should include url");
      expect("curl.includesData", cmd.includes("--data"), "curl should include --data");
      expect("curl.includesJson", cmd.includes("\"a\":1") || cmd.includes("\"a\": 1"), "curl should include json");
    } catch (e: any) {
      expect("curl.noThrow", false, String(e?.message || e));
    }

    // Test 4: classifyFetchError recognizes NetworkError
    try {
      const c = classifyFetchError(new Error("NetworkError when attempting to fetch resource."));
      expect("classify.network", c.kind === "network", `expected network, got ${c.kind}`);
    } catch (e: any) {
      expect("classify.noThrow", false, String(e?.message || e));
    }

    // Test 5: buildHelpText returns a string and includes curl
    try {
      const s = buildHelpText({
        kind: "network",
        msg: "NetworkError when attempting to fetch resource.",
        target: "https://proxy.example.com/api",
        workerUrl: "https://worker.example.com/",
        payload: { a: 1 },
      });
      expect("help.isString", typeof s === "string" && s.length > 10, "help should be a non-empty string");
      expect("help.includesCurl", s.includes("curl -X POST"), "help should include curl command");
      expect("help.includesProxyContract", s.includes("Proxy contract"), "help should mention proxy contract");
    } catch (e: any) {
      expect("help.noThrow", false, String(e?.message || e));
    }

    // Test 6: proxy relative url is valid
    try {
      expect("isValidUrl.relativeProxy", isValidUrl("/api/html-to-webflow") === true, "relative proxy should be valid");
    } catch (e: any) {
      expect("isValidUrl.noThrow", false, String(e?.message || e));
    }

    const failed = results.filter((r) => !r.pass);
    if (failed.length) {
      const report = failed.map((f) => `✗ ${f.name}: ${f.details}`).join("\n");
      setErrorDetails(`Self-tests failed:\n${report}`);
      showToast("Self-tests failed (see details).");
      return;
    }

    setErrorDetails("Self-tests passed.");
    showToast("Self-tests passed.");
  }

  // ---------------------------
  // Render
  // ---------------------------

  const activeValue = tab === "html" ? html : tab === "css" ? css : js;
  const setActiveValue = (v: string) => (tab === "html" ? setHtml(v) : tab === "css" ? setCss(v) : setJs(v));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">HTML → Webflow Converter</h1>
          <p className="mt-2 text-sm text-neutral-300">
            <span className="font-medium">Worker mode</span> sends your HTML/CSS/JS to a Worker and copies Webflow JSON.
            If you get <span className="font-mono">NetworkError</span>, it’s usually CORS/CSP/sandbox/VPN/adblock or endpoint downtime.
          </p>
          {isChatGPTPreviewEnv() ? (
            <div className="mt-3 rounded-2xl border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-100/90">
              You are running inside <span className="font-medium">ChatGPT preview</span>. External network requests are often blocked here, so
              <span className="font-medium"> Worker mode will fail</span> (NetworkError). This demo automatically defaults to Helper mode.
              <div className="mt-2">
                To make Worker mode work, run this app on <span className="font-mono">http://localhost</span> or deploy to Vercel/Netlify.
              </div>
            </div>
          ) : null}
        </header>

        {toast ? (
          <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm">{toast}</div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMode("worker")}
            disabled={isChatGPTPreviewEnv()}
            className={`rounded-xl border px-3 py-1.5 text-xs ${
              mode === "worker"
                ? "border-neutral-200 bg-neutral-800"
                : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
            } ${isChatGPTPreviewEnv() ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Worker mode (paste into Webflow)
          </button>
          <button
            onClick={() => setMode("helper")}
            className={`rounded-xl border px-3 py-1.5 text-xs ${
              mode === "helper" ? "border-neutral-200 bg-neutral-800" : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
            }`}
          >
            Helper mode (checklist)
          </button>
          <button
            onClick={runSelfTests}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs hover:bg-neutral-800"
          >
            Run self-tests
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 shadow">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Input</h2>
              <button
                onClick={handleClear}
                className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs hover:bg-neutral-800"
              >
                Clear
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setTab("html")}
                className={`rounded-xl border px-3 py-1.5 text-xs ${
                  tab === "html" ? "border-neutral-200 bg-neutral-800" : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                HTML
              </button>
              <button
                onClick={() => setTab("css")}
                className={`rounded-xl border px-3 py-1.5 text-xs ${
                  tab === "css" ? "border-neutral-200 bg-neutral-800" : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                CSS
              </button>
              <button
                onClick={() => setTab("js")}
                className={`rounded-xl border px-3 py-1.5 text-xs ${
                  tab === "js" ? "border-neutral-200 bg-neutral-800" : "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                }`}
              >
                JS
              </button>
            </div>

            <textarea
              value={activeValue}
              onChange={(e) => setActiveValue(e.target.value)}
              className="mt-3 h-[420px] w-full resize-none rounded-2xl border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs leading-relaxed"
              spellCheck={false}
              placeholder={tab === "html" ? "Paste your HTML here." : tab === "css" ? "Paste your CSS here." : "Paste your JS here."}
            />

            {mode === "worker" ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-neutral-200">Worker URL</div>
                  <input
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                    placeholder={DEFAULT_WORKER_URL}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-neutral-200">Proxy URL (optional)</div>
                  <input
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                    placeholder="/api/html-to-webflow  (recommended)"
                  />
                  <div className="mt-1 text-[11px] text-neutral-400">
                    Tip: On Vercel, set this to <span className="font-mono">/api/html-to-webflow</span> (same-origin proxy).
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-neutral-200">Timeout (ms)</div>
                    <input
                      type="number"
                      min={3000}
                      max={45000}
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(Number(e.target.value || 12000))}
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold text-neutral-200">Retries</div>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      value={retries}
                      onChange={(e) => setRetries(Number(e.target.value || 0))}
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleConvert}
                    disabled={status === "converting"}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {status === "converting" ? "Converting…" : "Convert to Webflow"}
                  </button>
                  <button
                    onClick={pingWorker}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800"
                  >
                    Ping worker
                  </button>
                  <button
                    onClick={handleCopyPayload}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800"
                  >
                    Copy request payload
                  </button>
                  <button
                    onClick={handleDownloadPayload}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800"
                  >
                    Download payload
                  </button>
                  <button
                    onClick={handleCopyAgain}
                    disabled={!lastJson}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60"
                  >
                    Copy last JSON
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 shadow">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Output</h2>
              <div className="text-xs text-neutral-400">{mode === "worker" ? (lastJson ? "JSON ready" : "Run Convert") : "Checklist"}</div>
            </div>

            <div className="mt-3 space-y-4">
              {mode === "worker" ? (
                <>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-300">
                    <div className="font-semibold text-neutral-200">How to paste into Webflow</div>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      <li>In Webflow Designer, click an empty spot on the canvas.</li>
                      <li>
                        Press <span className="font-mono">Ctrl/Cmd + V</span>.
                      </li>
                      <li>
                        If nothing happens, clipboard likely contains <span className="font-mono">text/plain</span>, not{" "}
                        <span className="font-mono">application/json</span>.
                      </li>
                    </ol>
                  </div>

                  {stats ? (
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-sm">
                      <div className="mb-2 text-xs font-semibold text-neutral-200">Stats</div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-neutral-300">
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-2">Nodes: {String(stats.nodes ?? 0)}</div>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-2">Styles: {String(stats.styles ?? 0)}</div>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-2">Embeds: {String(stats.embeds ?? 0)}</div>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-2">Assets: {String(stats.assets ?? 0)}</div>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-2 text-xs font-semibold text-neutral-200">Last JSON (preview)</div>
                    <pre className="max-h-[320px] overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
                      {lastJson ? prettyJson(lastJson) : "(Nothing yet)"}
                    </pre>
                  </div>
                </>
              ) : (
                <>
                  {!helperParsed.ok ? (
                    <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">{(helperParsed as any).error}</div>
                  ) : null}

                  <div>
                    <div className="mb-2 text-xs font-semibold text-neutral-200">Webflow build checklist</div>
                    <pre className="max-h-[220px] overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
                      {helperOut.checklist}
                    </pre>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold text-neutral-200">Source class → suggested Webflow class</div>
                    <pre className="max-h-[160px] overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
                      {helperOut.map}
                    </pre>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold text-neutral-200">Embed code (if needed)</div>
                    <pre className="max-h-[160px] overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-xs leading-relaxed">
                      {helperOut.embed}
                    </pre>
                  </div>
                </>
              )}

              {errorDetails ? (
                <div className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-3">
                  <div className="mb-2 text-xs font-semibold text-amber-200">Details</div>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-amber-100/90">{errorDetails}</pre>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="mt-8 text-xs text-neutral-500">
          Note: If Worker mode fails due to CORS, a same-origin proxy is the most reliable fix. Otherwise use Helper mode.
        </footer>
      </div>
    </div>
  );
}
