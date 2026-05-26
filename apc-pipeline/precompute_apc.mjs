#!/usr/bin/env node
/*
 * precompute_apc.mjs - estimates national APC spend for Thailand by publisher and
 * year, and writes ../src/data/apc_by_publisher.json for the dashboard.
 *
 * Pricing tiers per work (first hit wins):
 *   1. ISSN match against the curated reference (USD, else GBP/EUR converted).
 *   2. Journal-title match against the reference (publishers whose lists lack ISSNs).
 *   3. Publisher default flat rate by OA status (publisher_defaults.json).
 *   4. OpenAlex apc_list / apc_paid.
 *   5. unmatched (counted, not summed; surfaced as match rate + worklist).
 *
 * Requires Node 18+ (global fetch). Run:  node precompute_apc.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const THB_PER_USD = { 2020: 31.3, 2021: 32.0, 2022: 35.1, 2023: 34.8, 2024: 35.3, 2025: 34.5 };
const GBP_USD = 1.27;
const EUR_USD = 1.08;

const OPENALEX_BASE = 'https://api.openalex.org';
const SELECT = 'id,doi,publication_year,apc_list,apc_paid,open_access,primary_location,authorships';
const PER_PAGE = 200;

const refPath = path.join(__dirname, 'apc_reference.json');
if (!fs.existsSync(refPath)) {
  console.error('Missing apc_reference.json. Run build_reference.py first.');
  process.exit(1);
}
const reference = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
const refByIssn = new Map();
const refByTitle = new Map();
for (const r of reference) {
  if (r.issn_norm && !refByIssn.has(r.issn_norm)) refByIssn.set(r.issn_norm, r);
  if (r.title_norm && !refByTitle.has(r.title_norm)) refByTitle.set(r.title_norm, r);
}
const stripIssn = (s) => (typeof s === 'string' ? s.toUpperCase().replace(/[^0-9X]/g, '') : '');

const STOP = /\b(the|a|an|of|and|for|in|on)\b/g;
function normTitle(t) {
  if (!t) return null;
  let s = String(t).toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

let publisherDefaults = [];
const pdPath = path.join(__dirname, 'publisher_defaults.json');
if (fs.existsSync(pdPath)) {
  try { publisherDefaults = JSON.parse(fs.readFileSync(pdPath, 'utf-8')); } catch (e) { /* ignore */ }
}
for (const d of publisherDefaults) d._re = new RegExp(d.match, 'i');

function toUsd(o) {
  if (!o) return null;
  if (o.usd != null) return { usd: o.usd, note: '' };
  if (o.gbp != null) return { usd: Math.round(o.gbp * GBP_USD), note: ' (GBP)' };
  if (o.eur != null) return { usd: Math.round(o.eur * EUR_USD), note: ' (EUR)' };
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastTimes = [];
async function rateGate() {
  const now = Date.now();
  lastTimes = lastTimes.filter((t) => now - t < 1000);
  if (lastTimes.length >= 6) {
    await sleep(1000 - (now - lastTimes[0]) + 10);
    return rateGate();
  }
  lastTimes.push(Date.now());
}

function withKey(url) {
  if (!OPENALEX_API_KEY) return url;
  return url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(OPENALEX_API_KEY);
}

async function fetchJson(url, attempt = 0) {
  await rateGate();
  let res;
  try {
    res = await fetch(withKey(url));
  } catch (e) {
    if (attempt < 3) { await sleep(800 * 2 ** attempt); return fetchJson(url, attempt + 1); }
    throw e;
  }
  if (!res.ok) {
    if (res.status === 409) {
      throw new Error('HTTP 409 - OpenAlex API key required or daily credits exhausted. Set OPENALEX_API_KEY.');
    }
    if ((res.status === 429 || res.status >= 502) && attempt < 4) {
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function thaiCorresponding(authorships) {
  const isTH = (a) =>
    (a.countries || []).includes('TH') ||
    (a.institutions || []).some((i) => i.country_code === 'TH');
  const corr = authorships.filter((a) => a.is_corresponding);
  if (corr.length > 0) return { thai: corr.some(isTH), method: 'corresponding' };
  const first = authorships.find((a) => a.author_position === 'first') || authorships[0];
  return { thai: first ? isTH(first) : false, method: 'first_author_fallback' };
}

function priceWork(w) {
  const src = (w.primary_location && w.primary_location.source) || {};
  const oa = (w.open_access && w.open_access.oa_status) || null;

  const issns = [];
  if (src.issn_l) issns.push(stripIssn(src.issn_l));
  for (const i of (src.issn || [])) issns.push(stripIssn(i));
  for (const norm of issns) {
    const ref = refByIssn.get(norm);
    const c = toUsd(ref);
    if (c) return { usd: c.usd, priceSource: 'reference:' + ref.publisher + c.note };
  }

  const tn = normTitle(src.display_name);
  if (tn && refByTitle.has(tn)) {
    const ref = refByTitle.get(tn);
    const c = toUsd(ref);
    if (c) return { usd: c.usd, priceSource: 'title:' + ref.publisher + c.note };
  }

  const host = src.host_organization_name || '';
  for (const d of publisherDefaults) {
    if (d._re.test(host)) {
      const tier = oa === 'gold' ? d.gold : oa === 'hybrid' ? d.hybrid : null;
      const c = toUsd(tier);
      if (c) return { usd: c.usd, priceSource: 'default:' + d.name + c.note };
    }
  }

  if (w.apc_list && w.apc_list.value_usd != null) return { usd: w.apc_list.value_usd, priceSource: 'openalex_apc_list' };
  if (w.apc_paid && w.apc_paid.value_usd != null) return { usd: w.apc_paid.value_usd, priceSource: 'openalex_apc_paid' };
  return { usd: null, priceSource: 'unmatched' };
}

const publisherName = (w) => {
  const src = (w.primary_location && w.primary_location.source) || {};
  return src.host_organization_name || 'Unknown / no publisher';
};

async function pullYear(year) {
  const filter = [
    'authorships.institutions.country_code:TH',
    `publication_year:${year}`,
    'open_access.oa_status:gold|hybrid',
  ].join(',');

  const agg = {};
  let cursor = '*';
  let scanned = 0, thaiCorr = 0, priced = 0, pageNo = 0;
  const methodCount = { corresponding: 0, first_author_fallback: 0 };
  const priceSrcCount = {};
  const unpriced = {};

  while (cursor) {
    const url = `${OPENALEX_BASE}/works?filter=${filter}&select=${SELECT}` +
                `&per-page=${PER_PAGE}&cursor=${encodeURIComponent(cursor)}`;
    const j = await fetchJson(url);
    const results = j.results || [];
    for (const w of results) {
      scanned++;
      const { thai, method } = thaiCorresponding(w.authorships || []);
      if (!thai) continue;
      thaiCorr++;
      methodCount[method]++;
      const pub = publisherName(w);
      const { usd, priceSource } = priceWork(w);
      const srcKind = priceSource.split(':')[0];
      priceSrcCount[srcKind] = (priceSrcCount[srcKind] || 0) + 1;
      if (!agg[pub]) agg[pub] = { works: 0, priced: 0, usd: 0, srcs: {} };
      agg[pub].srcs[srcKind] = (agg[pub].srcs[srcKind] || 0) + 1;
      agg[pub].works++;
      if (usd != null) {
        agg[pub].priced++; agg[pub].usd += usd; priced++;
      } else {
        const src = (w.primary_location && w.primary_location.source) || {};
        const key = src.issn_l || src.id || src.display_name || 'unknown';
        if (!unpriced[key]) {
          unpriced[key] = {
            title: src.display_name || null,
            issn_l: src.issn_l || null,
            issn: (src.issn || []).join(' '),
            publisher: pub,
            oa_status: (w.open_access && w.open_access.oa_status) || null,
            works: 0,
          };
        }
        unpriced[key].works++;
      }
    }
    cursor = j.meta && j.meta.next_cursor;
    pageNo++;
    if (results.length < PER_PAGE) break;
    process.stdout.write(`\r  ${year}: page ${pageNo}, scanned ${scanned}, Thai-corresponding ${thaiCorr}, priced ${priced}   `);
  }
  process.stdout.write('\n');
  return { year, agg, scanned, thaiCorr, priced, methodCount, priceSrcCount, unpriced };
}

async function main() {
  if (!OPENALEX_API_KEY) {
    console.warn('WARNING: OPENALEX_API_KEY is not set. OpenAlex now requires a key; '
      + 'the run will fail after ~100 works. See https://openalex.org/settings/api\n');
  }
  console.log(`Pulling Thai Gold+Hybrid works for ${YEARS.join(', ')} ...`);

  const perYear = [];
  for (const y of YEARS) perYear.push(await pullYear(y));

  const publishers = new Set();
  perYear.forEach((py) => Object.keys(py.agg).forEach((p) => publishers.add(p)));

  const BASIS_LABEL = { reference: 'by ISSN', title: 'by title', default: 'flat rate',
    openalex_apc_list: 'OpenAlex', openalex_apc_paid: 'OpenAlex', unmatched: 'unpriced' };
  const byPublisher = [...publishers].map((pub) => {
    const by_year = {};
    const srcs = {};
    let total_usd = 0, total_thb = 0, total_works = 0, total_priced = 0;
    for (const py of perYear) {
      const a = py.agg[pub] || { works: 0, priced: 0, usd: 0, srcs: {} };
      const thb = a.usd * (THB_PER_USD[py.year] || 0);
      by_year[py.year] = { usd: Math.round(a.usd), thb: Math.round(thb), works: a.works, priced: a.priced };
      total_usd += a.usd; total_thb += thb; total_works += a.works; total_priced += a.priced;
      for (const [k, v] of Object.entries(a.srcs || {})) srcs[k] = (srcs[k] || 0) + v;
    }
    const priceds = Object.entries(srcs).filter(([k]) => k !== 'unmatched');
    const pick = (priceds.length ? priceds : Object.entries(srcs)).sort((a, b) => b[1] - a[1])[0];
    const basis = pick ? (BASIS_LABEL[pick[0]] || pick[0]) : 'unpriced';
    return { publisher: pub, basis, by_year, total_usd: Math.round(total_usd), total_thb: Math.round(total_thb), total_works, total_priced };
  }).sort((a, b) => b.total_usd - a.total_usd);

  const totals_by_year = {};
  for (const py of perYear) {
    let usd = 0;
    for (const a of Object.values(py.agg)) usd += a.usd;
    totals_by_year[py.year] = {
      usd: Math.round(usd),
      thb: Math.round(usd * (THB_PER_USD[py.year] || 0)),
      works_apc_bearing: py.thaiCorr,
      works_priced: py.priced,
      match_rate: py.thaiCorr ? +(py.priced / py.thaiCorr).toFixed(3) : 0,
    };
  }

  const grand_usd = Object.values(totals_by_year).reduce((s, t) => s + t.usd, 0);
  const grand_thb = Object.values(totals_by_year).reduce((s, t) => s + t.thb, 0);

  const unpricedMerged = {};
  for (const py of perYear) {
    for (const [key, rec] of Object.entries(py.unpriced)) {
      if (!unpricedMerged[key]) unpricedMerged[key] = { ...rec };
      else unpricedMerged[key].works += rec.works;
    }
  }
  const unpricedList = Object.values(unpricedMerged).sort((a, b) => b.works - a.works);

  const out = {
    generated_at: new Date().toISOString(),
    method: {
      corpus: 'OpenAlex Works, authorships.institutions.country_code:TH',
      oa_pathways_counted: ['gold', 'hybrid'],
      attribution: 'corresponding author Thai-affiliated; first-author fallback when none flagged',
      valuation: 'list-price estimate (upper-bound ceiling), not actual paid',
      price_priority: ['reference by ISSN', 'reference by journal title', 'publisher default flat rate', 'OpenAlex apc_list/apc_paid'],
    },
    currency: { primary: 'USD', secondary: 'THB', thb_per_usd: THB_PER_USD, gbp_usd: GBP_USD, eur_usd: EUR_USD },
    years: YEARS,
    grand_total_usd: grand_usd,
    grand_total_thb: grand_thb,
    totals_by_year,
    by_publisher: byPublisher,
    attribution_methods: perYear.reduce((acc, py) => {
      for (const [k, v] of Object.entries(py.methodCount)) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    price_sources: perYear.reduce((acc, py) => {
      for (const [k, v] of Object.entries(py.priceSrcCount)) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    unpriced_journal_count: unpricedList.length,
    unpriced_top: unpricedList.slice(0, 25),
    caveats: [
      'Figures are an estimated list-price ceiling, not actual spend. Transformative/read-and-publish agreements, institutional memberships, and negotiated discounts reduce real outlay.',
      'Only Gold and Hybrid open access works incur an APC; Diamond, Green, Bronze, and Closed works are excluded.',
      'Attribution is by corresponding author. Works with no flagged corresponding author fall back to the first author.',
      'Each publisher row is labelled with how it was priced: "by ISSN" (most precise), "by title", or "flat rate" (a publisher-wide default, e.g. ACS/RSC/Emerald). Title and flat-rate figures are estimates, not exact per-journal prices.',
      'Prices given only in GBP or EUR are converted to USD at fixed documented rates; THB uses per-year averages. See currency.',
    ],
  };

  const outDir = path.join(__dirname, '..', 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'apc_by_publisher.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const wlJson = path.join(__dirname, 'unpriced_journals.json');
  fs.writeFileSync(wlJson, JSON.stringify(unpricedList, null, 1));
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = ['publisher,title,issn_l,issn,oa_status,works',
    ...unpricedList.map((r) => [r.publisher, r.title, r.issn_l, r.issn, r.oa_status, r.works].map(esc).join(','))];
  fs.writeFileSync(path.join(__dirname, 'unpriced_journals.csv'), '﻿' + csv.join('\n'));

  console.log(`\nWrote ${outPath}`);
  console.log(`Wrote ${wlJson} (${unpricedList.length} unpriced journals)`);
  console.log(`Grand total: USD ${grand_usd.toLocaleString()}  /  THB ${grand_thb.toLocaleString()}`);
  console.log('Price sources:', JSON.stringify(out.price_sources));
  console.log('Top publishers by estimated APC:');
  byPublisher.slice(0, 12).forEach((p) =>
    console.log(`  ${p.publisher.padEnd(32)} ${('[' + p.basis + ']').padEnd(12)} USD ${p.total_usd.toLocaleString().padStart(11)}  (${p.total_priced}/${p.total_works})`));
  const overall = Object.values(totals_by_year);
  const mr = overall.reduce((s, t) => s + t.works_priced, 0) / Math.max(1, overall.reduce((s, t) => s + t.works_apc_bearing, 0));
  console.log(`Overall match rate: ${(mr * 100).toFixed(1)}%`);
}

main().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
