// Browser edition of the AI Trends Analysis Pipeline.
// Mirrors analyzer_agent/agent.py: Exa → Tavily → Summary → Firecrawl → Analysis.
// There is no backend: every request goes straight from the visitor's browser to the provider.

const STORE_KEY = "ai-trend-agent:keys";
const NEBIUS_URL = "https://tokenfactory.nebius.com/";
const $ = (s) => document.querySelector(s);

const form = $("#keys");
const output = $("#output");
let controller = null;
let finalMarkdown = "";

// ---------- helpers ----------
const trim = (t, n = 1200) => {
  t = (t || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + " …" : t;
};
const stripThink = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
const render = (md) => DOMPurify.sanitize(marked.parse(md || ""));
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

async function postJSON(url, body, headers, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}: ${trim(await res.text(), 300)}`);
  return res.json();
}

// Streams an OpenAI-compatible chat completion from Nebius, calling onText with the full text so far.
async function chat(cfg, model, system, user, onText, signal) {
  const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.nebius}` },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.4,
      max_tokens: 4096,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Nebius (${model}) → HTTP ${res.status}: ${trim(await res.text(), 300)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep a possibly incomplete line for the next chunk
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) { text += delta; onText(stripThink(text)); }
      } catch { /* ignore keep-alive / partial frames */ }
    }
  }
  return stripThink(text);
}

// ---------- tools (same queries as tools.py) ----------
async function exaSearch(cfg, signal) {
  const query = "Latest AI news OR new LLM models OR AI/Agents advancements";
  if (cfg.exa) {
    try {
      const data = await postJSON("https://api.exa.ai/search", {
        query, type: "auto", numResults: 10,
        includeDomains: ["twitter.com", "x.com"],
        startPublishedDate: daysAgo(30),
        contents: { text: { maxCharacters: 1200 }, highlights: { highlightsPerUrl: 2, numSentences: 3 } },
      }, { "x-api-key": cfg.exa }, signal);
      return {
        source: "Exa",
        results: (data.results || []).map((r) => ({
          title: r.title, url: r.url, author: r.author, published: r.publishedDate,
          highlights: r.highlights, text: trim(r.text),
        })),
      };
    } catch (e) {
      // A CORS block surfaces as a TypeError; anything else (bad key, quota) is a real error.
      if (!(e instanceof TypeError) || signal.aborted) throw e;
    }
  }
  const data = await postJSON("https://api.tavily.com/search", {
    query, topic: "news", search_depth: "advanced", time_range: "month",
    include_domains: ["x.com", "twitter.com"], max_results: 10,
  }, { Authorization: `Bearer ${cfg.tavily}` }, signal);
  return {
    source: "Tavily (X/Twitter fallback — Exa blocks browser requests)",
    results: (data.results || []).map((r) => ({ title: r.title, url: r.url, text: trim(r.content) })),
  };
}

async function tavilySearch(cfg, signal) {
  const data = await postJSON("https://api.tavily.com/search", {
    query: "AI benchmarks OR AI/LLM statistics OR AI providers analysis",
    search_depth: "advanced", time_range: "week",
    include_domains: ["artificialanalysis.ai"], max_results: 8,
  }, { Authorization: `Bearer ${cfg.tavily}` }, signal);
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, score: r.score, content: trim(r.content) }));
}

async function firecrawlScrape(cfg, signal) {
  const data = await postJSON("https://api.firecrawl.dev/v2/scrape", {
    url: NEBIUS_URL, formats: ["markdown"], onlyMainContent: true,
  }, { Authorization: `Bearer ${cfg.firecrawl}` }, signal);
  const md = data?.data?.markdown;
  if (!md) throw new Error("Firecrawl returned no content.");
  return md.slice(0, 25000);
}

// ---------- prompts (same instructions as agent.py) ----------
const P = {
  exa: `Using the search results provided, report the latest information about AI, new LLMs, and advancements in the field from Twitter and X.
List the most important items with their source URLs. Do not invent items that are not in the results.
Prefix your response with "**🔥ExaAgent:**" to clearly identify your output.`,
  tavily: `Using the search results provided, report benchmarks, statistics, and relevant analysis on AI.
Keep concrete numbers (scores, prices, speeds) and cite source URLs.
Prefix your response with "**🐳TavilyAgent:**" to clearly identify your output.`,
  summary: `You are a summarizer and formatter.
- Combine the latest AI updates (exa_results) and AI benchmarks and analysis (tavily_results) into one structured summary, highlighting key trends, new LLMs, and relevant statistics.
- Use markdown formatting with headings and bullet points.
- Use emojis like 🚀 for new launches, 📊 for statistics, and 📈 for trends.
- Prefix your response with "**🍥SummaryAgent:**" to clearly identify your output.`,
  firecrawl: `You are given markdown scraped from the Nebius Token Factory website.
Extract the available models with whatever details are present (name, provider, context window, pricing, specialities) and present them as a clean markdown list or table.
Prefix your response with "**🔥FirecrawlAgent:**"`,
  analysis: `You are an AI analyst specializing in the latest AI trends and Large Language Models (LLMs).
- Analyze the final_summary, combining it with your knowledge of AI advancements and the details in exa_results and tavily_results.
- Identify key trends, growth areas, and notable statistics related to AI and LLMs.
- Carefully examine firecrawl_content: it describes the models available on Nebius Token Factory (names, pricing, token limits, availability).
- Focus on the functional capabilities and intended use cases of the LLMs in the summary, not just their names.
- Cross-reference those capabilities with the Nebius offerings, prioritising similar context window size, training data or specialised skills.
- If a relevant LLM is available on Nebius, recommend it specifically: features, pricing, token limits and benefits.
- If there is no exact match, suggest the Nebius models with the closest functional alignment, and mention fine-tuning where it would close the gap.
- Be clear and concise, and back claims with quantifiable data. Use markdown tables for statistics.
- Always prefix your response with "**🔍AnalysisAgent:**" for clear identification.`,
};

// ---------- UI ----------
const STAGES = {
  exa: ["🔥", "ExaAgent"], tavily: ["🐳", "TavilyAgent"], summary: ["🍥", "SummaryAgent"],
  firecrawl: ["🕷️", "FirecrawlAgent"], analysis: ["🔍", "AnalysisAgent"],
};

function makeStage(id) {
  const node = $("#stageTpl").content.firstElementChild.cloneNode(true);
  node.querySelector(".ico").textContent = STAGES[id][0];
  node.querySelector(".name").textContent = STAGES[id][1];
  output.append(node);
  const body = node.querySelector(".body");
  const badge = node.querySelector(".badge");
  const time = node.querySelector(".time");
  const pipe = document.querySelector(`#pipeline [data-stage="${id}"]`);
  let started = 0, timer = 0, frame = 0;

  const setState = (s) => {
    node.className = `card stage ${s}`;
    pipe.className = s;
    badge.textContent = s;
  };
  return {
    start() {
      setState("running");
      started = performance.now();
      timer = setInterval(() => (time.textContent = ((performance.now() - started) / 1000).toFixed(1) + "s"), 100);
    },
    // Throttle markdown re-rendering to one paint per frame while tokens stream in.
    write(md) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { body.innerHTML = render(md); body.classList.add("cursor"); });
    },
    finish(md) {
      clearInterval(timer); cancelAnimationFrame(frame);
      body.classList.remove("cursor");
      if (md !== undefined) body.innerHTML = render(md);
      setState("done");
    },
    fail(err) {
      clearInterval(timer); cancelAnimationFrame(frame);
      body.classList.remove("cursor");
      body.innerHTML = `<p class="err">⚠️ ${DOMPurify.sanitize(err.message || String(err))}</p>`;
      setState("error");
    },
    collapse() { node.open = false; },
  };
}

// Runs one stage; on failure records the error and returns a placeholder so the pipeline keeps going
// (the same graceful-degradation contract the Python tools follow).
async function runStage(id, fn) {
  const ui = makeStage(id);
  ui.start();
  try {
    const result = await fn(ui);
    ui.finish(result);
    return result;
  } catch (e) {
    if (controller?.signal.aborted) { ui.fail(new Error("Stopped.")); throw e; }
    ui.fail(e);
    return `(${STAGES[id][1]} failed: ${e.message})`;
  }
}

async function runPipeline(cfg) {
  const signal = controller.signal;
  const s = {};

  s.exa_results = await runStage("exa", async (ui) => {
    const data = await exaSearch(cfg, signal);
    return chat(cfg, cfg.worker, P.exa, `Source: ${data.source}\n\nSearch results (JSON):\n${JSON.stringify(data.results, null, 1)}`, ui.write, signal);
  });

  s.tavily_results = await runStage("tavily", async (ui) => {
    const results = await tavilySearch(cfg, signal);
    return chat(cfg, cfg.worker, P.tavily, `Search results (JSON):\n${JSON.stringify(results, null, 1)}`, ui.write, signal);
  });

  s.final_summary = await runStage("summary", (ui) =>
    chat(cfg, cfg.worker, P.summary, `## exa_results\n${s.exa_results}\n\n## tavily_results\n${s.tavily_results}`, ui.write, signal));

  s.firecrawl_content = await runStage("firecrawl", async (ui) => {
    const md = await firecrawlScrape(cfg, signal);
    return chat(cfg, cfg.worker, P.firecrawl, `Scraped markdown from ${NEBIUS_URL}:\n\n${md}`, ui.write, signal);
  });

  s.analysis_results = await runStage("analysis", (ui) =>
    chat(cfg, cfg.analysis, P.analysis,
      `## final_summary\n${s.final_summary}\n\n## exa_results\n${s.exa_results}\n\n## tavily_results\n${s.tavily_results}\n\n## firecrawl_content\n${s.firecrawl_content}`,
      ui.write, signal));

  return s;
}

// ---------- form & persistence ----------
function readCfg() {
  const f = new FormData(form);
  return Object.fromEntries(["nebius", "exa", "tavily", "firecrawl", "base", "worker", "analysis"].map((k) => [k, (f.get(k) || "").trim()]));
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!saved) return;
    for (const [k, v] of Object.entries(saved)) if (form.elements[k] && v) form.elements[k].value = v;
    form.elements.remember.checked = true;
  } catch { /* storage unavailable — fine, keys just won't persist */ }
}

function persist(cfg) {
  try {
    if (form.elements.remember.checked) localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* ignore */ }
}

function setRunning(on) {
  $("#go").disabled = on;
  $("#go").textContent = on ? "Running…" : "▶ Run analysis";
  $("#stop").classList.toggle("hidden", !on);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = readCfg();
  persist(cfg);
  output.innerHTML = "";
  $("#final").classList.add("hidden");
  document.querySelectorAll("#pipeline li").forEach((li) => (li.className = ""));
  document.querySelector("#how").scrollIntoView({ behavior: "smooth" });

  controller = new AbortController();
  setRunning(true);
  try {
    const s = await runPipeline(cfg);
    finalMarkdown = s.analysis_results;
    $("#finalBody").innerHTML = render(finalMarkdown);
    $("#final").classList.remove("hidden");
    setTimeout(() => $("#final").scrollIntoView({ behavior: "smooth" }), 300);
  } catch (err) {
    if (!controller.signal.aborted) console.error(err);
  } finally {
    setRunning(false);
    controller = null;
  }
});

$("#stop").addEventListener("click", () => controller?.abort());

$("#clear").addEventListener("click", () => {
  ["nebius", "exa", "tavily", "firecrawl"].forEach((k) => (form.elements[k].value = ""));
  form.elements.remember.checked = false;
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
});

$("#loadModels").addEventListener("click", async () => {
  const cfg = readCfg();
  const msg = $("#modelsMsg");
  if (!cfg.nebius) { msg.textContent = "Enter your Nebius key first."; return; }
  msg.textContent = "Loading…";
  try {
    const res = await fetch(`${cfg.base.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${cfg.nebius}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids = ((await res.json()).data || []).map((m) => m.id).sort();
    $("#models").innerHTML = ids.map((id) => `<option value="${DOMPurify.sanitize(id)}"></option>`).join("");
    msg.textContent = `${ids.length} models available — pick from the model fields.`;
  } catch (err) {
    msg.textContent = `Could not load models (${err.message}).`;
  }
});

$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(finalMarkdown); $("#copy").textContent = "Copied ✓"; }
  catch { $("#copy").textContent = "Copy failed"; }
  setTimeout(() => ($("#copy").textContent = "Copy"), 1500);
});

$("#download").addEventListener("click", () => {
  const blob = new Blob([finalMarkdown], { type: "text/markdown" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `ai-trend-report-${new Date().toISOString().slice(0, 10)}.md`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

loadSaved();
