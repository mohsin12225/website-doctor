const fetch = require("node-fetch");
const cheerio = require("cheerio");

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function truncate(str, len) {
    if (!str) return "";
    return str.length > len ? str.substring(0, len) + "…" : str;
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function respond(statusCode, body) {
    return {
        statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
    };
}

// ──────────────────────────────────────────────
// HTML Extraction
// ──────────────────────────────────────────────
function extractPageData(html, parsedUrl) {
    const $ = cheerio.load(html);

    // Basic meta
    const title = $("title").first().text().trim();
    const metaDesc =
        $('meta[name="description"]').attr("content")?.trim() || "";
    const metaKeywords =
        $('meta[name="keywords"]').attr("content")?.trim() || "";
    const hasViewport = $('meta[name="viewport"]').length > 0;
    const hasFavicon =
        $(
            'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
        ).length > 0;
    const canonicalUrl = $('link[rel="canonical"]').attr("href") || "";
    const lang = $("html").attr("lang") || "";

    // Open Graph
    const ogTitle = $('meta[property="og:title"]').attr("content") || "";
    const ogDesc = $('meta[property="og:description"]').attr("content") || "";
    const ogImage = $('meta[property="og:image"]').attr("content") || "";

    // Structured data
    const hasStructuredData =
        $('script[type="application/ld+json"]').length > 0;

    // Headings
    const headings = {};
    let h1Count = 0;
    for (let i = 1; i <= 6; i++) {
        const tags = $(`h${i}`);
        if (tags.length > 0) {
            const samples = [];
            tags.slice(0, 3).each((_, el) => {
                const t = $(el).text().trim().replace(/\s+/g, " ");
                if (t) samples.push(truncate(t, 80));
            });
            headings[`h${i}`] = { count: tags.length, samples };
            if (i === 1) h1Count = tags.length;
        }
    }

    // Images
    let totalImages = 0;
    let imagesWithoutAlt = 0;
    $("img").each((_, el) => {
        totalImages++;
        const alt = $(el).attr("alt");
        if (!alt || !alt.trim()) imagesWithoutAlt++;
    });

    // Links
    let totalLinks = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    let emptyLinks = 0;

    $("a[href]").each((_, el) => {
        totalLinks++;
        const href = $(el).attr("href") || "";
        if (href === "#" || href === "" || href.startsWith("javascript:")) {
            emptyLinks++;
        } else if (href.startsWith("http")) {
            if (href.includes(parsedUrl.hostname)) internalLinks++;
            else externalLinks++;
        } else if (href.startsWith("/") || href.startsWith(".")) {
            internalLinks++;
        }
    });

    // Semantic HTML
    const hasNav = $("nav").length > 0;
    const hasMain = $("main").length > 0;
    const hasFooter = $("footer").length > 0;
    const formCount = $("form").length;
    const buttonCount = $(
        'button, input[type="submit"], [role="button"]'
    ).length;
    const stylesheetCount = $('link[rel="stylesheet"]').length;
    const scriptCount = $("script[src]").length;

    // Text content — remove non-visible elements first
    const $body = $("body").clone();
    $body.find("script, style, noscript, svg, iframe").remove();
    const bodyText = $body.text().replace(/\s+/g, " ").trim();
    const wordCount = bodyText
        .split(/\s+/)
        .filter((w) => w.length > 1).length;
    const textSample = truncate(bodyText, 2000);

    return {
        title,
        titleLength: title.length,
        metaDesc,
        metaDescLength: metaDesc.length,
        metaKeywords,
        hasViewport,
        hasFavicon,
        canonicalUrl: !!canonicalUrl,
        lang,
        ogTitle: !!ogTitle,
        ogDesc: !!ogDesc,
        ogImage: !!ogImage,
        hasStructuredData,
        headings,
        h1Count,
        totalImages,
        imagesWithoutAlt,
        totalLinks,
        internalLinks,
        externalLinks,
        emptyLinks,
        hasNav,
        hasMain,
        hasFooter,
        formCount,
        buttonCount,
        stylesheetCount,
        scriptCount,
        wordCount,
        textSample,
        htmlSizeKB: Math.round(html.length / 1024),
    };
}

// ──────────────────────────────────────────────
// Groq prompt
// ──────────────────────────────────────────────
function buildPrompt(url, data) {
    return `You are a professional website auditor writing for non-technical business owners.
Analyze the REAL data below. Base every score and finding strictly on this data.
Do NOT invent issues that the data does not support.

═══ WEBSITE DATA ═══
URL: ${url}
HTML Size: ${data.htmlSizeKB} KB

SEO:
• Title: "${data.title}" (${data.titleLength} chars)
• Meta description: "${truncate(data.metaDesc, 300)}" (${data.metaDescLength} chars)
• Keywords meta: ${data.metaKeywords || "not set"}
• Canonical tag: ${data.canonicalUrl}
• Open Graph: title=${data.ogTitle}, desc=${data.ogDesc}, image=${data.ogImage}
• Structured data (JSON-LD): ${data.hasStructuredData}
• H1 tags: ${data.h1Count}
• All headings: ${JSON.stringify(data.headings)}

Content:
• Word count: ${data.wordCount}
• Images: ${data.totalImages} total, ${data.imagesWithoutAlt} missing alt text
• Links: ${data.totalLinks} total (internal ${data.internalLinks}, external ${data.externalLinks}, empty ${data.emptyLinks})
• Forms: ${data.formCount}
• Buttons/CTAs: ${data.buttonCount}

Technical:
• HTTPS: ${url.startsWith("https")}
• Viewport meta: ${data.hasViewport}
• Favicon: ${data.hasFavicon}
• Language attr: ${data.lang || "not set"}
• Semantic HTML: nav=${data.hasNav}, main=${data.hasMain}, footer=${data.hasFooter}
• CSS files: ${data.stylesheetCount}, JS files: ${data.scriptCount}

Content sample:
"${data.textSample}"

═══ INSTRUCTIONS ═══
Return ONLY a JSON object — no markdown, no backticks, no extra text.

{
  "totalScore": <number 0-100>,
  "seoScore": <number 0-100>,
  "performanceScore": <number 0-100>,
  "uxScore": <number 0-100>,
  "summary": "<2-3 plain-English sentences referencing this specific website>",
  "goodThings": ["<finding backed by data above>", ...],
  "problems": ["<issue backed by data above>", ...],
  "fixes": [
    {
      "title": "<short title>",
      "description": "<plain-English explanation>",
      "example": "<concrete before → after using their actual content>",
      "priority": "high | medium | low"
    }
  ],
  "suggestions": ["<actionable growth tip>", ...]
}

Counts: goodThings 3-6, problems 3-6, fixes 4-6, suggestions 3-5.
Use simple language. Be honest but encouraging.`;
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
exports.handler = async (event) => {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }

    if (event.httpMethod !== "POST") {
        return respond(405, { error: true, message: "Method not allowed" });
    }

    // ── Parse input ──────────────────────────────
    let url;
    try {
        const body = JSON.parse(event.body || "{}");
        url = (body.url || "").trim();
    } catch {
        return respond(400, { error: true, message: "Invalid request body." });
    }

    if (!url) {
        return respond(400, {
            error: true,
            message: "Please provide a website URL.",
        });
    }

    // Normalise
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
        if (!parsedUrl.hostname.includes(".")) throw new Error("bad host");
    } catch {
        return respond(400, {
            error: true,
            message:
                "That doesn't look like a valid URL. Try something like example.com",
        });
    }

    // ── Step 1  Fetch website ────────────────────
    let html, fetchTimeMs;
    try {
        const t0 = Date.now();
        const res = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            timeout: 15000,
            redirect: "follow",
            size: 5 * 1024 * 1024,
        });
        fetchTimeMs = Date.now() - t0;

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
            return respond(200, {
                error: true,
                message: `The server at ${parsedUrl.hostname} did not return an HTML page (got ${ct}). Make sure the URL points to a real web page.`,
            });
        }

        html = await res.text();
    } catch (err) {
        return respond(200, {
            error: true,
            message: `Could not reach ${parsedUrl.hostname}. The site may be down, blocking automated requests, or the address may be wrong.`,
            details: err.message,
        });
    }

    // Trim very large pages to keep processing fast
    if (html.length > 500000) html = html.substring(0, 500000);

    // ── Step 2  Extract data ─────────────────────
    let pageData;
    try {
        pageData = extractPageData(html, parsedUrl);
    } catch (err) {
        return respond(200, {
            error: true,
            message:
                "The website HTML could not be parsed. It may use an unusual format.",
            details: err.message,
        });
    }

    // ── Step 3  Call Groq AI ─────────────────────
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return respond(500, {
            error: true,
            message:
                "Server configuration error: GROQ_API_KEY is not set. Please add it in your Netlify environment variables.",
        });
    }

    let aiContent;
    try {
        const groqRes = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 30000,
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a website audit API. Respond with valid JSON only. No markdown, no code fences, no extra text.",
                        },
                        { role: "user", content: buildPrompt(url, pageData) },
                    ],
                    temperature: 0.2,
                    max_tokens: 2500,
                }),
            }
        );

        if (!groqRes.ok) {
            const errText = await groqRes.text();
            console.error("Groq API error:", groqRes.status, errText);
            return respond(200, {
                error: true,
                message:
                    groqRes.status === 429
                        ? "The AI service is rate-limited. Please wait a minute and try again."
                        : "The AI analysis service returned an error. Please try again shortly.",
            });
        }

        const groqData = await groqRes.json();
        if (!groqData.choices?.[0]?.message?.content) {
            return respond(200, {
                error: true,
                message: "The AI returned an empty response. Please try again.",
            });
        }
        aiContent = groqData.choices[0].message.content.trim();
    } catch (err) {
        return respond(200, {
            error: true,
            message:
                "Could not reach the AI analysis service. Please try again in a moment.",
            details: err.message,
        });
    }

    // ── Step 4  Parse AI response ────────────────
    let report;
    try {
        let cleaned = aiContent
            .replace(/```json\s*/gi, "")
            .replace(/```\s*/g, "");
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON object in AI output");
        report = JSON.parse(match[0]);
    } catch (err) {
        console.error("AI parse error:", err.message, "Raw:", aiContent);
        return respond(200, {
            error: true,
            message:
                "The AI response could not be interpreted. Please try again.",
        });
    }

    // Sanitise scores
    report.totalScore = clamp(Number(report.totalScore) || 0, 0, 100);
    report.seoScore = clamp(Number(report.seoScore) || 0, 0, 100);
    report.performanceScore = clamp(Number(report.performanceScore) || 0, 0, 100);
    report.uxScore = clamp(Number(report.uxScore) || 0, 0, 100);
    report.summary = String(report.summary || "Analysis complete.");
    report.goodThings = Array.isArray(report.goodThings)
        ? report.goodThings.map(String)
        : [];
    report.problems = Array.isArray(report.problems)
        ? report.problems.map(String)
        : [];
    report.fixes = Array.isArray(report.fixes) ? report.fixes : [];
    report.suggestions = Array.isArray(report.suggestions)
        ? report.suggestions.map(String)
        : [];

    // Attach metadata so the frontend knows what was extracted
    report.url = url;
    report.domain = parsedUrl.hostname.replace(/^www\./, "");
    report.analyzedAt = new Date().toISOString();
    report.fetchTimeMs = fetchTimeMs;
    report.extractedData = pageData;

    return respond(200, report);

};
