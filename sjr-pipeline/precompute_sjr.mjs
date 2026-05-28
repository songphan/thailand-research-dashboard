#!/usr/bin/env node
/*
 * precompute_sjr.mjs - national SCImago "Journal placement" distribution for
 * Thailand. For each year it scans all Thai-affiliated works, matches each
 * work's journal ISSN to its SJR Best Quartile (from ../src/data/sjr_ranking.json,
 * produced by build_sjr_reference.py), and writes ../src/data/sjr_by_quartile.json.
 *
 * The dashboard uses this for the no-filter national view; when a filter is
 * active it recomputes live in the browser using the same sjr_ranking.json.
 *
 * Attribution: ALL Thai-affiliated works (locked decision), not corresponding
 * author. Requires Node 18+ (global fetch) and an OpenAlex API key:
 *     OPENALEX_API_KEY=xxx node precompute_sjr.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const COUNTRY = 'TH';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const OPENALEX_BASE = 'https://api.openalex.org';
const SELECT = 'id,publication_year,primary_location,primary_topic,cited_by_count';
const PER_PAGE = 200;
const TOP_FIELDS = 30; // how many fields to keep in the by_field breakdown

// ---- load the SJR reference --------------------------------------------------
const refPath = path.join(__dirname, '..', 'src', 'data', 'sjr_ranking.json');
if (!fs.existsSync(refPath)) {
  console.error('Missing src/data/sjr_ranking.json. Run build_sjr_reference.py first.');
  process.exit(1);
}
const ref = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
const refYears = ref.years || [];
const refIssn = ref.issn || {};
if (!refYears.length || !Object.keys(refIssn).length) {
  console.error('sjr_ranking.json has no data yet. Add Scimago CSVs to sjr/ and rebuild.');
  process.exit(1);
}
const refYearIndex = new Map(refYears.map((y, i) => [y, i]));

// Nearest available SJR year for a given publication year (rankings shift yearly;
// fall back to the closest year we have a file for).
function nearestRefYear(year) {
  if (refYearIndex.has(year)) return year;
  let best = refYears[0];
  let bestDist = Math.abs(refYears[0] - year);
  for (const y of refYears) {
    const d = Math.abs(y - year);
    if (d < bestDist) { best = y; bestDist = d; }
  }
  return best;
}

const stripIssn = (s) => (typeof s === 'string' ? s.toUpperCase().replace(/[^0-9X]/g, '') : '');
const hyphenate = (s) => (s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : null);

// Return quartile 1..4 for a work in a given year, or 0 if unranked / not in Scopus.
function quartileForWork(w, year) {
  const src = (w.primary_location && w.primary_location.source) || {};
  const issns = [];
  if (src.issn_l) issns.push(hyphenate(stripIssn(src.issn_l)));
  for (const i of (src.issn || [])) issns.push(hyphenate(stripIssn(i)));
  const idx = refYearIndex.get(nearestRefYear(year));
  for (const issn of issns) {
    if (!issn) continue;
    const str = refIssn[issn];
    if (str && idx != null && idx < str.length) {
      const q = parseInt(str[idx], 10);
      if (q >= 1 && q <= 4) return q;
    }
  }
  return 0;
}

const fieldName = (w) =>
  (w.primary_topic && w.primary_topic.field && w.primary_topic.field.display_name) || null;

// ---- OpenAlex fetch with rate limiting + retry (mirrors precompute_apc.mjs) --
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastTimes = [];
async function rateGate() {
  const now = Date.now();
  lastTimes = lastTimes.filter((t) => now - t < 1000);
  if (lastTimes.length >= 6) { await sleep(1000 - (now - lastTimes[0]) + 10); return rateGate(); }
  lastTimes.push(Date.now());
}
function withKey(url) {
  if (!OPENALEX_API_KEY) return url;
  return url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(OPENALEX_API_KEY);
}
async function fetchJson(url, attempt = 0) {
  await rateGate();
  let res;
  try { res = await fetch(withKey(url)); }
  catch (e) { if (attempt < 3) { await sleep(800 * 2 ** attempt); return fetchJson(url, attempt + 1); } throw e; }
  if (!res.ok) {
    if (res.status === 409) throw new Error('HTTP 409 - OpenAlex API key required or daily credits exhausted. Set OPENALEX_API_KEY.');
    if ((res.status === 429 || res.status >= 502) && attempt < 4) {
      await sleep(1000 * 2 ** attempt + Math.random() * 500); return fetchJson(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const blankQ = () => ({ works: 0, ranked: 0, q1: 0, q2: 0, q3: 0, q4: 0, unranked: 0 });
function tally(bucket, q) {
  bucket.works++;
  if (q >= 1 && q <= 4) { bucket.ranked++; bucket['q' + q]++; }
  else bucket.unranked++;
}

// Separate aggregation for the "Journal Placement Impact" view: per quartile
// bucket, track the number of works, the sum of incoming citations, and the
// number of works that have at least one citation. From these three numbers
// the dashboard derives all three metric tabs (avg cites/work, cited share,
// total citations) without further requests.
const blankImpactBuckets = () => ({
  q1: { works: 0, cites: 0, cited: 0 },
  q2: { works: 0, cites: 0, cited: 0 },
  q3: { works: 0, cites: 0, cited: 0 },
  q4: { works: 0, cites: 0, cited: 0 },
  unranked: { works: 0, cites: 0, cited: 0 },
});
function tallyImpact(buckets, q, cites) {
  const k = (q >= 1 && q <= 4) ? ('q' + q) : 'unranked';
  buckets[k].works++;
  buckets[k].cites += cites;
  if (cites > 0) buckets[k].cited++;
}

async function pullYear(year) {
  const filter = [`authorships.institutions.country_code:${COUNTRY}`, `publication_year:${year}`].join(',');
  const yearBucket = blankQ();
  const yearImpact = blankImpactBuckets();
  const byField = new Map();
  let cursor = '*';
  let pageNo = 0;
  while (cursor) {
    const url = `${OPENALEX_BASE}/works?filter=${filter}&select=${SELECT}` +
                `&per-page=${PER_PAGE}&cursor=${encodeURIComponent(cursor)}`;
    const j = await fetchJson(url);
    const results = j.results || [];
    for (const w of results) {
      const q = quartileForWork(w, year);
      const c = w.cited_by_count || 0;
      tally(yearBucket, q);
      tallyImpact(yearImpact, q, c);
      const fld = fieldName(w);
      if (fld) {
        if (!byField.has(fld)) byField.set(fld, blankQ());
        tally(byField.get(fld), q);
      }
    }
    cursor = j.meta && j.meta.next_cursor;
    pageNo++;
    process.stdout.write(`\r  ${year}: page ${pageNo}, works ${yearBucket.works}, ranked ${yearBucket.ranked}   `);
    if (results.length < PER_PAGE) break;
  }
  process.stdout.write('\n');
  return { year, yearBucket, yearImpact, byField };
}

async function main() {
  if (!OPENALEX_API_KEY) {
    console.warn('WARNING: OPENALEX_API_KEY is not set. OpenAlex now requires a key; '
      + 'the run will fail after ~100 works. See https://openalex.org/settings/api\n');
  }
  console.log(`Scanning all ${COUNTRY}-affiliated works for ${YEARS.join(', ')} and matching SJR quartiles ...`);
  console.log('(This scans the full corpus per year, so it is a larger pull than the APC step.)\n');

  const perYear = [];
  for (const y of YEARS) perYear.push(await pullYear(y));

  const totals_by_year = {};
  const overall = blankQ();
  const fieldAgg = new Map();
  // Per-quartile citation impact aggregation. `impact_by_year[year][qKey]`
  // carries { works, cites, cited }; `impactOverall` sums across years.
  const impact_by_year = {};
  const impactOverall = blankImpactBuckets();
  for (const py of perYear) {
    totals_by_year[py.year] = py.yearBucket;
    impact_by_year[py.year] = py.yearImpact;
    for (const k of ['works', 'ranked', 'q1', 'q2', 'q3', 'q4', 'unranked']) overall[k] += py.yearBucket[k];
    for (const qKey of Object.keys(impactOverall)) {
      impactOverall[qKey].works += py.yearImpact[qKey].works;
      impactOverall[qKey].cites += py.yearImpact[qKey].cites;
      impactOverall[qKey].cited += py.yearImpact[qKey].cited;
    }
    for (const [fld, b] of py.byField.entries()) {
      if (!fieldAgg.has(fld)) fieldAgg.set(fld, blankQ());
      const t = fieldAgg.get(fld);
      for (const k of ['works', 'ranked', 'q1', 'q2', 'q3', 'q4', 'unranked']) t[k] += b[k];
    }
  }

  const by_field = [...fieldAgg.entries()]
    .map(([field, b]) => ({ field, ...b }))
    .sort((a, b) => b.works - a.works)
    .slice(0, TOP_FIELDS);

  const out = {
    generated_at: new Date().toISOString(),
    source: 'SCImago Journal Rank (SJR), https://www.scimagojr.com',
    method: {
      corpus: `OpenAlex Works, authorships.institutions.country_code:${COUNTRY}`,
      attribution: 'all Thai-affiliated works (each work counted once)',
      quartile_rule: 'SJR Best Quartile, matched by journal ISSN for the publication year (nearest available SJR year as fallback)',
      unranked_meaning: 'journal not found in the SJR/Scopus reference for that year (includes Thai Citation Index and other non-Scopus venues, and works with no journal)',
    },
    years: YEARS,
    sjr_years: refYears,
    totals_by_year,
    overall,
    by_field,
    // Citation impact per quartile bucket. Feeds the "Journal Placement Impact"
    // card: avg cites/work, cited share, total cites — all derived from the
    // three numbers below per bucket per year (and overall across years).
    impact_by_quartile: {
      overall: impactOverall,
      by_year: impact_by_year,
    },
    caveats: [
      'Quartiles describe a journal’s citation standing in Scopus, not the quality of any individual article (cf. DORA, Leiden Manifesto).',
      'The unranked bucket is not a defect: much Thai output appears in the Thai Citation Index and other venues outside Scopus, which SJR does not cover.',
      'Quartile is the SJR Best Quartile (the journal’s strongest Scopus subject category).',
      'When a filter is active the panel recomputes the exact selection live in the browser; with no filter it shows these precomputed national totals.',
    ],
  };

  const outDir = path.join(__dirname, '..', 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sjr_by_quartile.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`\nWrote ${outPath}`);
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');
  console.log(`Overall: ${overall.works.toLocaleString()} works, ${pct(overall.ranked, overall.works)}% ranked in Scopus/SJR`);
  console.log(`  Q1 ${pct(overall.q1, overall.works)}%  Q2 ${pct(overall.q2, overall.works)}%  `
    + `Q3 ${pct(overall.q3, overall.works)}%  Q4 ${pct(overall.q4, overall.works)}%  `
    + `Unranked ${pct(overall.unranked, overall.works)}%`);
  for (const py of perYear) {
    const b = py.yearBucket;
    console.log(`  ${py.year}: ${b.works.toLocaleString().padStart(7)} works, Q1 ${pct(b.q1, b.works)}%, ranked ${pct(b.ranked, b.works)}%`);
  }
  console.log('\nCitation impact by quartile (overall, all years):');
  for (const k of ['q1', 'q2', 'q3', 'q4', 'unranked']) {
    const b = impactOverall[k];
    const avg = b.works ? (b.cites / b.works) : 0;
    const citedShare = b.works ? ((b.cited / b.works) * 100) : 0;
    console.log(`  ${k.padEnd(8)} ${b.works.toLocaleString().padStart(7)} works  `
      + `avg ${avg.toFixed(2).padStart(7)} cites/work  `
      + `cited ${citedShare.toFixed(1).padStart(5)}%  `
      + `total ${b.cites.toLocaleString().padStart(10)} cites`);
  }
}

main().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
