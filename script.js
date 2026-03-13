/* ═══════════════════════════════════════════
   DOM REFERENCES
   ═══════════════════════════════════════════ */
const $form = document.getElementById("searchForm");
const $input = document.getElementById("urlInput");
const $btn = document.getElementById("analyzeBtn");
const $hero = document.getElementById("hero");
const $loading = document.getElementById("loadingSection");
const $loadingDomain = document.getElementById("loadingDomain");
const $loadingStatus = document.getElementById("loadingStatus");
const $error = document.getElementById("errorSection");
const $errorTitle = document.getElementById("errorTitle");
const $errorText = document.getElementById("errorText");
const $results = document.getElementById("resultsSection");
const $mount = document.getElementById("reportMount");

/* ═══════════════════════════════════════════
   EVENT LISTENERS
   ═══════════════════════════════════════════ */
$form.addEventListener("submit", (e) => {
    e.preventDefault();
    startAnalysis();
});

document.querySelectorAll(".chip[data-url]").forEach((chip) => {
    chip.addEventListener("click", () => {
        $input.value = chip.dataset.url;
        $input.focus();
    });
});

document.getElementById("errorRetryBtn").addEventListener("click", () => {
    showView("hero");
    $input.focus();
});

/* ═══════════════════════════════════════════
   VIEW MANAGEMENT
   ═══════════════════════════════════════════ */
function showView(name) {
    $hero.style.display = name === "hero" ? "" : "none";
    $loading.classList.toggle("active", name === "loading");
    $error.classList.toggle("active", name === "error");
    $results.classList.toggle("active", name === "results");
}

/* ═══════════════════════════════════════════
   LOADING STATUS MESSAGES
   These rotate while the real request is
   in progress. They describe what the server
   is actually doing — not fake progress.
   ═══════════════════════════════════════════ */
let statusInterval = null;

function startStatusCycle() {
    const msgs = [
        "Connecting to website…",
        "Downloading page HTML…",
        "Extracting page structure…",
        "Reading headings, images, links…",
        "Sending data to AI for analysis…",
        "AI is reviewing your website…",
        "Building your report…",
    ];
    let i = 0;
    $loadingStatus.textContent = msgs[0];
    statusInterval = setInterval(() => {
        i++;
        if (i < msgs.length) {
            $loadingStatus.textContent = msgs[i];
        }
    }, 3000);
}

function stopStatusCycle() {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = null;
}

/* ═══════════════════════════════════════════
   CORE: ANALYSIS
   ═══════════════════════════════════════════ */
async function startAnalysis() {
    const raw = $input.value.trim();
    if (!raw) {
        toast("Please enter a website URL.", "⚠️");
        $input.focus();
        return;
    }

    // Basic client-side check
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
        const u = new URL(url);
        if (!u.hostname.includes(".")) throw new Error();
    } catch {
        toast("That doesn't look like a valid URL.", "⚠️");
        $input.focus();
        return;
    }

    // Show loading
    $btn.classList.add("is-loading");
    $btn.disabled = true;
    $loadingDomain.textContent = new URL(url).hostname;
    showView("loading");
    startStatusCycle();
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
        const res = await fetch("/.netlify/functions/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: raw }),
        });

        const data = await res.json();

        stopStatusCycle();
        $btn.classList.remove("is-loading");
        $btn.disabled = false;

        // Check for error response from our function
        if (data.error) {
            $errorTitle.textContent = "Analysis Failed";
            $errorText.textContent = data.message || "Something went wrong.";
            showView("error");
            return;
        }

        // Validate that we got a real report
        if (typeof data.totalScore !== "number" || !data.summary) {
            $errorTitle.textContent = "Unexpected Response";
            $errorText.textContent =
                "The server returned an unexpected format. Please try again.";
            showView("error");
            return;
        }

        // Render report
        renderReport(data);
        showView("results");
        window.currentReport = data;

        // Animate scores after DOM is painted
        requestAnimationFrame(() => {
            requestAnimationFrame(() => animateScores());
        });
    } catch (err) {
        stopStatusCycle();
        $btn.classList.remove("is-loading");
        $btn.disabled = false;

        $errorTitle.textContent = "Network Error";
        $errorText.textContent =
            "Could not connect to the analysis server. Check your internet connection and try again.";
        showView("error");
        console.error("Fetch error:", err);
    }
}

/* ═══════════════════════════════════════════
   RENDER REPORT
   ═══════════════════════════════════════════ */
function renderReport(r) {
    const date = new Date(r.analyzedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    const fillClass = (s) => (s >= 70 ? "fill-good" : s >= 45 ? "fill-ok" : "fill-bad");

    const esc = (s) => {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    };

    // Build sections
    const goodHTML = (r.goodThings || [])
        .map(
            (t) => `<div class="item-row row-good"><span class="item-dot">✅</span><span>${esc(t)}</span></div>`
        )
        .join("");

    const probHTML = (r.problems || [])
        .map(
            (t) => `<div class="item-row row-bad"><span class="item-dot">❌</span><span>${esc(t)}</span></div>`
        )
        .join("");

    const fixHTML = (r.fixes || [])
        .map(
            (f, i) => `
    <div class="fix-card">
      <div class="fix-top">
        <div class="fix-title-row">
          <span>🔧</span>
          <strong>${esc(f.title || "")}</strong>
        </div>
        <span class="fix-priority pri-${f.priority || "medium"}">${esc(
                (f.priority || "medium").toUpperCase()
            )}</span>
      </div>
      <div class="fix-desc">${esc(f.description || "")}</div>
      ${f.example
                    ? `<div class="fix-example">
              <button class="copy-btn" data-idx="${i}" onclick="copyFix(this)">📋 Copy</button>
              <pre>${esc(f.example)}</pre>
            </div>`
                    : ""
                }
    </div>`
        )
        .join("");

    const sugHTML = (r.suggestions || [])
        .map(
            (t) => `<div class="item-row row-tip"><span class="item-dot">💡</span><span>${esc(t)}</span></div>`
        )
        .join("");

    // Extracted data card
    const ed = r.extractedData || {};
    const rdHTML = `
    <div class="raw-data-card">
      <h4>Raw Data We Extracted</h4>
      <div class="raw-data-grid">
        <div class="raw-data-item"><span>Title: </span>${esc(ed.title || "—")}</div>
        <div class="raw-data-item"><span>Title length: </span>${ed.titleLength || 0} chars</div>
        <div class="raw-data-item"><span>Meta description: </span>${ed.metaDescLength || 0} chars</div>
        <div class="raw-data-item"><span>HTTPS: </span>${ed.hasSSL ? "Yes ✅" : "No ❌"}</div>
        <div class="raw-data-item"><span>Mobile viewport: </span>${ed.hasViewport ? "Yes ✅" : "No ❌"}</div>
        <div class="raw-data-item"><span>Favicon: </span>${ed.hasFavicon ? "Yes ✅" : "No ❌"}</div>
        <div class="raw-data-item"><span>H1 tags: </span>${ed.h1Count || 0}</div>
        <div class="raw-data-item"><span>Images: </span>${ed.totalImages || 0} total, ${ed.imagesWithoutAlt || 0} no alt</div>
        <div class="raw-data-item"><span>Links: </span>${ed.totalLinks || 0} total</div>
        <div class="raw-data-item"><span>Word count: </span>${ed.wordCount || 0}</div>
        <div class="raw-data-item"><span>HTML size: </span>${ed.htmlSizeKB || 0} KB</div>
        <div class="raw-data-item"><span>Structured data: </span>${ed.hasStructuredData ? "Yes ✅" : "No ❌"}</div>
      </div>
    </div>`;

    $mount.innerHTML = `
    <!-- Banner -->
    <div class="report-banner">
      <div class="report-banner-left">
        <div class="report-url">🔗 ${esc(r.url)}</div>
        <h2>Website Audit Report</h2>
        <div class="report-date">📅 ${date} · Response time: ${r.fetchTimeMs || "—"}ms</div>
      </div>
      <div class="ring-wrap">
        <div class="ring-inner">
          <svg viewBox="0 0 90 90">
            <circle class="ring-bg" cx="45" cy="45" r="40"/>
            <circle class="ring-fg" cx="45" cy="45" r="40" data-score="${r.totalScore}"/>
          </svg>
          <div class="ring-value" data-target="${r.totalScore}">0</div>
        </div>
        <div class="ring-label">Overall Score</div>
      </div>
    </div>

    <!-- Summary -->
    <div class="summary-box">
      <span class="summary-icon">💡</span>
      <div>${r.summary}</div>
    </div>

    <!-- Scores -->
    <div class="scores-row">
      <div class="sc-card">
        <div class="sc-label">SEO</div>
        <div class="sc-num" data-target="${r.seoScore}">0</div>
        <div class="sc-max">/ 100</div>
        <div class="sc-bar"><div class="sc-bar-fill ${fillClass(r.seoScore)}" data-w="${r.seoScore}"></div></div>
      </div>
      <div class="sc-card">
        <div class="sc-label">Performance</div>
        <div class="sc-num" data-target="${r.performanceScore}">0</div>
        <div class="sc-max">/ 100</div>
        <div class="sc-bar"><div class="sc-bar-fill ${fillClass(r.performanceScore)}" data-w="${r.performanceScore}"></div></div>
      </div>
      <div class="sc-card">
        <div class="sc-label">UX</div>
        <div class="sc-num" data-target="${r.uxScore}">0</div>
        <div class="sc-max">/ 100</div>
        <div class="sc-bar"><div class="sc-bar-fill ${fillClass(r.uxScore)}" data-w="${r.uxScore}"></div></div>
      </div>
    </div>

    <!-- Good Things -->
    ${makeSection("ico-good", "👍", "Good Things", r.goodThings?.length || 0, "positive findings", goodHTML, true)}

    <!-- Problems -->
    ${makeSection("ico-bad", "⚠️", "Problems Found", r.problems?.length || 0, "issues need attention", probHTML, true)}

    <!-- Fixes -->
    ${makeSection("ico-fix", "🔧", "Simple Fixes", r.fixes?.length || 0, "actionable recommendations", fixHTML, true)}

    <!-- Suggestions -->
    ${makeSection("ico-tip", "🚀", "Additional Suggestions", r.suggestions?.length || 0, "growth tips", sugHTML, false)}

    <!-- Raw data -->
    ${rdHTML}

    <!-- Export -->
    <div class="export-bar">
      <button class="btn-primary" onclick="downloadReport()">📥 Download Report</button>
      <button class="btn-outline" onclick="copyFullReport()">📋 Copy to Clipboard</button>
      <button class="btn-outline" onclick="analyzeAnother()">🔄 Analyze Another</button>
    </div>
  `;

    // Attach section toggles
    $mount.querySelectorAll(".rpt-header").forEach((hdr) => {
        hdr.addEventListener("click", () => {
            hdr.closest(".rpt-section").classList.toggle("open");
        });
    });
}

function makeSection(iconClass, emoji, title, count, countLabel, bodyHTML, openDefault) {
    return `
    <div class="rpt-section ${openDefault ? "open" : ""}">
      <div class="rpt-header">
        <div class="rpt-header-left">
          <div class="rpt-icon ${iconClass}">${emoji}</div>
          <div>
            <div class="rpt-title">${title}</div>
            <div class="rpt-count">${count} ${countLabel}</div>
          </div>
        </div>
        <svg class="rpt-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="rpt-body-wrap">
        <div class="rpt-body">${bodyHTML}</div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════
   SCORE ANIMATION
   ═══════════════════════════════════════════ */
function animateScores() {
    // Number counters
    document.querySelectorAll("[data-target]").forEach((el) => {
        const target = parseInt(el.dataset.target, 10);
        if (isNaN(target)) return;
        countUp(el, target, 1200);
    });

    // Bar fills
    document.querySelectorAll(".sc-bar-fill[data-w]").forEach((bar) => {
        bar.style.width = bar.dataset.w + "%";
    });

    // Ring
    document.querySelectorAll(".ring-fg[data-score]").forEach((circle) => {
        const score = parseInt(circle.dataset.score, 10);
        const offset = 251.2 - (251.2 * score) / 100;
        circle.style.strokeDashoffset = offset;
    });

    // Scroll to banner
    setTimeout(() => {
        $results.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
}

function countUp(el, target, duration) {
    const start = performance.now();
    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * ease);
        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

/* ═══════════════════════════════════════════
   COPY & DOWNLOAD
   ═══════════════════════════════════════════ */
function copyFix(btn) {
    const idx = parseInt(btn.dataset.idx, 10);
    const fix = window.currentReport?.fixes?.[idx];
    if (!fix) return;
    const text = `${fix.title}\n${fix.description}\n\nExample:\n${fix.example || ""}`;
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "✅ Copied";
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = "📋 Copy";
            btn.classList.remove("copied");
        }, 2000);
    });
}

function copyFullReport() {
    const r = window.currentReport;
    if (!r) return;
    const lines = [
        `Website Audit Report for ${r.url}`,
        `Date: ${r.analyzedAt}`,
        "",
        `Scores: Overall ${r.totalScore}/100 | SEO ${r.seoScore}/100 | Performance ${r.performanceScore}/100 | UX ${r.uxScore}/100`,
        "",
        `Summary: ${r.summary}`,
        "",
        "GOOD THINGS:",
        ...(r.goodThings || []).map((g) => `  ✅ ${g}`),
        "",
        "PROBLEMS:",
        ...(r.problems || []).map((p) => `  ❌ ${p}`),
        "",
        "FIXES:",
        ...(r.fixes || []).map(
            (f) => `  🔧 [${(f.priority || "").toUpperCase()}] ${f.title}\n     ${f.description}${f.example ? "\n     Example: " + f.example : ""}`
        ),
        "",
        "SUGGESTIONS:",
        ...(r.suggestions || []).map((s) => `  💡 ${s}`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
        toast("Report copied to clipboard!", "✅");
    });
}

function downloadReport() {
    const r = window.currentReport;
    if (!r) return;
    const lines = [
        "═══════════════════════════════════════",
        "  WEBSITE AUDIT REPORT",
        "═══════════════════════════════════════",
        "",
        `URL:  ${r.url}`,
        `Date: ${new Date(r.analyzedAt).toLocaleString()}`,
        "",
        "── SCORES ──────────────────────────────",
        `Overall:     ${r.totalScore}/100`,
        `SEO:         ${r.seoScore}/100`,
        `Performance: ${r.performanceScore}/100`,
        `UX:          ${r.uxScore}/100`,
        "",
        "── SUMMARY ─────────────────────────────",
        r.summary,
        "",
        "── GOOD THINGS ─────────────────────────",
        ...(r.goodThings || []).map((g, i) => `${i + 1}. ${g}`),
        "",
        "── PROBLEMS ────────────────────────────",
        ...(r.problems || []).map((p, i) => `${i + 1}. ${p}`),
        "",
        "── FIXES ───────────────────────────────",
        ...(r.fixes || []).map(
            (f, i) =>
                `\n${i + 1}. ${f.title} [${(f.priority || "").toUpperCase()}]\n   ${f.description}${f.example ? "\n   Example: " + f.example : ""}`
        ),
        "",
        "── SUGGESTIONS ─────────────────────────",
        ...(r.suggestions || []).map((s, i) => `${i + 1}. ${s}`),
        "",
        "═══════════════════════════════════════",
        "Generated by Website Doctor AI",
        "",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${r.domain}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function analyzeAnother() {
    showView("hero");
    $input.value = "";
    $input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ═══════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════ */
function toast(msg, icon) {
    const $toast = document.getElementById("toast");
    document.getElementById("toastIcon").textContent = icon || "ℹ️";
    document.getElementById("toastMessage").textContent = msg;
    $toast.classList.add("visible");
    setTimeout(() => $toast.classList.remove("visible"), 3000);
}