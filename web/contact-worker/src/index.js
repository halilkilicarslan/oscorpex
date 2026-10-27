// Oscorpex contact form Worker — receives form POSTs and sends email via Resend.
// Secret: RESEND_API_KEY (set with `wrangler secret put RESEND_API_KEY`)

const ALLOWED_ORIGINS = new Set([
  "https://oscorpex.com",
  "https://www.oscorpex.com",
  "https://oscorpex-37fa4.web.app",
  "http://localhost:8099",
]);

const TO = "hello@oscorpex.com";
// Must be a Resend-verified domain. Until oscorpex.com is verified in Resend,
// use "onboarding@resend.dev" here for testing.
const FROM = "Oscorpex Website <noreply@oscorpex.com>";
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://oscorpex.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, origin);
    }

    const { name, email, company, message } = data || {};
    if (!name || !email || !message || !emailRe.test(email)) {
      return json({ error: "Missing or invalid fields" }, 400, origin);
    }
    if (String(message).length > 5000 || String(name).length > 200) {
      return json({ error: "Input too long" }, 400, origin);
    }

    const text =
      `Name: ${name}\n` +
      `Email: ${email}\n` +
      (company ? `Company: ${company}\n` : "") +
      `\nMessage:\n${message}\n`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `New contact from ${name}`,
        text,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return json({ error: "Email provider error", detail }, 502, origin);
    }

    return json({ ok: true }, 200, origin);
  },
};
