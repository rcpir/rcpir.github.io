// Private Wikipedia demo: title search (local) + RC-PIR retrieval of the article's column + wikitext rendering.
import { GitHubPages, GoogleDrive, OneDrive, RcPirClient } from "./vendor/rcpir/index.js";
import wtf from "../vendor/wtf/wtf_wikipedia-client.mjs";   // shared with the main site
import wtfHtml from "../vendor/wtf/wtf-plugin-html.mjs";
import { COMPUTE, GDRIVE_FILE_ID, GITHUB_SITE, ONEDRIVE_LINK, PIN_SHA256 } from "./config.js";
import { GDRIVE_API_KEY } from "./gdrive-key.js";

wtf.extend(wtfHtml);
const $ = (id) => document.getElementById(id);
const setState = (s) => { document.body.className = "s-" + s; };
const fmtBytes = (b) => (b >= 1024 * 1024 ? (b / 1048576).toFixed(2) + " MiB" : Math.round(b / 1024) + " KiB");
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
const dbSize = () => fmtMB(params.t * params.L);      // X: the database the compute server scans
const encSize = () => fmtMB(params.m * params.L);     // R: the encoded copy on the retrieval host

// ---- retrieval hosts: the same R on GitHub Pages, Google Drive and OneDrive -----------------------
const HOSTS = {
  github: { name: "GitHub Pages", org: "GitHub", make: () => new GitHubPages(GITHUB_SITE) },
  gdrive: { name: "Google Drive", org: "Google", make: () => new GoogleDrive(GDRIVE_FILE_ID, GDRIVE_API_KEY),
            off: !GDRIVE_API_KEY && "not configured" },
  onedrive: { name: "OneDrive", org: "Microsoft", make: () => new OneDrive(ONEDRIVE_LINK) },
};
const wanted = new URLSearchParams(location.search).get("provider") ?? localStorage.getItem("rcpir-host") ?? "github";
let hostId = HOSTS[wanted] && !HOSTS[wanted].off ? wanted : "github";
const host = () => HOSTS[hostId];

// ---- startup: params + title index ---------------------------------------------------------------
let client, params;
const index = new Map(); // title -> [column, slot]
let sorted = [];         // [lowercased title, title], sorted, for prefix search
let looked = false;      // a lookup was shown in the panel

async function connect() {
  client = await RcPirClient.connect({ retrieval: location.origin, compute: COMPUTE, pinSha256: PIN_SHA256,
                                       provider: host().make() });
  params = client.params;
  prepareNext();
}

async function start() {
  for (const [id, h] of Object.entries(HOSTS)) {
    const o = new Option(h.name + (h.off ? ` (${h.off})` : ""), id, false, id === hostId);
    o.disabled = !!h.off;
    $("host").add(o);
  }
  $("host").onchange = () => switchHost($("host").value);
  await connect();
  $("m-label").textContent = (params.m - 1).toLocaleString();
  $("compute-what").textContent = `One query vector that looks random (LPN-encrypted); the server computes over the whole ${dbSize()} database`;
  const res = await fetch("../titles.txt.gz");   // the main site's title index (same database)
  const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  text.split("\n").forEach((line, col) => line.split("\t").forEach((t, slot) => index.set(t, [col, slot])));
  sorted = [...index.keys()].map((t) => [t.toLowerCase(), t]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  $("stats").innerHTML = `${index.size.toLocaleString()} articles · ${dbSize()} database<br>Lead sections · Wikipedia dump 2026-10-01`;
  fillTexts();
  $("q").disabled = false;
  $("q").placeholder = "Search " + index.size.toLocaleString() + " articles";
  route();
}

function fillTexts() {
  const v = { articles: index.size.toLocaleString(), db: dbSize(), enc: encSize(), s: String(params.s),
              lookup: fmtBytes((params.s + 1) * params.L + Math.ceil(params.t / 8)), host: host().name, org: host().org };
  document.querySelectorAll("[data-v]").forEach((e) => (e.textContent = v[e.dataset.v]));
}

// Switching hosts: a new client for the new host and a new prepared lookup. Waits for a running lookup.
function switchHost(id) {
  hostId = id;
  localStorage.setItem("rcpir-host", id);
  next = null;
  $("prep-text").textContent = `Switching to ${host().name}…`;
  $("prep-text").className = "";
  $("prep-bar").style.width = "0%";
  queue = queue.then(async () => {
    try { await connect(); fillTexts(); } catch (e) { fail(`Could not switch to ${host().name}: ${await explain(e)}`); }
  });
}

// ---- prepared lookups ----------------------------------------------------------------------------
// The s blocks of R are chosen and downloaded before the user picks an article (client.prepare), so a lookup only
// waits for the compute server. A prepared lookup is used once; the next one is prepared after each lookup.
let next = null;     // { p: Prepared, client, done, error }
let waiting = null;  // the prepared lookup an open() waits for (drives the progress bar)

function prepareNext() {
  const c = client, job = { client: c, host: host().name, done: 0, error: null };
  job.p = c.prepare((done) => {
    job.done = done;
    if (waiting === job) progress(done);
    if (next === job) showPrep(job);
  });
  job.p.ready.then(() => { if (next === job) showPrep(job); },
                   async (e) => { job.error = e; job.message = await explain(e); if (next === job) showPrep(job); });
  next = job;
  showPrep(job);
}

// Side panel, before and between lookups: progress of the prepared blocks.
function showPrep(job) {
  const s = params.s, h = job.host;
  const text = job.error ? `Preparing failed: ${job.message ?? job.error.message}`
    : job.done < s ? `Preparing the next lookup: ${job.done} / ${s} random blocks from ${h}`
    : `Next lookup ready: ${s} random blocks downloaded from ${h}, chosen independently of the article`;
  $("prep-text").textContent = text;
  $("prep-text").className = job.error ? "err" : "";
  $("prep-bar").style.width = (100 * job.done / s) + "%";
  if (!looked) {   // no lookup yet: the strip shows the blocks being prepared
    $("host-what").textContent = `Random ${params.L / 1024} KiB blocks of the ${encSize()} encoded database, downloaded ahead of your first lookup`;
    strip(job.p.S);
  }
}

function strip(S) {
  $("strip").replaceChildren(...S.map((j) => {
    const i = document.createElement("i");
    i.style.left = (99.5 * j / params.m) + "%";
    return i;
  }));
}

// ---- errors: explain Google Drive refusals (quota, automated-traffic block, key) --------------------
// The client discards the body of a refused request, but Google states the reason there: keep a copy of the first one.
let driveRefusal = null;   // Promise<{ status, body }> of the latest refused Google request
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  if (String(input).startsWith("https://www.googleapis.com/") && res.status >= 400) {
    driveRefusal = res.clone().text().then((body) => ({ status: res.status, body }), () => ({ status: res.status, body: "" }));
  }
  return res;
};

async function explain(e) {
  if (hostId === "onedrive" && e.code === "http-status" && /HTTP (429|503)\b/.test(e.message)) {
    return "OneDrive is throttling this file's anonymous link: Microsoft allows about 3,000 requests per 5 minutes " +
           "per OneDrive (~34 lookups). Try again in a few minutes, or switch to GitHub Pages.";
  }
  if (hostId !== "gdrive" || !["http-status", "network", "timeout"].includes(e.code)) return `${e.code ?? ""} ${e.message}`;
  let status = 0, body = "";
  const seen = driveRefusal && (await driveRefusal);   // the reason Google gave for a refused request, if readable
  driveRefusal = null;
  if (seen) ({ status, body } = seen);
  else {
    try {   // no readable refusal (e.g. a network error): one diagnostic request
      const r = await realFetch(host().make().locate(0, params).url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
      status = r.status;
      if (status === 206) return `${e.code} ${e.message}`; // Drive works again: a transient failure
      body = await r.text();
    } catch { /* Google's block pages may lack CORS headers: unreadable */ }
  }
  const reason = (body.match(/"reason": *"([^"]+)"/g) ?? []).map((x) => x.split('"')[3]).filter((x) => x !== "forbidden").join(", ");
  const quota = "Google Drive quota reached: Google refuses more downloads with this site's API key for now. " +
                "Try again in a few minutes, or switch to GitHub Pages.";
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|downloadQuotaExceeded/.test(body) || status === 429) return quota + (reason ? ` (Google: ${reason})` : "");
  if (/automated queries/i.test(body)) {
    return "Google Drive refused the request: Google thinks your network is sending automated queries and blocks it for a " +
           "while (a quota of its own). Try again later, or switch to GitHub Pages.";
  }
  if (/API key not valid|keyInvalid|missing a valid API key/i.test(body)) return "Google Drive refused this site's API key (invalid key).";
  if (/REFERRER_BLOCKED|referer/i.test(body)) {
    return `Google Drive refused the request: this site's API key only accepts requests from the published site, not from ${location.origin}.`;
  }
  if (status === 0) {   // Google's block page carries no CORS headers, so the browser cannot read it
    return "Google Drive is not answering this browser: most likely Google's protection against automated traffic is " +
           "blocking your network for a while, or the quota is used up. Try again later, or switch to GitHub Pages.";
  }
  return `Google Drive refused the request (HTTP ${status}${reason ? ", " + reason : ""}): ${body.match(/"message": *"([^"]+)"/)?.[1] ?? e.message}`;
}

// ---- search box ----------------------------------------------------------------------------------
function suggestions(q) {
  q = q.toLowerCase();
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid][0] < q) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo; i < sorted.length && out.length < 8 && sorted[i][0].startsWith(q); i++) out.push(sorted[i][1]);
  return out;
}

let sel = -1;
function renderSuggest() {
  const q = $("q").value.trim(), ul = $("suggest");
  const items = q ? suggestions(q) : [];
  ul.replaceChildren();
  items.forEach((t, i) => {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = t.slice(0, q.length);
    li.append(b, t.slice(q.length));
    if (i === sel) li.className = "sel";
    li.onmousedown = (e) => { e.preventDefault(); go(t); };
    ul.append(li);
  });
  if (items.length) {
    const hint = document.createElement("li");
    hint.className = "hint";
    hint.textContent = "Matched locally in the downloaded title list — your typing is never sent anywhere.";
    ul.append(hint);
  }
  ul.hidden = !items.length;
  return items;
}
$("q").addEventListener("input", () => { sel = -1; renderSuggest(); });
$("q").addEventListener("blur", () => { $("suggest").hidden = true; });
$("q").addEventListener("keydown", (e) => {
  const items = suggestions($("q").value.trim());
  if (e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, -1); renderSuggest(); e.preventDefault(); }
  else if (e.key === "Enter") {
    const t = sel >= 0 ? items[sel] : index.has($("q").value.trim()) ? $("q").value.trim() : items[0];
    if (t) go(t);
  } else if (e.key === "Escape") { $("suggest").hidden = true; }
});

// ---- navigation (the URL fragment never leaves the browser) --------------------------------------
const go = (title) => { $("suggest").hidden = true; $("q").blur(); location.hash = encodeURIComponent(title); };
addEventListener("hashchange", route);
let queue = Promise.resolve();  // lookups run one at a time (the panel records one lookup's requests)
const current = () => decodeURIComponent(location.hash.slice(1));
function route() {
  const title = current();
  if (!title) { setState("home"); $("q").value = ""; return; }
  $("q").value = title;
  queue = queue.then(() => (current() === title ? open(title) : null)); // skip lookups superseded while waiting
}

// ---- retrieval + rendering -----------------------------------------------------------------------
function progress(n) {
  $("bar").style.width = (100 * n / params.s) + "%";
  $("progress-text").textContent = n < params.s ? `${n} / ${params.s} blocks from ${waiting?.host ?? host().name}` : "Asking the compute server…";
}

async function open(title) {
  const loc = index.get(title);
  if (!loc) return fail(`"${title}" is not in the private collection.`);
  setState("loading");
  const t0 = performance.now(), c = client;
  try {
    let block, job;
    for (let attempt = 1; ; attempt++) {
      // the prepared lookup, unless it failed or belongs to the previous host; then a fresh one
      if (!next || next.client !== c || next.error) prepareNext();
      job = next;
      next = null;
      waiting = job;
      progress(job.done);
      try { block = await c.retrieve(loc[0], job.p); break; }
      catch (e) {   // one retry for transient failures (a fresh, independent query)
        if (attempt > 1 || hostId !== "github" || !["network", "timeout", "http-status"].includes(e.code)) throw e;   // Drive, OneDrive: save quota
        $("progress-text").textContent = "Network hiccup, retrying…";
      } finally { waiting = null; }
    }
    const ms = performance.now() - t0;
    const { data, truncated } = entry(block, loc[1]);
    const wikitext = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    render(title, wikitext, truncated);
    panel(ms, job.p);
    setState("article");
    scrollTo(0, 0);
  } catch (e) {
    fail(`Retrieval failed: ${await explain(e)}`);
  } finally {
    if (client === c) prepareNext();   // get the next lookup ready while the user reads
  }
}

// Column payload: u16 n, then n × (u32 page_id | u16 truncated<<15 | len | gzip bytes), big-endian.
function entry(block, slot) {
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let off = 2;
  for (let k = 0; k < dv.getUint16(0); k++) {
    const fl = dv.getUint16(off + 4), len = fl & 0x7fff;
    if (k === slot) return { data: block.subarray(off + 6, off + 6 + len), truncated: fl >> 15 === 1 };
    off += 6 + len;
  }
  throw new Error("slot not found in column");
}

const linkTitle = (href) => {
  let t = decodeURIComponent(href.replace(/^\.\//, "")).replace(/_/g, " ").split("#")[0].trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function render(title, wikitext, truncated) {
  const doc = wtf(wikitext);
  const sd = doc.templates().map((t) => t.json()).find((t) => t.template === "short description");
  // Parse in an inert document (nothing is loaded), then strip images and rewrite links before display.
  const dom = new DOMParser().parseFromString(doc.html({ title: false }), "text/html");
  dom.querySelectorAll("img").forEach((img) => {
    const d = dom.createElement("div");
    d.className = "noimg";
    d.textContent = "Image not loaded: fetching it would reveal the article";
    img.replaceWith(d);
  });
  dom.querySelectorAll(".infobox tr").forEach((tr) => {
    const wide = tr.querySelectorAll(":scope > td[colspan]");
    if (wide.length > 1) { const row = dom.createElement("tr"); row.append(wide[1]); tr.after(row); } // caption below image
    if (tr.firstElementChild?.textContent.trim() === "Embed") tr.remove();
  });
  dom.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    a.removeAttribute("href");
    if (href.startsWith("./")) {
      const t = linkTitle(href);
      if (index.has(t)) a.setAttribute("href", "#" + encodeURIComponent(t));
      else { a.className = "missing"; a.title = "Not in the private collection"; }
    } else a.className = "ext";
  });
  $("title").textContent = title;
  $("short").textContent = sd?.description ?? "";
  $("body").replaceChildren(...[...dom.body.childNodes].map((n) => document.importNode(n, true)));
  const wp = "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  $("notice").innerHTML = (truncated ? "This lead section was <b>shortened</b> to fit. " : "This is the <b>lead section</b> only (citations removed). ") +
    `Blue links open privately; dotted ones are not in the collection. <a href="${wp}" rel="noreferrer" target="_blank">Read the full article on Wikipedia ↗</a> — this leaves private mode.`;
}

function panel(ms, p) {
  looked = true;
  $("last").hidden = false;
  $("host-what").textContent = `${p.S.length} random ${params.L / 1024} KiB blocks out of ${params.m.toLocaleString()} (${encSize()} encoded database) from ${host().name} — chosen independently of the article`;
  strip(p.S);
  const q = p.query;
  $("compute-what").textContent = `One ${(q.length / 1024).toFixed(1)} KiB query that looks random (LPN-encrypted); the server computes over the whole ${dbSize()} database`;
  $("bits").textContent = [...q.subarray(0, 200)].map((b) => b.toString(16).padStart(2, "0")).join("");
  $("t-bytes").textContent = fmtBytes((p.S.length + 1) * params.L + q.length);
  $("t-req").textContent = `${p.S.length} + 1`;
  $("t-time").textContent = (ms / 1000).toFixed(2) + " s";
}

function fail(msg) { $("error").textContent = msg; setState("error"); }

start().catch(async (e) => fail(`Could not start: ${await explain(e)}`));
