// Private Wikipedia demo: title search (local) + RC-PIR retrieval of the article's column + wikitext rendering.
import { RcPirClient } from "./vendor/rcpir/index.js";
import wtf from "./vendor/wtf/wtf_wikipedia-client.mjs";
import wtfHtml from "./vendor/wtf/wtf-plugin-html.mjs";
import { COMPUTE, PIN_SHA256 } from "./config.js";

wtf.extend(wtfHtml);
const $ = (id) => document.getElementById(id);
const setState = (s) => { document.body.className = "s-" + s; };
const fmtBytes = (b) => (b >= 1024 * 1024 ? (b / 1048576).toFixed(2) + " MiB" : Math.round(b / 1024) + " KiB");
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
const dbSize = () => fmtMB(params.t * params.L);      // X: the database the compute server scans
const encSize = () => fmtMB(params.m * params.L);     // R: the encoded copy on the website host

// ---- record what is sent to the servers (for the panel), by wrapping fetch -------------------------
let rec = null; // current lookup: { cols: [], query: Uint8Array, done: 0 }
const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = String(input);
  const p = realFetch(input, init);
  if (rec && url.includes("/rc-pir/r/")) {
    const k = parseInt(url.split("/rc-pir/r/")[1], 16);
    const off = parseInt(/bytes=(\d+)-/.exec(init.headers.Range)[1], 10);
    rec.cols.push(k * params.columns_per_shard + off / params.L);
    p.then(() => progress(++rec.done)).catch(() => {});
  } else if (rec && url.endsWith("/rc-pir/query")) {
    rec.query = init.body;
  }
  return p;
};

// ---- startup: params + title index ---------------------------------------------------------------
let client, params;
const index = new Map(); // title -> [column, slot]
let sorted = [];         // [lowercased title, title], sorted, for prefix search

async function start() {
  client = await RcPirClient.connect({ retrieval: location.origin, compute: COMPUTE, pinSha256: PIN_SHA256 });
  params = client.params;
  document.querySelectorAll(".s-val").forEach((e) => (e.textContent = params.s));
  $("m-label").textContent = (params.m - 1).toLocaleString();
  $("host-what").textContent = `Random blocks of the ${encSize()} encoded database, chosen independently of the article`;
  $("compute-what").textContent = `One query vector that looks random (LPN-encrypted); the server computes over the whole ${dbSize()} database`;
  const res = await fetch("titles.txt.gz");
  const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  text.split("\n").forEach((line, col) => line.split("\t").forEach((t, slot) => index.set(t, [col, slot])));
  sorted = [...index.keys()].map((t) => [t.toLowerCase(), t]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  $("stats").innerHTML = `${index.size.toLocaleString()} articles · ${dbSize()} database<br>Lead sections · Wikipedia dump 2026-10-01`;
  $("q").disabled = false;
  $("q").placeholder = "Search " + index.size.toLocaleString() + " articles";
  route();
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
function route() {
  const title = decodeURIComponent(location.hash.slice(1));
  if (!title) { setState("home"); $("q").value = ""; return; }
  $("q").value = title;
  open(title);
}

// ---- retrieval + rendering -----------------------------------------------------------------------
function progress(n) {
  $("bar").style.width = (100 * n / params.s) + "%";
  $("progress-text").textContent = `${n} / ${params.s} blocks from website host`;
}

async function open(title) {
  const loc = index.get(title);
  if (!loc) return fail(`"${title}" is not in the private collection.`);
  setState("loading");
  progress(0);
  rec = { cols: [], query: null, done: 0 };
  const t0 = performance.now();
  try {
    const block = await client.retrieve(loc[0]);
    const ms = performance.now() - t0;
    const { data, truncated } = entry(block, loc[1]);
    const wikitext = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    render(title, wikitext, truncated);
    panel(ms);
    setState("article");
    scrollTo(0, 0);
  } catch (e) {
    fail(`Retrieval failed: ${e.code ?? ""} ${e.message}`);
  } finally {
    rec = null;
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

function panel(ms) {
  $("last").hidden = false;
  $("host-what").textContent = `${rec.cols.length} random ${params.L / 1024} KiB blocks out of ${params.m.toLocaleString()} (${encSize()} encoded database) — chosen independently of the article`;
  $("strip").replaceChildren(...rec.cols.map((j) => {
    const i = document.createElement("i");
    i.style.left = (99.5 * j / params.m) + "%";
    return i;
  }));
  const q = rec.query;
  $("compute-what").textContent = `One ${(q.length / 1024).toFixed(1)} KiB query that looks random (LPN-encrypted); the server computes over the whole ${dbSize()} database`;
  $("bits").textContent = [...q.subarray(0, 200)].map((b) => b.toString(16).padStart(2, "0")).join("");
  $("t-bytes").textContent = fmtBytes((rec.cols.length + 1) * params.L + q.length);
  $("t-req").textContent = `${rec.cols.length} + 1`;
  $("t-time").textContent = (ms / 1000).toFixed(2) + " s";
}

function fail(msg) { $("error").textContent = msg; setState("error"); }

start().catch((e) => fail(`Could not start: ${e.code ?? ""} ${e.message}`));
