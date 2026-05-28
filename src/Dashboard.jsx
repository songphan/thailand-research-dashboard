import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  CartesianGrid, LabelList
} from 'recharts';
import {
  TrendingUp, BookOpen, Globe2, Sparkles, RefreshCw, AlertCircle, Database,
  Building2, Newspaper, FileText, Layers, Languages, Target, Banknote, Loader2, X,
  Table as TableIcon, Download, Search, ChevronDown, Filter
} from 'lucide-react';

import apcData from './data/apc_by_publisher.json';
import apcPricing from './data/apc_pricing.json';
import publisherDefaults from './data/publisher_defaults.json';

const OPENALEX_BASE = 'https://api.openalex.org';

// OpenAlex API key. As of Feb 13, 2026, OpenAlex made API keys mandatory and
// retired both the anonymous tier and the email-based "polite pool". Without
// a key you get 100 free credits and then HTTP 409 errors.
//
// Get a free key at https://openalex.org/settings/api after signing in.
// Free academic tier provides 100,000 credits per day, which is more than
// enough for this dashboard.
//
// IMPORTANT: this key ships in your client-side JavaScript bundle, which means
// anyone who views the page source can read it. For a public dashboard with
// no abuse risk this is acceptable (the worst-case scenario is someone else
// burning your daily credits, which OpenAlex's per-IP rate limit largely
// prevents anyway). If you'd rather hide the key, the proper path is a
// small backend proxy that adds the key server-side.
const OPENALEX_API_KEY = ''; // <-- PUT YOUR API KEY HERE, e.g. 'oax_abc123xyz'

const PALETTE = {
  cream: '#f6f1e7',
  paper: '#fbf8f1',
  ink: '#1a1612',
  charcoal: '#3a342c',
  muted: '#6b6155',
  rule: '#d9cfbe',
  navy: '#1f3a5f',
  burgundy: '#7a2e3e',
  gold: '#b88a3e',
  teal: '#2c5f5d',
  forest: '#4a6b3a',
  rust: '#a55a2c',
  sage: '#7a9079',
  plum: '#5d3a5a',
  ochre: '#c9963f',
};

const SERIES = [PALETTE.navy, PALETTE.burgundy, PALETTE.gold, PALETTE.teal, PALETTE.forest, PALETTE.rust, PALETTE.sage, PALETTE.plum, PALETTE.ochre, '#34536b', '#8b4040', '#3d6655'];

const OA_COLORS = {
  gold: '#c9963f',
  green: '#4a6b3a',
  hybrid: '#7a9079',
  bronze: '#a55a2c',
  diamond: '#b88a3e',
  closed: '#6b6155',
};

const YEARS = [2025, 2024, 2023, 2022, 2021, 2020];

// Per-country exclusion list for OpenAlex institutions that show up in a
// country's roster (filter=country_code:XX) but whose papers are mostly
// authored by researchers in other countries. This is an OpenAlex data quality
// issue we route around at the dashboard layer.
//
// Verified example: "Ministry of Education" appears under filter=country_code:TH
// with very high paper counts. Spot-checking the top-cited 2025 works (e.g.
// 10.1038/s41589-025-01841-3) shows every author affiliated with Chinese
// institutions, with no Thai-affiliated author on the byline. This is almost
// certainly a name collision with the Chinese Ministry of Education (which
// hosts many State Key Laboratories that publish in top venues).
//
// To add a new exclusion: add the full OpenAlex institution URL to the array
// for the relevant country. The id should match the `id` field returned by
// /institutions, which is the form `https://openalex.org/I123456789`.
const EXCLUDED_INSTITUTIONS_BY_COUNTRY = {
  TH: new Set([
    // Ministry of Education (https://ror.org/036nq5137, www.en.moe.go.th).
    // Legitimate Thai institution, but OpenAlex's affiliation-string matcher
    // conflates "Ministry of Education" affiliations from Chinese authors with
    // this entity. Spot-checking the top-cited 2025 works (e.g.
    // 10.1038/s41589-025-01841-3) shows every author affiliated with Chinese
    // institutions, with no Thai-affiliated author on the byline. Until
    // OpenAlex resolves this disambiguation, we exclude the entity from the
    // Thai roster so the counts don't mislead readers.
    'https://openalex.org/I4210123333',
  ]),
};

// Each dimension maps a panel key to its OpenAlex filter parameter, a friendly label,
// and whether bars/slices in this chart should be clickable to apply a filter. The
// filterable flag is checked when wiring click handlers; if false, the chart renders
// statically (no cursor pointer, no selection highlight, no chip in the breadcrumb).
//
// To disable filtering on any dimension, flip its `filterable` to false. The chart
// will continue to display the data but its bars/slices become read-only.
//
// Verified against https://developers.openalex.org/api-reference/works on 2026-05-09.
const DIMENSIONS = {
  institutions: { filterKey: 'authorships.institutions.id',                 label: 'Institution', filterable: true },
  fields:       { filterKey: 'primary_topic.field.id',                      label: 'Field',       filterable: true },
  subfields:    { filterKey: 'primary_topic.subfield.id',                   label: 'Subfield',    filterable: true },
  // Document type and language: filtering is disabled because in practice combining
  // these with the country_code filter collapses most other panels to empty results,
  // suggesting OpenAlex's joint distributions for these dimensions don't behave the
  // way faceted-search UIs expect. The charts still display the breakdown, just
  // without click-to-filter.
  docTypes:     { filterKey: 'type',                                        label: 'Type',        filterable: false },
  oaStatus:     { filterKey: 'open_access.oa_status',                       label: 'OA',          filterable: true },
  publishers:   { filterKey: 'primary_location.source.host_organization',   label: 'Publisher',   filterable: true },
  languages:    { filterKey: 'language',                                    label: 'Language',    filterable: false },
  sdgs:         { filterKey: 'sustainable_development_goals.id',            label: 'SDG',         filterable: true },
  collaborators:{ filterKey: 'authorships.countries',                       label: 'Co-author',   filterable: true },
  // Was 'grants.funder' until 2025; OpenAlex removed the grants property in favour of
  // funders and awards. The current filterable + groupable key is funders.id.
  funders:      { filterKey: 'funders.id',                                  label: 'Funder',      filterable: true },
};

const useFonts = () => {
  useEffect(() => {
    const existing = document.querySelector('link[data-th-fonts]');
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    link.setAttribute('data-th-fonts', '');
    document.head.appendChild(link);
  }, []);
};

const FONT_DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";
const FONT_BODY = "'IBM Plex Sans', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

const fmt = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString();
};

const fmtFull = (n) => (n ?? 0).toLocaleString();

const pct = (part, total) => total ? ((part / total) * 100).toFixed(1) + '%' : '—';

const stripPrefix = (key, prefix = 'https://openalex.org/') =>
  typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : key;

const cleanLabel = (label, max = 38) => {
  if (!label) return 'Unknown';
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
};

// Country names. Intl.DisplayNames covers every ISO-3166-1 alpha-2 code with the
// browser's localised display name, so we don't have to maintain a dictionary.
// COUNTRY_OVERRIDES is for the handful of cases where we want a label different
// from what the browser returns by default (shorter common names, etc.).
const COUNTRY_OVERRIDES = {
  GB: 'United Kingdom',
  US: 'United States',
  KR: 'South Korea',
  KP: 'North Korea',
  RU: 'Russia',
  CZ: 'Czechia',
  TR: 'Türkiye',
  AE: 'United Arab Emirates',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  MO: 'Macao',
  VN: 'Vietnam',
  LA: 'Laos',
  MM: 'Myanmar',
  CD: 'DR Congo',
  CG: 'Republic of Congo',
  CI: "Côte d'Ivoire",
  SY: 'Syria',
  BO: 'Bolivia',
  VE: 'Venezuela',
  IR: 'Iran',
  TZ: 'Tanzania',
  MD: 'Moldova',
  BN: 'Brunei',
  PS: 'Palestine',
};

// Lazy-init a single DisplayNames instance. If the browser is too old or the
// runtime doesn't support it, we fall back to the raw code.
let _displayNames = null;
const getDisplayNames = () => {
  if (_displayNames !== null) return _displayNames;
  try {
    _displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    _displayNames = false;
  }
  return _displayNames;
};

const countryName = (code) => {
  if (!code || typeof code !== 'string') return code || 'Unknown';
  const upper = code.toUpperCase();
  if (COUNTRY_OVERRIDES[upper]) return COUNTRY_OVERRIDES[upper];
  const dn = getDisplayNames();
  if (dn) {
    try {
      const name = dn.of(upper);
      // DisplayNames returns the input code unchanged when it doesn't recognise it,
      // so we treat that as "no match" and fall through.
      if (name && name !== upper) return name;
    } catch {
      // ignore and fall through
    }
  }
  return upper;
};

const LANG_NAMES = {
  en: 'English', th: 'Thai', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian',
  it: 'Italian', id: 'Indonesian', vi: 'Vietnamese', ms: 'Malay',
};

const TYPE_NAMES = {
  article: 'Journal article', 'book-chapter': 'Book chapter', book: 'Book',
  dissertation: 'Dissertation', preprint: 'Preprint', dataset: 'Dataset',
  review: 'Review', paratext: 'Paratext', editorial: 'Editorial', letter: 'Letter',
  report: 'Report', 'reference-entry': 'Reference entry', standard: 'Standard',
  'peer-review': 'Peer review', erratum: 'Erratum', other: 'Other',
};

// Convert group_by keys (URLs and codes) to the value form OpenAlex accepts in filters.
// Convert group_by keys (URLs and codes) to the value form OpenAlex accepts in filters.
// For most dimensions the two forms agree; for some (institutions, fields, SDGs) the
// group_by key is a URL while the filter wants a bare ID.
const normalizeFilterValue = (key, dim = null) => {
  if (typeof key !== 'string') return String(key);
  let m = key.match(/^https:\/\/openalex\.org\/([A-Z]\d+)$/);
  if (m) return m[1];
  m = key.match(/^https:\/\/openalex\.org\/(fields|subfields|topics|domains)\/(\w+)$/);
  if (m) return m[2];
  m = key.match(/^https:\/\/metadata\.un\.org\/sdg\/(\d+)$/);
  if (m) return m[1];
  return key;
};

// excludeDim drops that dimension's chips so a chart can still display its full breakdown
// when it is the source of the filter (faceted-search "exclusive" pattern).
const buildFilterString = (country, yearOrYears, filters, excludeDim = null) => {
  // OpenAlex filter values support OR via the pipe character. So a multi-year
  // selection encodes as `publication_year:2023|2024|2025` and reads naturally
  // on the server side as a single-clause OR over the listed years.
  const yearClause = Array.isArray(yearOrYears)
    ? `publication_year:${[...yearOrYears].sort((a, b) => a - b).join('|')}`
    : `publication_year:${yearOrYears}`;
  const parts = [`authorships.institutions.country_code:${country}`, yearClause];
  for (const [dim, items] of Object.entries(filters || {})) {
    if (!items || items.length === 0) continue;
    if (dim === excludeDim) continue;
    const def = DIMENSIONS[dim];
    if (!def || !def.filterKey) continue;
    const values = items.map((i) => normalizeFilterValue(i.value, dim)).join('|');
    parts.push(`${def.filterKey}:${values}`);
  }
  return parts.join(',');
};

// Request rate limiter. OpenAlex caps at 10 requests per second. A pure
// concurrency cap doesn't help here: if responses take ~280ms, 6 concurrent
// slots = ~21 req/sec, well over the ceiling. We need a rate-based gate that
// enforces "no more than N requests within any rolling 1-second window."
//
// Implementation: keep timestamps of recent send-times. Before each new request,
// drop timestamps older than 1 second and check whether we have room under the
// rate cap. If not, wait until the oldest timestamp ages out, then check again.
//
// RATE_PER_SECOND is set comfortably below OpenAlex's 10/sec ceiling to absorb
// retries and any timing variance. Lower means safer; higher means faster.
const RATE_PER_SECOND = 7;
const RATE_WINDOW_MS = 1000;
const sendTimestamps = [];
const pendingRateQueue = [];
let drainScheduled = false;

function pruneTimestamps(now) {
  const cutoff = now - RATE_WINDOW_MS;
  while (sendTimestamps.length > 0 && sendTimestamps[0] <= cutoff) {
    sendTimestamps.shift();
  }
}

function scheduleDrain() {
  if (drainScheduled || pendingRateQueue.length === 0) return;
  drainScheduled = true;
  // How long until the oldest in-window timestamp falls out of the window?
  const now = Date.now();
  pruneTimestamps(now);
  let delay = 0;
  if (sendTimestamps.length >= RATE_PER_SECOND) {
    const oldest = sendTimestamps[0];
    delay = Math.max(0, oldest + RATE_WINDOW_MS - now) + 5; // 5ms margin
  }
  setTimeout(() => {
    drainScheduled = false;
    drainQueue();
  }, delay);
}

function drainQueue() {
  const now = Date.now();
  pruneTimestamps(now);
  // Hand out as many slots as we have headroom for.
  while (sendTimestamps.length < RATE_PER_SECOND && pendingRateQueue.length > 0) {
    const resolve = pendingRateQueue.shift();
    sendTimestamps.push(Date.now());
    resolve();
  }
  if (pendingRateQueue.length > 0) scheduleDrain();
}

function acquireRequestSlot() {
  return new Promise((resolve) => {
    const now = Date.now();
    pruneTimestamps(now);
    if (sendTimestamps.length < RATE_PER_SECOND && pendingRateQueue.length === 0) {
      sendTimestamps.push(now);
      resolve();
    } else {
      pendingRateQueue.push(resolve);
      scheduleDrain();
    }
  });
}

// No explicit release: the rate limiter is fire-and-forget. Once a request is
// counted in sendTimestamps, it ages out of the window automatically after
// RATE_WINDOW_MS. This is simpler and more correct than tracking in-flight
// counts, since OpenAlex's limit is rate-based, not concurrency-based.
function releaseRequestSlot() { /* no-op; retained for symmetry */ }

async function fetchJson(url, timeoutMs = 25000, attempt = 0) {
  await acquireRequestSlot();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      // 409 Conflict from OpenAlex means out of free credits (no API key set, or
      // daily limit exceeded). Don't retry; surface a clear message.
      if (res.status === 409) {
        throw new Error('HTTP 409 — OpenAlex API key required or daily credits exhausted. See OPENALEX_API_KEY at the top of Dashboard.jsx.');
      }
      // OpenAlex returns 429 for TWO different conditions, distinguishable by the
      // response body. We need to inspect the body to tell them apart, because the
      // correct behaviour differs: rate-limit retries; budget-exhausted does not.
      //   - true rate limit (too many requests per second): retry with backoff
      //   - daily budget exhausted: don't retry. Surface a clear "out of budget"
      //     message that tells the user when it resets and where to add funds.
      // The body has shape: { error, message, retryAfter, dailyRemainingUsd, ... }
      if (res.status === 429) {
        let body = null;
        try { body = await res.clone().json(); } catch { /* not JSON */ }
        const isBudgetError =
          body && (
            body.dailyRemainingUsd === 0 ||
            body.creditsRemaining === 0 ||
            (typeof body.message === 'string' && /Insufficient budget/i.test(body.message))
          );
        if (isBudgetError) {
          const retryHours = body.retryAfter ? Math.ceil(body.retryAfter / 3600) : null;
          const whenMsg = retryHours
            ? ` Quota resets at midnight UTC (in about ${retryHours} hour${retryHours === 1 ? '' : 's'}).`
            : ' Quota resets at midnight UTC.';
          throw new Error(`OpenAlex daily quota exhausted.${whenMsg} See https://openalex.org/pricing to add funds, or wait for the daily reset.`);
        }
        // Otherwise it's a true rate-limit 429: retry with backoff.
      }
      // Retry on transient failures: 429 (genuine rate limit), 502/503/504 (gateway/timeout).
      // Use exponential backoff with jitter. With the rate limiter in place, 429s
      // should be rare; this is a second line of defence.
      const isTransient = res.status === 429 || res.status >= 502;
      const maxAttempts = res.status === 429 ? 4 : 2;
      if (isTransient && attempt < maxAttempts) {
        clearTimeout(t);
        // 800ms, 1.6s, 3.2s, 6.4s base + 0-600ms jitter
        const base = 800 * Math.pow(2, attempt);
        const wait = base + Math.random() * 600;
        await new Promise((r) => setTimeout(r, wait));
        // Retry re-enters the limiter (no slot to release; timestamps age out).
        return fetchJson(url, timeoutMs, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Append the OpenAlex api_key parameter if configured. As of Feb 2026 this is
// effectively required; without it OpenAlex returns 100 credits then 409 errors.
const withMailto = (url) =>
  OPENALEX_API_KEY
    ? url + (url.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(OPENALEX_API_KEY)}`
    : url;

const groupUrl = (filterStr, groupBy, perPage = 200) =>
  withMailto(`${OPENALEX_BASE}/works?filter=${filterStr}&group_by=${groupBy}&per-page=${perPage}`);

const countUrl = (filterStr, extra = '') =>
  withMailto(`${OPENALEX_BASE}/works?filter=${filterStr}${extra ? ',' + extra : ''}&per-page=1`);

const topWorksUrl = (filterStr) =>
  withMailto(`${OPENALEX_BASE}/works?filter=${filterStr}&sort=cited_by_count:desc&per-page=10&select=id,doi,title,cited_by_count,authorships,primary_location,type,open_access`);

const institutionsBatchUrl = (ids) =>
  withMailto(`${OPENALEX_BASE}/institutions?filter=openalex:${ids.join('|')}&per-page=200&select=id,display_name,country_code,type,ror`);

// Look up institution metadata for an arbitrary number of OpenAlex IDs without
// blowing past URL length limits. Each chunk's URL stays comfortably under 2 KB.
// Failed chunks are skipped so a partial result is better than no result.
async function fetchInstitutionsMetadata(ids, chunkSize = 40) {
  if (!ids || ids.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  const responses = await Promise.allSettled(
    chunks.map((chunk) => fetchJson(institutionsBatchUrl(chunk)))
  );
  return responses.flatMap((r) =>
    r.status === 'fulfilled' ? (r.value?.results || []) : []
  );
}

// Paginate group_by results past OpenAlex's 200-per-page cap using the cursor
// pagination protocol (cursor=* on first request, then the cursor from
// meta.next_cursor on subsequent requests). Note: OpenAlex returns paged groups
// sorted by KEY (not by count), so callers should re-sort after.
//
// We cap pages defensively to avoid runaway loops on dimensions with absurd
// long tails. For "all Thai institutions" the actual count is ~260, so 5 pages
// at 200 per page is more than enough; for global "all institutions worldwide"
// the cap is the only thing keeping us from a 50k-row blast.
async function fetchAllGroups(filterStr, groupBy, maxPages = 8) {
  const all = [];
  let cursor = '*';
  for (let page = 0; page < maxPages; page++) {
    const url = withMailto(
      `${OPENALEX_BASE}/works?filter=${filterStr}` +
      `&group_by=${groupBy}` +
      `&per-page=200` +
      `&cursor=${encodeURIComponent(cursor)}`
    );
    const j = await fetchJson(url);
    const batch = j.group_by || [];
    all.push(...batch);
    cursor = j?.group_by_cursor || j?.meta?.next_cursor;
    // Stop if API returned no more results, or no cursor was emitted, or the batch
    // came back smaller than the page size (signals last page).
    if (!cursor || batch.length === 0 || batch.length < 200) break;
  }
  return all;
}

// Card is a plain panel by default. Pass `collapsible` to turn the first child
// (a SectionTitle header) into a clickable toggle that hides the rest of the
// card body, so a chart box can be folded away to study how filtering one panel
// affects the others. Opt-in only, so StatCard and the methods card stay fixed.
const Card = ({ children, className = '', style = {}, collapsible = false, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  let inner = children;
  if (collapsible) {
    let kids = React.Children.toArray(children);
    // ApcPanel and a few branches pass a single fragment; unwrap it so the
    // header (the SectionTitle) is the first element rather than the fragment.
    if (kids.length === 1 && kids[0] && kids[0].type === React.Fragment) {
      kids = React.Children.toArray(kids[0].props.children);
    }
    const head = kids[0];
    const body = kids.slice(1);
    inner = (
      <>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
          title={open ? 'Collapse this box' : 'Expand this box'}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>{head}</div>
          <ChevronDown
            size={16}
            style={{ flex: 'none', marginTop: 2, color: PALETTE.muted, transition: 'transform 0.2s ease', transform: open ? 'none' : 'rotate(-90deg)' }}
          />
        </div>
        {open && body}
      </>
    );
  }
  return (
    <div
      className={`rounded-md ${className}`}
      style={{
        background: PALETTE.paper,
        border: `1px solid ${PALETTE.rule}`,
        boxShadow: '0 1px 0 rgba(26,22,18,0.03)',
        ...style,
      }}
    >
      {inner}
    </div>
  );
};

const SectionTitle = ({ icon: Icon, kicker, title, hint, count, countLabel, filterable = false }) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div className="flex items-start gap-3">
      {Icon && (
        <div
          className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-sm"
          style={filterable
            ? { background: PALETTE.ink, color: PALETTE.cream }
            : { background: 'transparent', color: PALETTE.muted, border: `1px solid ${PALETTE.rule}` }}
          title={filterable
            ? 'Interactive: click a bar or slice in this chart to filter the whole dashboard'
            : 'Display only: this chart does not filter other panels'}
        >
          <Icon size={16} strokeWidth={1.6} />
        </div>
      )}
      <div>
        <div
          style={{ fontFamily: FONT_MONO, color: PALETTE.muted, fontSize: 10, letterSpacing: '0.18em' }}
          className="uppercase"
        >
          {kicker}
        </div>
        <h3
          style={{ fontFamily: FONT_DISPLAY, color: PALETTE.ink, fontSize: 22, fontWeight: 500, lineHeight: 1.15, fontStyle: 'italic' }}
          className="mt-0.5"
        >
          {title}
        </h3>
        {count != null && (
          <div
            style={{ fontFamily: FONT_MONO, color: PALETTE.charcoal, fontSize: 11, letterSpacing: '0.04em' }}
            className="mt-1"
          >
            <span style={{ color: PALETTE.muted }}>n</span>
            <span> = </span>
            <span style={{ fontWeight: 500 }}>{typeof count === 'number' ? count.toLocaleString() : count}</span>
            {countLabel && (
              <span style={{ color: PALETTE.muted }}> {countLabel}</span>
            )}
          </div>
        )}
      </div>
    </div>
    {hint && (
      <div
        style={{ fontFamily: FONT_MONO, color: PALETTE.muted, fontSize: 10 }}
        className="text-right tracking-wide"
      >
        {hint}
      </div>
    )}
  </div>
);

const SkeletonBars = ({ rows = 6 }) => (
  <div className="space-y-2 p-2">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="h-3 w-32 rounded" style={{ background: PALETTE.rule, opacity: 0.6 }} />
        <div
          className="h-3 flex-1 rounded"
          style={{ background: PALETTE.rule, opacity: 0.4 - i * 0.04, width: `${100 - i * 10}%` }}
        />
      </div>
    ))}
  </div>
);

const ChartFrame = ({ status, error, children, hint }) => {
  if (status === 'loading') return <div className="px-2 py-4"><SkeletonBars /></div>;
  if (status === 'error') {
    return (
      <div
        className="flex flex-col items-center justify-center px-4 py-10 text-center"
        style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY }}
      >
        <AlertCircle size={20} className="mb-2" />
        <div style={{ fontSize: 13 }}>Could not load this segment.</div>
        <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 4 }}>{error}</div>
      </div>
    );
  }
  return (
    <div>
      {children}
      {hint && (
        <div
          className="mt-2 px-2"
          style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.04em' }}
        >
          {hint}
        </div>
      )}
    </div>
  );
};

// HBar with toggleable selection. selectedKeys is an array of `key` strings; clicking
// a bar fires onBarClick({key, label, value}). When something is selected, unselected
// bars dim to hint at the active focus. height is auto-computed from row count
// unless explicitly overridden.
const HBar = ({
  data, labelKey = 'label', valueKey = 'value', height,
  color = PALETTE.navy, accentTop = false, onBarClick, selectedKeys = [],
  yAxisWidth = 170,
  // tickFillFn: optional (datum) => color string. If provided, the y-axis label
  // for each row is rendered in that color (used to color institution names by
  // MHESI subcategory). Falls back to PALETTE.charcoal.
  tickFillFn = null,
}) => {
  if (!data || data.length === 0) {
    return <div style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }} className="px-3 py-6">No data.</div>;
  }
  // Each row roughly 26px; clamp to a reasonable min/max.
  const computedHeight = height ?? Math.max(220, Math.min(1400, data.length * 26 + 40));
  const hasSelection = selectedKeys.length > 0;
  const opacityFor = (key) => (!hasSelection ? 1 : selectedKeys.includes(key) ? 1 : 0.28);
  const fillFor = (d, i) => {
    if (selectedKeys.includes(d.key)) return PALETTE.burgundy;
    if (accentTop && i === 0 && !hasSelection) return PALETTE.burgundy;
    return color;
  };
  const handle = onBarClick ? (entry) => onBarClick(entry) : undefined;

  // Build a label → color lookup if tickFillFn is supplied. Recharts y-axis
  // doesn't pass the row datum to the tick renderer; only the label string.
  // So we materialize the lookup once per render.
  const labelColorMap = tickFillFn
    ? Object.fromEntries(data.map((d) => [d[labelKey], tickFillFn(d)]))
    : null;
  const renderTick = ({ x, y, payload }) => {
    const color = labelColorMap?.[payload.value] || PALETTE.charcoal;
    return (
      <text
        x={x}
        y={y}
        dy={4}
        textAnchor="end"
        fill={color}
        style={{ fontFamily: FONT_BODY, fontSize: 11 }}
      >
        <title>{payload.value}</title>
        {payload.value}
      </text>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart layout="vertical" data={data} margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
        <CartesianGrid stroke={PALETTE.rule} strokeDasharray="2 4" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: PALETTE.muted, fontFamily: FONT_MONO, fontSize: 10 }}
          axisLine={{ stroke: PALETTE.rule }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={yAxisWidth}
          tick={tickFillFn ? renderTick : { fill: PALETTE.charcoal, fontFamily: FONT_BODY, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: PALETTE.cream, opacity: 0.6 }}
          contentStyle={{
            background: PALETTE.paper,
            border: `1px solid ${PALETTE.ink}`,
            fontFamily: FONT_MONO,
            fontSize: 11,
            borderRadius: 2,
          }}
          formatter={(v) => [fmtFull(v), 'Works']}
        />
        <Bar
          dataKey={valueKey}
          radius={[0, 1, 1, 0]}
          onClick={handle}
          style={{ cursor: handle ? 'pointer' : 'default' }}
        >
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={fillFor(d, i)}
              fillOpacity={opacityFor(d.key)}
              stroke={selectedKeys.includes(d.key) ? PALETTE.ink : 'none'}
              strokeWidth={selectedKeys.includes(d.key) ? 1.5 : 0}
            />
          ))}
          <LabelList
            dataKey={valueKey}
            position="right"
            style={{ fill: PALETTE.charcoal, fontFamily: FONT_MONO, fontSize: 10 }}
            formatter={(v) => fmt(v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const Donut = ({ data, height = 280, colorMap, onSliceClick, selectedKeys = [] }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const hasSelection = selectedKeys.length > 0;
  const opacityFor = (key) => (!hasSelection ? 1 : selectedKeys.includes(key) ? 1 : 0.25);
  const handle = onSliceClick ? (entry) => onSliceClick(entry) : undefined;

  return (
    <div className="flex items-center gap-4">
      <div style={{ width: '55%' }}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="92%"
              paddingAngle={1}
              stroke={PALETTE.paper}
              strokeWidth={2}
              onClick={handle}
              style={{ cursor: handle ? 'pointer' : 'default' }}
            >
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={(colorMap && colorMap[d.key]) || SERIES[i % SERIES.length]}
                  fillOpacity={opacityFor(d.key)}
                  stroke={selectedKeys.includes(d.key) ? PALETTE.ink : PALETTE.paper}
                  strokeWidth={selectedKeys.includes(d.key) ? 2 : 2}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: PALETTE.paper,
                border: `1px solid ${PALETTE.ink}`,
                fontFamily: FONT_MONO,
                fontSize: 11,
                borderRadius: 2,
              }}
              formatter={(v, n) => [`${fmtFull(v)} (${pct(v, total)})`, n]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-1.5" style={{ fontFamily: FONT_BODY, fontSize: 12 }}>
        {data.map((d, i) => {
          const isSel = selectedKeys.includes(d.key);
          return (
            <li
              key={i}
              className="flex items-baseline gap-2"
              style={{
                cursor: handle ? 'pointer' : 'default',
                opacity: opacityFor(d.key),
              }}
              onClick={handle ? () => handle(d) : undefined}
            >
              <span
                className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full"
                style={{
                  background: (colorMap && colorMap[d.key]) || SERIES[i % SERIES.length],
                  outline: isSel ? `2px solid ${PALETTE.ink}` : 'none',
                  outlineOffset: 1,
                }}
              />
              <span style={{ color: PALETTE.charcoal, fontWeight: isSel ? 500 : 400 }} className="flex-1">
                {d.label}
              </span>
              <span style={{ fontFamily: FONT_MONO, color: PALETTE.ink, fontWeight: 500 }}>{fmtFull(d.value)}</span>
              <span style={{ fontFamily: FONT_MONO, color: PALETTE.muted, fontSize: 10, width: 44 }} className="text-right">
                {pct(d.value, total)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// Single full-width 100% stacked proportion bar. Each segment is one category,
// sized by its share of the total, coloured via colorMap, and clickable to
// cross-filter (same onSegmentClick / selectedKeys contract as the donut and
// bar charts). The legend below carries labels, percentages, and counts so the
// bar itself stays clean. Used for the Access regime breakdown.
const ProportionBar = ({ data, colorMap, onSegmentClick, selectedKeys = [] }) => {
  const items = (data || []).filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  if (!total) {
    return (
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.muted }} className="px-2 py-6">
        No data for the current selection.
      </div>
    );
  }
  const hasSel = selectedKeys.length > 0;
  return (
    <div>
      <div
        className="flex w-full overflow-hidden"
        style={{ height: 46, borderRadius: 4, border: `1px solid ${PALETTE.rule}` }}
      >
        {items.map((d) => {
          const share = (d.value / total) * 100;
          const sel = selectedKeys.includes(d.key);
          const color = (colorMap && colorMap[d.key]) || PALETTE.teal;
          return (
            <div
              key={d.key}
              role={onSegmentClick ? 'button' : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(d) : undefined}
              title={`${d.label}: ${fmtFull(d.value)} (${share.toFixed(1)}%)`}
              style={{
                width: `${share}%`,
                background: color,
                cursor: onSegmentClick ? 'pointer' : 'default',
                opacity: hasSel && !sel ? 0.4 : 1,
                borderRight: `1px solid ${PALETTE.paper}`,
                transition: 'opacity 0.2s ease, width 0.4s ease',
              }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {items.map((d) => {
          const share = (d.value / total) * 100;
          const sel = selectedKeys.includes(d.key);
          const color = (colorMap && colorMap[d.key]) || PALETTE.teal;
          return (
            <button
              key={d.key}
              onClick={onSegmentClick ? () => onSegmentClick(d) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'transparent', border: 'none', padding: 0,
                cursor: onSegmentClick ? 'pointer' : 'default',
                opacity: hasSel && !sel ? 0.5 : 1,
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 2, background: color, flex: 'none' }} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.charcoal }}>{d.label}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: PALETTE.muted }}>
                {share.toFixed(1)}% · {fmtFull(d.value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Small toggle pill used for the institution type/subcategory filters.
// Filter pill for institution type/subcategory rows. The optional `color` prop
// tints the pill: inactive pills show a border + text in that colour against a
// transparent background; active pills fill in solidly so the choice is unambiguous.
// Pills without a colour (the "All" pills) fall back to the dashboard's ink/cream.
const InstPill = ({ active, onClick, label, subtle = false, color = null }) => {
  const accent = color || PALETTE.ink;
  return (
    <button
      onClick={onClick}
      className="rounded-sm px-2 py-1 transition-colors"
      style={{
        border: `1px solid ${active ? accent : (color ? accent : PALETTE.rule)}`,
        background: active ? accent : 'transparent',
        color: active ? PALETTE.cream : (color ? accent : (subtle ? PALETTE.muted : PALETTE.charcoal)),
        fontFamily: FONT_MONO,
        fontSize: subtle ? 10 : 11,
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </button>
  );
};

// Stacked horizontal bars showing cited vs uncited share for the active year
// and up to five prior years. The active row sits at top in full rust + cream;
// prior years sit below in a desaturated, lighter shade so the eye reads them
// as comparison context rather than primary data. Display-only.
const CitationReachBars = ({ series, year, status, error }) => {
  if (status === 'error') {
    return (
      <div style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY, fontSize: 13 }} className="px-3 py-3">
        Could not load citation reach: {error || 'unknown error'}
      </div>
    );
  }
  // series: [{ year, cited, uncited, emphasis }, ...] with the active year first.
  const rows = (series || []).filter((r) => (r.cited || 0) + (r.uncited || 0) > 0);
  if (rows.length === 0) {
    return (
      <div style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }} className="px-3 py-6">
        {status === 'loading' ? 'Loading citation reach…' : 'No works in current selection.'}
      </div>
    );
  }

  // Palette for the bars. The active row uses full rust + cream; comparison rows
  // use a lighter, desaturated rust on a cooler off-cream so they read as muted.
  const CITED_ACTIVE = PALETTE.rust;
  const UNCITED_ACTIVE = PALETTE.cream;
  const CITED_COMPARE = 'rgba(160, 79, 31, 0.32)';   // rust at 32% opacity over paper
  const UNCITED_COMPARE = 'rgba(217, 207, 190, 0.45)'; // rule colour, very faint
  const TEXT_ACTIVE_ON_CITED = PALETTE.cream;
  const TEXT_ACTIVE_ON_UNCITED = PALETTE.charcoal;
  const TEXT_COMPARE = PALETTE.muted;

  // Year-over-year delta vs the most recent comparison row, when present.
  const active = rows.find((r) => r.emphasis);
  const firstCompare = rows.find((r) => !r.emphasis);
  const sharesDelta = active && firstCompare
    ? ((active.cited / (active.cited + active.uncited)) -
       (firstCompare.cited / (firstCompare.cited + firstCompare.uncited))) * 100
    : null;

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const total = r.cited + r.uncited;
        const citedPct = r.cited / total;
        const uncitedPct = r.uncited / total;
        const citedPctStr = (citedPct * 100).toFixed(1) + '%';
        const uncitedPctStr = (uncitedPct * 100).toFixed(1) + '%';
        const showCitedInline = citedPct > 0.18;
        const showUncitedInline = uncitedPct > 0.18;

        const citedBg = r.emphasis ? CITED_ACTIVE : CITED_COMPARE;
        const uncitedBg = r.emphasis ? UNCITED_ACTIVE : UNCITED_COMPARE;
        const citedTextColor = r.emphasis ? TEXT_ACTIVE_ON_CITED : TEXT_COMPARE;
        const uncitedTextColor = r.emphasis ? TEXT_ACTIVE_ON_UNCITED : TEXT_COMPARE;

        return (
          <div key={r.year}>
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-3">
                <span
                  style={{
                    fontFamily: FONT_DISPLAY, fontStyle: 'italic',
                    fontSize: r.emphasis ? 22 : 15,
                    fontWeight: 500,
                    color: r.emphasis ? PALETTE.ink : PALETTE.muted,
                    lineHeight: 1,
                  }}
                >
                  {r.year}
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO, fontSize: 11,
                    color: r.emphasis ? PALETTE.muted : PALETTE.rule,
                    letterSpacing: '0.04em',
                  }}
                >
                  {fmtFull(total)} works
                </span>
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO, fontSize: 11,
                  color: r.emphasis ? PALETTE.ink : PALETTE.muted,
                  letterSpacing: '0.04em', fontWeight: r.emphasis ? 500 : 400,
                }}
              >
                {citedPctStr} cited
              </span>
            </div>
            <div
              className="mt-1.5 flex w-full overflow-hidden"
              style={{
                height: r.emphasis ? 30 : 16,
                borderRadius: 2,
                border: `1px solid ${r.emphasis ? PALETTE.rule : 'transparent'}`,
              }}
              role="img"
              aria-label={`${r.year}: ${fmtFull(r.cited)} cited (${citedPctStr}), ${fmtFull(r.uncited)} uncited (${uncitedPctStr}).`}
            >
              <div
                style={{
                  width: `${citedPct * 100}%`,
                  background: citedBg,
                  color: citedTextColor,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  paddingLeft: r.emphasis ? 8 : 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  transition: 'width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
                title={`Cited: ${fmtFull(r.cited)} (${citedPctStr})`}
              >
                {r.emphasis && showCitedInline && (
                  <span>{fmtFull(r.cited)} cited</span>
                )}
              </div>
              <div
                style={{
                  width: `${uncitedPct * 100}%`,
                  background: uncitedBg,
                  color: uncitedTextColor,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: r.emphasis ? 8 : 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  transition: 'width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
                title={`Uncited: ${fmtFull(r.uncited)} (${uncitedPctStr})`}
              >
                {r.emphasis && showUncitedInline && (
                  <span>{fmtFull(r.uncited)} uncited</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {sharesDelta !== null && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-sm px-3 py-2"
          style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}
        >
          <span
            style={{
              fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted,
            }}
            className="uppercase"
          >
            Year over year
          </span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal }}>
            Cited share in {year} is{' '}
            <strong style={{ color: sharesDelta >= 0 ? PALETTE.forest : PALETTE.burgundy }}>
              {sharesDelta >= 0 ? '↑' : '↓'} {Math.abs(sharesDelta).toFixed(1)} pp
            </strong>{' '}
            vs {firstCompare.year}.{' '}
            <span style={{ color: PALETTE.muted, fontSize: 11.5 }}>
              Some of this gap reflects citation lag for recent years and will close as the corpus ages.
            </span>
          </span>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ kicker, value, sub, accent, loading }) => (
  <Card className="p-5">
    <div
      style={{ fontFamily: FONT_MONO, color: PALETTE.muted, fontSize: 10, letterSpacing: '0.18em' }}
      className="uppercase"
    >
      {kicker}
    </div>
    <div className="mt-3 flex items-baseline gap-2">
      <div
        style={{ fontFamily: FONT_DISPLAY, color: accent || PALETTE.ink, fontSize: 40, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.01em' }}
      >
        {loading ? <Loader2 size={26} className="animate-spin" /> : value}
      </div>
    </div>
    {sub && (
      <div style={{ fontFamily: FONT_BODY, color: PALETTE.muted, fontSize: 12 }} className="mt-2">
        {sub}
      </div>
    )}
  </Card>
);

// Sticky variant of the breadcrumb. Appears as a floating bar at the top of the
// viewport once the user scrolls past the inline breadcrumb in the header AND has
// at least one filter active. Uses position:fixed so it overlays content rather
// than reflowing the page. Intentionally not shown when no filters are active,
// since it would otherwise be a permanent empty bar wasting vertical space.
const StickyFilterBreadcrumb = ({ filters, onRemove, onClear, anchorRef }) => {
  const [visible, setVisible] = useState(false);
  const all = Object.entries(filters).flatMap(([dim, items]) =>
    (items || []).map((item) => ({ dim, ...item }))
  );
  const hasFilters = all.length > 0;

  useEffect(() => {
    if (!anchorRef?.current) return;
    // Show the floating bar when the inline breadcrumb scrolls out of view.
    // We use IntersectionObserver to keep this cheap and event-listener-free.
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: '-1px 0px 0px 0px', threshold: 0 }
    );
    obs.observe(anchorRef.current);
    return () => obs.disconnect();
  }, [anchorRef]);

  if (!hasFilters || !visible) return null;

  return (
    <div
      className="fixed left-0 right-0 top-0 z-40 border-b shadow-sm"
      style={{
        background: PALETTE.paper,
        borderColor: PALETTE.ink,
        boxShadow: '0 2px 8px rgba(26,22,18,0.08)',
        backdropFilter: 'saturate(1.4) blur(2px)',
      }}
      role="region"
      aria-label="Active filters"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-6 py-2.5">
        <span
          style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.2em' }}
          className="uppercase flex-none"
        >
          Filtering by
        </span>
        {all.map((f) => {
          const def = DIMENSIONS[f.dim];
          return (
            <button
              key={`sticky::${f.dim}::${f.value}`}
              onClick={() => onRemove(f.dim, f.value)}
              className="group flex items-center gap-2 rounded-sm px-2 py-1 transition-colors"
              style={{
                background: PALETTE.ink,
                color: PALETTE.cream,
                fontFamily: FONT_BODY,
                fontSize: 12,
                maxWidth: 320,
              }}
              title="Remove this filter"
            >
              <span
                style={{ fontFamily: FONT_MONO, fontSize: 9, opacity: 0.55, letterSpacing: '0.1em' }}
                className="uppercase"
              >
                {def?.label || f.dim}
              </span>
              <span className="truncate">{f.label}</span>
              <X size={12} className="flex-none opacity-60 group-hover:opacity-100" />
            </button>
          );
        })}
        <button
          onClick={onClear}
          className="ml-1"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: PALETTE.burgundy,
            textDecoration: 'underline',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Clear all
        </button>
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: PALETTE.muted,
            background: 'transparent',
            border: `1px solid ${PALETTE.rule}`,
            padding: '4px 10px',
            borderRadius: 2,
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}
          className="ml-auto flex-none uppercase hover:bg-[var(--cream)]"
          title="Scroll back to top"
        >
          ↑ Top
        </button>
      </div>
    </div>
  );
};

// Filter pills row. Renders one chip per active filter and a Clear all link.
const FilterBreadcrumb = ({ filters, onRemove, onClear, innerRef }) => {
  const all = Object.entries(filters).flatMap(([dim, items]) =>
    (items || []).map((item) => ({ dim, ...item }))
  );
  const active = all.length > 0;
  return (
    <div
      ref={innerRef}
      className="mt-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5"
      style={{
        borderColor: active ? PALETTE.ink : PALETTE.rule,
        background: active ? PALETTE.cream : 'transparent',
        borderStyle: active ? 'solid' : 'dashed',
      }}
    >
      <span
        style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.2em' }}
        className="uppercase"
      >
        {active ? 'Filtering by' : 'No filters · click any bar or slice to focus'}
      </span>
      {all.map((f) => {
        const def = DIMENSIONS[f.dim];
        return (
          <button
            key={`${f.dim}::${f.value}`}
            onClick={() => onRemove(f.dim, f.value)}
            className="group flex items-center gap-2 rounded-sm px-2 py-1 transition-colors"
            style={{
              background: PALETTE.ink,
              color: PALETTE.cream,
              fontFamily: FONT_BODY,
              fontSize: 12,
              maxWidth: 320,
            }}
            title="Remove this filter"
          >
            <span
              style={{ fontFamily: FONT_MONO, fontSize: 9, opacity: 0.55, letterSpacing: '0.1em' }}
              className="uppercase"
            >
              {def?.label || f.dim}
            </span>
            <span className="truncate">{f.label}</span>
            <X size={12} className="flex-none opacity-60 group-hover:opacity-100" />
          </button>
        );
      })}
      {active && (
        <button
          onClick={onClear}
          className="ml-1"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: PALETTE.burgundy,
            textDecoration: 'underline',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
};

// CSV download for the table modal.
const downloadCsv = (rows, filename) => {
  const total = rows.reduce((s, d) => s + d.value, 0);
  const header = ['Rank', 'Label', 'Works', 'Share'];
  const csvRows = [
    header.join(','),
    ...rows.map((d, i) => [
      i + 1,
      `"${(d.label || '').replace(/"/g, '""')}"`,
      d.value,
      total ? ((d.value / total) * 100).toFixed(2) + '%' : '',
    ].join(',')),
  ];
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Per-chart toolbar shown beneath the chart. Lets users pick how many bars
// to render and open the full data as a sortable table.
const ChartControls = ({
  total, limit, onLimitChange, onOpenTable,
  options = [12, 25, 50],
}) => {
  if (!total || total === 0) return null;
  // Hide the size selector entirely when there is so little data it would be pointless.
  const showSizing = total > options[0];
  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
      style={{ borderColor: PALETTE.rule }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {showSizing && (
          <>
            <span
              style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
              className="uppercase mr-1"
            >
              Show
            </span>
            {options.filter((n) => n < total).map((n) => {
              const active = limit === n;
              return (
                <button
                  key={n}
                  onClick={() => onLimitChange(n)}
                  className="rounded-sm px-2 py-0.5 transition-colors"
                  style={{
                    border: `1px solid ${active ? PALETTE.ink : PALETTE.rule}`,
                    background: active ? PALETTE.ink : 'transparent',
                    color: active ? PALETTE.cream : PALETTE.charcoal,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                  }}
                >
                  {n}
                </button>
              );
            })}
            <button
              onClick={() => onLimitChange(total)}
              className="rounded-sm px-2 py-0.5 transition-colors"
              style={{
                border: `1px solid ${limit >= total ? PALETTE.ink : PALETTE.rule}`,
                background: limit >= total ? PALETTE.ink : 'transparent',
                color: limit >= total ? PALETTE.cream : PALETTE.charcoal,
                fontFamily: FONT_MONO,
                fontSize: 11,
              }}
              title="Render every available bar inline"
            >
              All ({total})
            </button>
          </>
        )}
      </div>
      <button
        onClick={onOpenTable}
        className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 transition-colors"
        style={{
          border: `1px solid ${PALETTE.ink}`,
          background: 'transparent',
          color: PALETTE.ink,
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: '0.06em',
        }}
        title="Open full sortable table"
      >
        <TableIcon size={12} />
        <span>Table & CSV</span>
      </button>
    </div>
  );
};

// Modal table: searchable, sortable, exportable, and click-to-filter. The filter
// pattern matches the chart bars: clicking a row toggles that label as a filter
// in the parent dashboard, and the breadcrumb at the top of the page reflects the
// change in real time. When a row is selected its checkbox fills in and a chip
// counter appears in the footer for one-click "clear all in this dimension".
const TableModal = ({
  open, onClose, title, kicker, data,
  filterable = false, selectedKeys = [], onToggleFilter, onClearAllInDim,
}) => {
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' or 'desc' on works
  const [sortBy, setSortBy] = useState('value'); // 'rank' | 'label' | 'value'

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while modal open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const total = (data || []).reduce((s, d) => s + d.value, 0);
  const filtered = (data || []).filter((d) =>
    !search.trim() || (d.label || '').toLowerCase().includes(search.trim().toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) => {
    let cmp;
    if (sortBy === 'label') cmp = (a.label || '').localeCompare(b.label || '');
    else if (sortBy === 'value') cmp = a.value - b.value;
    else cmp = 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir(col === 'label' ? 'asc' : 'desc'); }
  };

  const arrow = (col) => sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const isSelected = (key) => selectedKeys.includes(key);
  const selectedInDim = selectedKeys.length;
  const handleRowClick = (d) => {
    if (!filterable || !onToggleFilter || !d.key) return;
    onToggleFilter({ value: d.key, label: d.label });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26, 22, 18, 0.55)', fontFamily: FONT_BODY }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md"
        style={{ background: PALETTE.paper, border: `1px solid ${PALETTE.ink}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: PALETTE.rule }}
        >
          <div>
            <div
              style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.2em' }}
              className="uppercase"
            >
              {kicker}
            </div>
            <h3
              style={{ fontFamily: FONT_DISPLAY, color: PALETTE.ink, fontSize: 22, fontWeight: 500, fontStyle: 'italic', lineHeight: 1.15 }}
              className="mt-0.5"
            >
              {title}
            </h3>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: PALETTE.muted }} className="mt-1">
              {sorted.length.toLocaleString()} of {(data || []).length.toLocaleString()} rows · {fmtFull(total)} total works
              {filterable && selectedInDim > 0 && (
                <span style={{ color: PALETTE.burgundy }}>
                  {' · '}
                  {selectedInDim} selected
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-sm"
            style={{ border: `1px solid ${PALETTE.rule}`, color: PALETTE.ink, background: 'transparent' }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${PALETTE.rule}` }}>
          <div className="flex flex-1 items-center gap-2 rounded-sm px-2.5 py-1.5" style={{ border: `1px solid ${PALETTE.rule}`, background: PALETTE.cream }}>
            <Search size={13} style={{ color: PALETTE.muted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name…"
              className="w-full bg-transparent outline-none"
              style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.ink }}
            />
          </div>
          <button
            onClick={() => downloadCsv(sorted, `${(title || 'data').toLowerCase().replace(/\s+/g, '-')}.csv`)}
            className="flex items-center gap-1.5 rounded-sm px-3 py-1.5"
            style={{
              background: PALETTE.ink, color: PALETTE.cream,
              fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
            }}
            title="Download visible rows as CSV"
          >
            <Download size={12} />
            <span>CSV</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full" style={{ fontFamily: FONT_BODY, fontSize: 13 }}>
            <thead
              className="sticky top-0"
              style={{
                background: PALETTE.paper,
                borderBottom: `1px solid ${PALETTE.ink}`,
                boxShadow: `0 1px 0 ${PALETTE.rule}`,
              }}
            >
              <tr>
                {filterable && (
                  <th
                    className="px-3 py-2.5 text-center"
                    style={{ width: 36, fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }}
                    title="Filter selection"
                  >
                    ▢
                  </th>
                )}
                <th
                  onClick={() => toggleSort('rank')}
                  className="px-5 py-2.5 text-left"
                  style={{ width: 56, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }}
                >
                  #
                </th>
                <th
                  onClick={() => toggleSort('label')}
                  className="px-3 py-2.5 text-left"
                  style={{ cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }}
                >
                  NAME{arrow('label')}
                </th>
                <th
                  onClick={() => toggleSort('value')}
                  className="px-3 py-2.5 text-right"
                  style={{ cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted, width: 110 }}
                >
                  WORKS{arrow('value')}
                </th>
                <th
                  className="px-5 py-2.5 text-right"
                  style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted, width: 90 }}
                >
                  SHARE
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => {
                const sel = isSelected(d.key);
                const rowStyle = {
                  borderBottom: `1px solid ${PALETTE.rule}`,
                  background: sel ? 'rgba(122,46,62,0.07)' : 'transparent',
                  cursor: filterable ? 'pointer' : 'default',
                };
                return (
                  <tr
                    key={d.key || i}
                    style={rowStyle}
                    onClick={() => handleRowClick(d)}
                    onMouseEnter={(e) => {
                      if (!sel) e.currentTarget.style.background = PALETTE.cream;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = sel ? 'rgba(122,46,62,0.07)' : 'transparent';
                    }}
                    title={filterable ? (sel ? 'Click to remove filter' : 'Click to filter dashboard by this row') : undefined}
                  >
                    {filterable && (
                      <td className="px-3 py-2 text-center">
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 16, height: 16,
                            border: `1.5px solid ${sel ? PALETTE.burgundy : PALETTE.rule}`,
                            background: sel ? PALETTE.burgundy : 'transparent',
                            color: PALETTE.cream,
                            fontSize: 10,
                            lineHeight: 1,
                            borderRadius: 2,
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {sel ? '✓' : ''}
                        </span>
                      </td>
                    )}
                    <td className="px-5 py-2" style={{ fontFamily: FONT_MONO, fontSize: 11, color: PALETTE.muted }}>
                      {i + 1}
                    </td>
                    <td className="px-3 py-2" style={{ color: sel ? PALETTE.ink : PALETTE.charcoal, fontWeight: sel ? 500 : 400 }}>
                      {d.label}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ fontFamily: FONT_MONO, fontSize: 12, color: PALETTE.ink, fontWeight: 500 }}>
                      {fmtFull(d.value)}
                    </td>
                    <td className="px-5 py-2 text-right" style={{ fontFamily: FONT_MONO, fontSize: 11, color: PALETTE.muted }}>
                      {pct(d.value, total)}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={filterable ? 5 : 4} className="px-5 py-10 text-center" style={{ color: PALETTE.muted }}>
                    No rows match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer
          className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: PALETTE.rule, fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.1em' }}
        >
          <span className="uppercase">
            {filterable ? 'Click row to filter · Esc to close · Headers sort' : 'Esc to close · Click headers to sort · Search filters in place'}
          </span>
          {filterable && selectedInDim > 0 && onClearAllInDim && (
            <button
              onClick={onClearAllInDim}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: PALETTE.burgundy,
                textDecoration: 'underline',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.1em',
              }}
              className="uppercase"
            >
              Clear {selectedInDim} in this dimension
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

// Pure-SVG scatter plot of total works (log x) vs cited (or uncited) share (linear y).
// Each dot is one entity (field, subfield, or institution). The dots that would
// appear in the top-N ranking are drawn in the accent colour; everything else is
// muted grey. A dashed horizontal reference line at the global rate makes the
// "above/below expected" interpretation visible at a glance. Hovering a dot shows
// its label and counts in a small tooltip.
const CitationReachScatter = ({ rows, globalRate, mode, minWorks, status, sortMode, topN, meanCitesMap }) => {
  const W = 560;
  const H = 320;
  const PAD = { top: 14, right: 20, bottom: 36, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const accent = mode === 'cited' ? PALETTE.rust : PALETTE.muted;
  const muted = '#c9c0ad'; // a touch lighter than rule, for non-top dots
  const [hover, setHover] = React.useState(null);

  // Decorate rows with meanCites when available; for meanCites sort, drop rows
  // without a cached value so the scatter only shows entities we actually ranked.
  const decoratedRows = React.useMemo(() => {
    if (sortMode === 'meanCites' && meanCitesMap) {
      return (rows || [])
        .map((r) => ({ ...r, meanCites: meanCitesMap.get(r.key) }))
        .filter((r) => r.meanCites != null);
    }
    return rows || [];
  }, [rows, sortMode, meanCitesMap]);

  // Compute top-N keys to highlight, mirroring the sort logic from renderList.
  const topKeys = React.useMemo(() => {
    const sorted = [...decoratedRows].sort((a, b) => {
      if (sortMode === 'excess') return b.excess - a.excess;
      if (sortMode === 'meanCites') return (b.meanCites || 0) - (a.meanCites || 0);
      return b.share - a.share || b.total - a.total;
    });
    return new Set(sorted.slice(0, topN).map((d) => d.key));
  }, [decoratedRows, sortMode, topN]);

  if (status === 'loading') {
    return (
      <div className="flex h-[320px] items-center justify-center" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="ml-2">Loading scatter…</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex h-[320px] items-center justify-center" style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY, fontSize: 13 }}>
        Could not load.
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
        No entries with at least {minWorks} works.
      </div>
    );
  }
  // Mean-cites sort but cache not loaded yet (or all empty): show a hint.
  if (sortMode === 'meanCites' && decoratedRows.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="ml-2">Computing mean cites/work for the scatter…</span>
      </div>
    );
  }

  // Build x-axis from total works (log scale, common to both modes).
  const totals = decoratedRows.map((d) => d.total);
  const minTotal = Math.max(minWorks, Math.min(...totals));
  const maxTotal = Math.max(...totals);
  const xLogMin = Math.log10(minTotal);
  const xLogMax = Math.log10(maxTotal);
  const xRange = Math.max(0.0001, xLogMax - xLogMin);
  const xFor = (v) => PAD.left + ((Math.log10(v) - xLogMin) / xRange) * plotW;

  // Y-axis depends on sort mode.
  //   share/excess modes: linear y, share runs 0..1
  //   meanCites mode: log y, range derived from the meanCites values present
  const isMeanCitesAxis = sortMode === 'meanCites' && meanCitesMap;
  let yFor, yTicks, refLineY, refLineLabel;
  if (isMeanCitesAxis) {
    // Log scale on mean cites. Clamp the floor to 0.5 so a true zero doesn't
    // blow up the log, and pad the ceiling slightly so dots aren't on the edge.
    const means = decoratedRows.map((d) => Math.max(0.5, d.meanCites || 0.5));
    const yLogMin = Math.log10(Math.min(...means, 0.5));
    const yLogMax = Math.log10(Math.max(...means, 1));
    const yLogPaddedMin = Math.floor(yLogMin);
    const yLogPaddedMax = Math.ceil(yLogMax + 0.05);
    const yLogRange = Math.max(0.5, yLogPaddedMax - yLogPaddedMin);
    yFor = (v) => {
      const safe = Math.max(0.5, v);
      return PAD.top + (1 - (Math.log10(safe) - yLogPaddedMin) / yLogRange) * plotH;
    };
    // Country-wide mean cites: weighted average of meanCites by total works,
    // computed across all entities the user has cached.
    let weightedSum = 0;
    let weightDenom = 0;
    for (const d of decoratedRows) {
      if (d.meanCites != null) {
        weightedSum += d.meanCites * d.total;
        weightDenom += d.total;
      }
    }
    const meanOfMeans = weightDenom > 0 ? weightedSum / weightDenom : null;
    if (meanOfMeans != null && meanOfMeans > 0) {
      refLineY = yFor(meanOfMeans);
      refLineLabel = `Country avg ${meanOfMeans.toFixed(1)} cites/work`;
    }
    // Ticks at every power of 10 within range.
    yTicks = [];
    for (let p = yLogPaddedMin; p <= yLogPaddedMax; p++) {
      yTicks.push(Math.pow(10, p));
    }
  } else {
    yFor = (s) => PAD.top + (1 - s) * plotH;
    yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    if (globalRate > 0 && globalRate < 1) {
      refLineY = yFor(globalRate);
      refLineLabel = `Country rate ${(globalRate * 100).toFixed(1)}%`;
    }
  }

  // X-axis log gridlines at powers of 10 within range.
  const xTicks = [];
  for (let p = Math.floor(xLogMin); p <= Math.ceil(xLogMax); p++) {
    const v = Math.pow(10, p);
    if (v < minTotal * 0.95) continue;
    if (v > maxTotal * 1.05) continue;
    xTicks.push({ v, x: xFor(v) });
  }

  // Y-axis tick formatter
  const fmtYTick = (v) => {
    if (isMeanCitesAxis) {
      return v >= 1 ? (v >= 1000 ? `${v / 1000}k` : v.toString()) : v.toFixed(1);
    }
    return `${(v * 100).toFixed(0)}%`;
  };
  // Position to plot a dot on the y-axis depending on mode.
  const dotY = (d) => isMeanCitesAxis ? yFor(d.meanCites) : yFor(d.share);

  return (
    <div className="relative" style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Y gridlines + labels */}
        {yTicks.map((y) => (
          <g key={`y-${y}`}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={yFor(y)} y2={yFor(y)}
              stroke={PALETTE.rule}
              strokeDasharray="2 4"
            />
            <text
              x={PAD.left - 6} y={yFor(y) + 3}
              textAnchor="end"
              style={{ fontFamily: FONT_MONO, fontSize: 9, fill: PALETTE.muted }}
            >
              {fmtYTick(y)}
            </text>
          </g>
        ))}
        {/* Reference line: country-wide share or country-wide mean cites */}
        {refLineY != null && (
          <g>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={refLineY} y2={refLineY}
              stroke={accent}
              strokeWidth="1.2"
              strokeDasharray="4 3"
              opacity="0.7"
            />
            <text
              x={W - PAD.right - 6} y={refLineY - 4}
              textAnchor="end"
              style={{ fontFamily: FONT_MONO, fontSize: 9, fill: accent, fontWeight: 500 }}
            >
              {refLineLabel}
            </text>
          </g>
        )}
        {/* X gridlines + labels */}
        {xTicks.map((t) => (
          <g key={`x-${t.v}`}>
            <line
              x1={t.x} x2={t.x}
              y1={PAD.top} y2={H - PAD.bottom}
              stroke={PALETTE.rule}
              strokeDasharray="2 4"
            />
            <text
              x={t.x} y={H - PAD.bottom + 14}
              textAnchor="middle"
              style={{ fontFamily: FONT_MONO, fontSize: 9, fill: PALETTE.muted }}
            >
              {t.v >= 1000 ? `${t.v / 1000}k` : t.v.toString()}
            </text>
          </g>
        ))}
        {/* Axis titles */}
        <text
          x={PAD.left + plotW / 2} y={H - 4}
          textAnchor="middle"
          style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.12em', fill: PALETTE.charcoal }}
        >
          TOTAL WORKS (LOG)
        </text>
        <text
          x={14} y={PAD.top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${PAD.top + plotH / 2})`}
          style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.12em', fill: PALETTE.charcoal }}
        >
          {isMeanCitesAxis
            ? 'MEAN CITES/WORK (LOG)'
            : (mode === 'cited' ? '% CITED' : '% UNCITED')}
        </text>
        {/* Dots: non-top first so top sit on top */}
        {decoratedRows.filter((d) => !topKeys.has(d.key)).map((d) => (
          <circle
            key={d.key}
            cx={xFor(d.total)} cy={dotY(d)}
            r="3.5"
            fill={muted}
            opacity="0.55"
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}
        {decoratedRows.filter((d) => topKeys.has(d.key)).map((d) => (
          <circle
            key={d.key}
            cx={xFor(d.total)} cy={dotY(d)}
            r="5"
            fill={accent}
            stroke={PALETTE.paper}
            strokeWidth="1.4"
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      {/* Tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute rounded-sm px-2.5 py-1.5"
          style={{
            background: PALETTE.ink,
            color: PALETTE.cream,
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            lineHeight: 1.3,
            border: `1px solid ${PALETTE.ink}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            left: `${((xFor(hover.total) + 12) / W) * 100}%`,
            top: `${((yFor(hover.share) - 6) / H) * 100}%`,
            maxWidth: 240,
            whiteSpace: 'nowrap',
            transform: 'translateY(-100%)',
          }}
        >
          <div style={{ fontWeight: 500, whiteSpace: 'normal' }}>{hover.label}</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, opacity: 0.85, marginTop: 2 }}>
            {(hover.share * 100).toFixed(1)}% · {fmtFull(hover.subset)} / {fmtFull(hover.total)}
            {hover.excess !== undefined && (
              <span> · {hover.excess >= 0 ? '+' : ''}{Math.round(hover.excess).toLocaleString()} vs expected</span>
            )}
            {meanCitesMap && meanCitesMap.get(hover.key) != null && (
              <span> · {meanCitesMap.get(hover.key).toFixed(1)} mean cites/work</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Citation insight section showing top institutions, fields, subfields,
// publishers, and international-collaborator countries for the cited or
// uncited subset of the active selection. The reader picks the mode
// (cited or uncited) and the ranking metric (within-entity percentage,
// or extra count vs expected) via toggles inside the section. The section
// owns its own data fetch and only loads the active mode, so switching modes
// triggers a reload rather than carrying both at once.
const CitationInsightSection = ({ year, country, baseFilterStr, countryInstitutionIds = [], activeFilters = {} }) => {
  // Minimum works per entity to qualify for ranking. Below this, share percentages
  // are too noisy to be meaningful (e.g. a field with 3 works at 100% cited).
  const MIN_WORKS_FOR_FIELD = 30;
  const MIN_WORKS_FOR_SUBFIELD = 15;
  const MIN_WORKS_FOR_INSTITUTION = 20;
  const MIN_WORKS_FOR_PUBLISHER = 20;
  const MIN_WORKS_FOR_COUNTRY = 20;
  const TOP_N = 20;

  // 'cited' or 'uncited'. Selectable via toggle at the top of the section.
  const [mode, setMode] = useState('cited');

  const [fields, setFields] = useState({ status: 'idle', rows: [], globalRate: 0 });
  const [subfields, setSubfields] = useState({ status: 'idle', rows: [], globalRate: 0 });
  const [institutions, setInstitutions] = useState({ status: 'idle', rows: [], globalRate: 0 });
  const [publishers, setPublishers] = useState({ status: 'idle', rows: [], globalRate: 0 });
  const [countries, setCountries] = useState({ status: 'idle', rows: [], globalRate: 0 });

  // Sort mode for the ranking. 'share' = ranked by within-entity percentage
  // (precision view); 'excess' = ranked by subset minus expected based on global
  // rate (volume-aware view); 'meanCites' = ranked by average citations per work
  // within each entity (combines volume and depth). meanCites is lazy-loaded
  // because computing it requires one extra API call per top entity.
  const [sortMode, setSortMode] = useState('share');
  // Default to institutions tab since institutional patterns are the most
  // policy-actionable lens for OAR readers.
  const [dimensionTab, setDimensionTab] = useState('institutions');

  // Lazy cache for mean-cites-per-work data. Keyed by dimension; each entry is
  // { status, data: Map<entityKey, number> }. Cleared whenever mode or
  // baseFilterStr changes (because the underlying subset of works changes).
  const [meanCitesByDim, setMeanCitesByDim] = useState({});

  // Mean-cites only makes sense for the cited subset (uncited works all have
  // zero citations by definition). Auto-revert if the user flips to uncited
  // while that sort was active.
  useEffect(() => {
    if (mode === 'uncited' && sortMode === 'meanCites') {
      setSortMode('share');
    }
  }, [mode, sortMode]);

  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    const subsetClause = mode === 'cited' ? 'cited_by_count:>0' : 'cited_by_count:0';
    const subsetFilter = `${baseFilterStr},${subsetClause}`;
    const totalFilter = baseFilterStr;
    setFields({ status: 'loading', rows: [], globalRate: 0 });
    setSubfields({ status: 'loading', rows: [], globalRate: 0 });
    setInstitutions({ status: 'loading', rows: [], globalRate: 0 });
    setPublishers({ status: 'loading', rows: [], globalRate: 0 });
    setCountries({ status: 'loading', rows: [], globalRate: 0 });
    // Mean-cites cache is invalidated whenever the underlying subset changes.
    // The user will need to click Mean cites/work again to recompute.
    setMeanCitesByDim({});

    // Fetch a group_by and return a map of key → { count, label }.
    const fetchGroupMap = async (filterStr, groupBy) => {
      const url = withMailto(
        `${OPENALEX_BASE}/works?filter=${filterStr}&group_by=${groupBy}&per-page=200`
      );
      const j = await fetchJson(url);
      const map = new Map();
      for (const g of j.group_by || []) {
        if (!g.key || g.key === 'unknown') continue;
        map.set(g.key, { count: g.count, label: g.key_display_name });
      }
      return map;
    };

    // Build a ranked array from numerator and denominator maps. Each row carries
    // both metrics: `share` (subset / total within entity, the precision-like view)
    // and `excess` (subset minus expected, the volume-aware view). Expected =
    // total × global_rate, so excess is positive when an entity outperforms the
    // global cited (or uncited) rate scaled to its size, and negative otherwise.
    // minWorks gates noisy small samples out of the ranking.
    const buildRankedList = (subsetMap, totalMap, minWorks) => {
      // Global rate across all entries in this dimension: total subset count /
      // total denominator count. Used to compute expected for excess.
      let subsetSum = 0;
      let totalSum = 0;
      for (const [, totalEntry] of totalMap.entries()) totalSum += totalEntry.count;
      for (const [, subsetEntry] of subsetMap.entries()) subsetSum += subsetEntry.count;
      const globalRate = totalSum > 0 ? subsetSum / totalSum : 0;

      const rows = [];
      for (const [key, totalEntry] of totalMap.entries()) {
        if (totalEntry.count < minWorks) continue;
        const subsetCount = subsetMap.get(key)?.count || 0;
        const share = subsetCount / totalEntry.count;
        const expected = totalEntry.count * globalRate;
        const excess = subsetCount - expected;
        rows.push({
          key,
          label: totalEntry.label || subsetMap.get(key)?.label,
          subset: subsetCount,
          total: totalEntry.count,
          share,
          expected,
          excess,
        });
      }
      return { rows, globalRate };
    };

    (async () => {
      try {
        // Ten parallel fetches: subset and total for each of five dimensions.
        const [
          subsetFields, totalFields,
          subsetSubfields, totalSubfields,
          subsetInsts, totalInsts,
          subsetPubs, totalPubs,
          subsetCtys, totalCtys,
        ] = await Promise.all([
          fetchGroupMap(subsetFilter, 'primary_topic.field.id'),
          fetchGroupMap(totalFilter,  'primary_topic.field.id'),
          fetchGroupMap(subsetFilter, 'primary_topic.subfield.id'),
          fetchGroupMap(totalFilter,  'primary_topic.subfield.id'),
          fetchGroupMap(subsetFilter, 'authorships.institutions.id'),
          fetchGroupMap(totalFilter,  'authorships.institutions.id'),
          fetchGroupMap(subsetFilter, 'primary_location.source.host_organization'),
          fetchGroupMap(totalFilter,  'primary_location.source.host_organization'),
          fetchGroupMap(subsetFilter, 'authorships.countries'),
          fetchGroupMap(totalFilter,  'authorships.countries'),
        ]);
        if (cancelled) return;

        // Filter the institutions maps to the country roster so foreign
        // collaborators don't dominate the rankings. The country roster comes
        // from state.institutions.data (the Producing Institutions panel).
        let filteredSubsetInsts = subsetInsts;
        let filteredTotalInsts = totalInsts;
        if (countryInstitutionIds && countryInstitutionIds.length > 0) {
          const allowed = new Set(countryInstitutionIds);
          filteredSubsetInsts = new Map([...subsetInsts].filter(([k]) => allowed.has(k)));
          filteredTotalInsts  = new Map([...totalInsts].filter(([k]) => allowed.has(k)));
        }

        // Normalise country keys: OpenAlex returns either bare ISO-2 codes or
        // full URLs like https://openalex.org/countries/TH. Re-key both maps by
        // the ISO code and drop the active country itself (we want international
        // collaborators only). The label is the country's display name.
        const normaliseCountries = (m) => {
          const out = new Map();
          for (const [rawKey, entry] of m.entries()) {
            const match = String(rawKey).match(/\/countries\/([A-Z]{2})$/i);
            const code = (match ? match[1] : rawKey).toUpperCase();
            if (!code || code.length !== 2) continue;
            if (code === country) continue;
            if (code === 'UNKNOWN') continue;
            // If two raw keys collapse to the same ISO (shouldn't happen in
            // practice but be defensive), keep the larger count.
            const existing = out.get(code);
            if (!existing || entry.count > existing.count) {
              out.set(code, { count: entry.count, label: countryName(code) });
            }
          }
          return out;
        };
        const subsetCountryMap = normaliseCountries(subsetCtys);
        const totalCountryMap = normaliseCountries(totalCtys);

        setFields({ status: 'ready', ...buildRankedList(subsetFields, totalFields, MIN_WORKS_FOR_FIELD) });
        setSubfields({ status: 'ready', ...buildRankedList(subsetSubfields, totalSubfields, MIN_WORKS_FOR_SUBFIELD) });
        setInstitutions({ status: 'ready', ...buildRankedList(filteredSubsetInsts, filteredTotalInsts, MIN_WORKS_FOR_INSTITUTION) });
        setPublishers({ status: 'ready', ...buildRankedList(subsetPubs, totalPubs, MIN_WORKS_FOR_PUBLISHER) });
        setCountries({ status: 'ready', ...buildRankedList(subsetCountryMap, totalCountryMap, MIN_WORKS_FOR_COUNTRY) });
      } catch (e) {
        if (cancelled) return;
        setFields({ status: 'error', rows: [], globalRate: 0, error: e.message });
        setSubfields({ status: 'error', rows: [], globalRate: 0, error: e.message });
        setInstitutions({ status: 'error', rows: [], globalRate: 0, error: e.message });
        setPublishers({ status: 'error', rows: [], globalRate: 0, error: e.message });
        setCountries({ status: 'error', rows: [], globalRate: 0, error: e.message });
      }
    })();

    return () => { cancelled = true; };
    // countryInstitutionIds is an array recreated on every parent render. Using
    // it directly as a dep would trigger this effect on every render (since
    // React compares deps by reference, not value), causing an infinite refetch
    // loop. Joining to a string gives a stable value-based identity that only
    // changes when the actual roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, baseFilterStr, countryInstitutionIds.join(',')]);

  // Lazy fetcher for mean-cites-per-work. Fires only when the user activates the
  // 'meanCites' sort mode and the cache for the active tab isn't populated. For
  // each top-N entity (by total works), we fire one /works request that filters
  // to that entity within the active subset, group_by cited_by_count, and sum
  // (key × count) to get the entity's total citations. Mean = total / works.
  //
  // We cap per-tab fetches at top 30 entities by total works. The top 20 by
  // mean cites/work will overwhelmingly come from this pool, because high mean
  // cites usually correlates positively with size (popular fields draw more
  // collaborators and citation networks). Tiny entities with extreme means are
  // already filtered out by the min-works threshold.
  useEffect(() => {
    if (sortMode !== 'meanCites') return;
    // Identify the active tab's data and the filter expression for "entity = X"
    // we'll use when fetching per-entity citations.
    const tabSource = {
      institutions: { data: institutions, filterKey: 'authorships.institutions.id' },
      fields:       { data: fields,       filterKey: 'primary_topic.field.id' },
      subfields:    { data: subfields,    filterKey: 'primary_topic.subfield.id' },
      publishers:   { data: publishers,   filterKey: 'primary_location.source.host_organization' },
      countries:    { data: countries,    filterKey: 'authorships.countries' },
    }[dimensionTab];
    if (!tabSource || tabSource.data.status !== 'ready') return;
    // Already cached or in-flight? Skip.
    const cached = meanCitesByDim[dimensionTab];
    if (cached && (cached.status === 'ready' || cached.status === 'loading')) return;

    const subsetClause = mode === 'cited' ? 'cited_by_count:>0' : 'cited_by_count:0';
    const subsetFilter = `${baseFilterStr},${subsetClause}`;
    const topEntities = [...tabSource.data.rows]
      .sort((a, b) => b.total - a.total)
      .slice(0, 30);
    if (topEntities.length === 0) return;

    let cancelled = false;
    setMeanCitesByDim((m) => ({ ...m, [dimensionTab]: { status: 'loading', data: new Map() } }));

    const fetchMean = async (entity) => {
      // Normalise entity.key to the form OpenAlex's filter parameter accepts.
      // For institutions/fields/subfields/publishers OpenAlex returns full URLs
      // like https://openalex.org/I123; the filter expects the bare ID. For
      // countries the key is already an ISO-2 code. normalizeFilterValue handles
      // all of these forms.
      const filterValue = normalizeFilterValue(entity.key);
      const url = withMailto(
        `${OPENALEX_BASE}/works?filter=${subsetFilter},${tabSource.filterKey}:${encodeURIComponent(filterValue)}` +
        `&group_by=cited_by_count&per-page=200`
      );
      try {
        const j = await fetchJson(url);
        let totalCites = 0;
        let totalWorks = 0;
        for (const g of j.group_by || []) {
          const cites = Number(g.key) || 0;
          const works = g.count || 0;
          totalCites += cites * works;
          totalWorks += works;
        }
        return [entity.key, totalWorks > 0 ? totalCites / totalWorks : 0];
      } catch {
        return [entity.key, null];
      }
    };

    Promise.all(topEntities.map(fetchMean)).then((results) => {
      if (cancelled) return;
      const out = new Map();
      for (const [k, v] of results) {
        if (v !== null) out.set(k, v);
      }
      setMeanCitesByDim((m) => ({ ...m, [dimensionTab]: { status: 'ready', data: out } }));
    });

    return () => { cancelled = true; };
  }, [sortMode, dimensionTab, mode, baseFilterStr, fields.status, subfields.status, institutions.status, publishers.status, countries.status]);

  const titleMode = mode === 'cited' ? 'cited at least once' : 'still uncited';
  const accent = mode === 'cited' ? PALETTE.rust : PALETTE.muted;
  const shareLabel = mode === 'cited' ? '% cited' : '% uncited';

  const renderList = ({ status, rows }, minWorks) => {
    if (status === 'loading') {
      return (
        <div className="flex items-center gap-2 px-3 py-6" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      );
    }
    if (status === 'error') {
      return <div className="px-3 py-6" style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY, fontSize: 13 }}>Could not load.</div>;
    }
    if (!rows || rows.length === 0) {
      return (
        <div className="px-3 py-6" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
          No entries with at least {minWorks} works in this subset.
        </div>
      );
    }

    // For mean-cites mode, decorate rows with the cached mean (if computed).
    // Rows without a cached mean are excluded from the ranking (they sit
    // outside the top 30 we fetched).
    const meanState = meanCitesByDim[dimensionTab];
    const meanCacheReady = sortMode === 'meanCites' && meanState?.status === 'ready';
    const meanCacheLoading = sortMode === 'meanCites' && (meanState?.status === 'loading' || !meanState);
    if (meanCacheLoading) {
      return (
        <div className="flex items-center gap-2 px-3 py-6" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" />
          <span>Computing mean citations per work (one call per entity, up to 30 entities)…</span>
        </div>
      );
    }
    const decorated = sortMode === 'meanCites'
      ? rows
          .map((r) => ({ ...r, meanCites: meanState.data.get(r.key) }))
          .filter((r) => r.meanCites !== undefined && r.meanCites !== null)
      : rows;

    // Sort the precomputed rows by the active mode, then take top-N.
    const sorted = [...decorated].sort((a, b) => {
      if (sortMode === 'excess') return b.excess - a.excess;
      if (sortMode === 'meanCites') return (b.meanCites || 0) - (a.meanCites || 0);
      // Default: share desc, then total desc as tiebreaker
      return b.share - a.share || b.total - a.total;
    }).slice(0, TOP_N);
    // Bar width baseline depends on mode.
    const maxAbsExcess = sortMode === 'excess'
      ? Math.max(1, ...sorted.map((d) => Math.abs(d.excess)))
      : 1;
    const maxMeanCites = sortMode === 'meanCites'
      ? Math.max(0.01, ...sorted.map((d) => d.meanCites || 0))
      : 1;
    return (
      <ol className="space-y-1.5">
        {sorted.map((d, i) => {
          const sharePct = (d.share * 100).toFixed(1) + '%';
          const excessStr = (d.excess >= 0 ? '+' : '') + Math.round(d.excess).toLocaleString();
          const meanStr = d.meanCites != null ? d.meanCites.toFixed(1) : '—';
          // Primary metric for bar width is whichever sort mode is active.
          let widthPct = d.share * 100;
          if (sortMode === 'excess') widthPct = (Math.abs(d.excess) / maxAbsExcess) * 100;
          if (sortMode === 'meanCites') widthPct = ((d.meanCites || 0) / maxMeanCites) * 100;
          const excessNegative = sortMode === 'excess' && d.excess < 0;
          return (
            <li key={d.key} className="grid items-center gap-2" style={{ gridTemplateColumns: '24px 1fr 96px' }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, textAlign: 'right' }}>{i + 1}</span>
              <div className="relative" style={{ height: 22, background: PALETTE.cream, borderRadius: 2 }}>
                <div
                  style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${widthPct}%`,
                    background: excessNegative ? PALETTE.burgundy : accent,
                    opacity: 0.22,
                    borderRadius: 2,
                  }}
                />
                <span
                  className="absolute inset-y-0 left-2 right-2 flex items-center"
                  style={{ fontFamily: FONT_BODY, fontSize: 12, color: PALETTE.ink, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                  title={d.label}
                >
                  {d.label}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                {/* Primary metric (large), secondary metric (small) */}
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: PALETTE.ink, fontWeight: 500 }}>
                  {sortMode === 'excess' ? excessStr : (sortMode === 'meanCites' ? meanStr : sharePct)}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted }}>
                  {sortMode === 'excess' && `${sharePct} · ${fmtFull(d.total)}`}
                  {sortMode === 'meanCites' && `${sharePct} · ${fmtFull(d.total)} works`}
                  {sortMode === 'share' && `${excessStr} · ${fmtFull(d.subset)} / ${fmtFull(d.total)}`}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <Card className="p-5 lg:col-span-12" collapsible>
      <SectionTitle
        icon={Sparkles}
        kicker="Citation insight"
        title={mode === 'cited' ? 'Where the cited work lives' : 'Where the uncited work lives'}
        hint={`${countryName(country)} · top ${TOP_N} per dimension`}
      />
      <p
        className="-mt-2 mb-4 max-w-3xl"
        style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.muted, lineHeight: 1.55 }}
      >
        {mode === 'cited'
          ? `A profile of the institutions, fields, subfields, publishers, and collaborator countries most strongly associated with ${countryName(country)}-affiliated works that have received at least one citation. Toggle between two ranking views: within-entity percentage (treats every group as equal regardless of size) or extra count vs expected (rewards groups that beat the country-wide rate at scale).`
          : `A profile of where uncited works concentrate. Bigger uncited counts in some entities reflect citation lag for very recent works; persistent uncited shares in older works often signal a structural issue worth investigating.`}
      </p>

      {/* Mode toggle: switches between the cited and uncited subset.
          Triggers a refetch since each mode loads its own subset. */}
      <div
        className="mb-2 flex flex-wrap items-center gap-2 rounded-sm px-3 py-2"
        style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}
      >
        <span
          style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
          className="uppercase"
        >
          Show
        </span>
        <button
          onClick={() => setMode('cited')}
          className="rounded-sm px-2.5 py-1"
          style={{
            border: `1px solid ${mode === 'cited' ? PALETTE.rust : PALETTE.rule}`,
            background: mode === 'cited' ? PALETTE.rust : 'transparent',
            color: mode === 'cited' ? PALETTE.cream : PALETTE.charcoal,
            fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
          }}
        >
          Cited publications
        </button>
        <button
          onClick={() => setMode('uncited')}
          className="rounded-sm px-2.5 py-1"
          style={{
            border: `1px solid ${mode === 'uncited' ? PALETTE.charcoal : PALETTE.rule}`,
            background: mode === 'uncited' ? PALETTE.charcoal : 'transparent',
            color: mode === 'uncited' ? PALETTE.cream : PALETTE.charcoal,
            fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
          }}
        >
          Uncited publications
        </button>
        <span
          style={{
            fontFamily: FONT_BODY, fontSize: 11, color: PALETTE.muted,
            marginLeft: 'auto', maxWidth: 480, lineHeight: 1.4,
          }}
        >
          Switching reloads the section to fetch the subset of works that match the chosen view.
        </span>
      </div>

      {/* Sort toggle: switches the metric used to rank each panel. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-sm px-3 py-2"
        style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}
      >
        <span
          style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
          className="uppercase"
        >
          Rank by
        </span>
        <button
          onClick={() => setSortMode('share')}
          className="rounded-sm px-2.5 py-1"
          style={{
            border: `1px solid ${sortMode === 'share' ? PALETTE.ink : PALETTE.rule}`,
            background: sortMode === 'share' ? PALETTE.ink : 'transparent',
            color: sortMode === 'share' ? PALETTE.cream : PALETTE.charcoal,
            fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
          }}
          title="Rank by what percentage of each entity's works are cited"
          >
            By percentage
          </button>
          <button
            onClick={() => setSortMode('excess')}
            className="rounded-sm px-2.5 py-1"
            style={{
              border: `1px solid ${sortMode === 'excess' ? PALETTE.ink : PALETTE.rule}`,
              background: sortMode === 'excess' ? PALETTE.ink : 'transparent',
              color: sortMode === 'excess' ? PALETTE.cream : PALETTE.charcoal,
              fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
            }}
            title="Rank by how many extra works are cited compared to what the country-wide rate would predict"
          >
            By extra count
          </button>
          {mode === 'cited' && (
            <button
              onClick={() => setSortMode('meanCites')}
              className="rounded-sm px-2.5 py-1"
              style={{
                border: `1px solid ${sortMode === 'meanCites' ? PALETTE.ink : PALETTE.rule}`,
                background: sortMode === 'meanCites' ? PALETTE.ink : 'transparent',
                color: sortMode === 'meanCites' ? PALETTE.cream : PALETTE.charcoal,
                fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
              }}
              title="Rank by average citations per work within each entity. Loads on demand (one extra call per top entity)."
            >
              By mean cites/work
            </button>
          )}
          <span
            style={{
              fontFamily: FONT_BODY, fontSize: 11, color: PALETTE.muted,
              marginLeft: 'auto', maxWidth: 600, lineHeight: 1.5,
            }}
          >
            {(() => {
              // Build a worked example using the current data so the explanation
              // is concrete rather than abstract. We use the country rate from the
              // active tab and a plausible round number for "entity size" so the
              // arithmetic reads naturally.
              const labels = {
                institutions: { singular: 'institution',          plural: 'institutions',           data: institutions },
                fields:       { singular: 'field',                plural: 'fields',                 data: fields },
                subfields:    { singular: 'subfield',             plural: 'subfields',              data: subfields },
                publishers:   { singular: 'publisher',            plural: 'publishers',             data: publishers },
                countries:    { singular: 'collaborator country', plural: 'collaborator countries', data: countries },
              };
              const meta = labels[dimensionTab] || labels.institutions;
              const tabSingular = meta.singular;
              const tabPlural = meta.plural;
              const verb = mode === 'cited' ? 'cited' : 'uncited';
              const ratePct = meta.data.globalRate ? Math.round(meta.data.globalRate * 100) : null;
              if (sortMode === 'share') {
                return (
                  <>
                    Ranks {tabPlural} by what percentage of their works are {verb}.
                    A {tabSingular} with 50 works where 45 are {verb} (90%) outranks a {tabSingular} with 5,000 works where 4,000 are {verb} (80%).
                    Size doesn't matter, only the rate.
                  </>
                );
              }
              if (sortMode === 'meanCites') {
                return (
                  <>
                    Ranks {tabPlural} by the average citations per work within each {tabSingular}.
                    A {tabSingular} where works average 12 citations each ranks above one where works average 4 citations,
                    even if the second has more total works. Combines volume and depth of impact.
                    {' '}<em>Loads on demand for the top 30 entities.</em>
                  </>
                );
              }
              // Excess mode: a one-sentence example using the actual country rate
              if (ratePct != null) {
                const example = 1000;
                const expected = Math.round(example * (ratePct / 100));
                return (
                  <>
                    The country-wide rate is {ratePct}% {verb}, so a {tabSingular} with {fmtFull(example)} works
                    would be expected to have about {fmtFull(expected)} {verb}.
                    If it actually has {fmtFull(expected + 150)}, its extra count is <strong style={{ color: PALETTE.forest }}>+150</strong>.
                    If only {fmtFull(expected - 150)}, its extra count is <strong style={{ color: PALETTE.burgundy }}>-150</strong>.
                  </>
                );
              }
              return (
                <>Ranks {tabPlural} by how many more (or fewer) {verb} works they have than the country-wide rate would predict given their size.</>
              );
            })()}
          </span>
        </div>
        {/* Dimension tabs: order matches the rest of the dashboard (Institutions first).
            "n = X" is the number of entities that pass the per-dimension minimum-works
            threshold; only these are eligible for ranking. Thresholds vary by dimension
            and are documented in the constants at the top of this component. */}
        <div className="mb-1 flex flex-wrap items-center gap-1">
          {[
            { key: 'institutions', label: 'Institutions',  data: institutions, min: MIN_WORKS_FOR_INSTITUTION },
            { key: 'fields',       label: 'Fields',        data: fields,       min: MIN_WORKS_FOR_FIELD },
            { key: 'subfields',    label: 'Subfields',     data: subfields,    min: MIN_WORKS_FOR_SUBFIELD },
            { key: 'publishers',   label: 'Publishers',    data: publishers,   min: MIN_WORKS_FOR_PUBLISHER },
            { key: 'countries',    label: 'Co-author countries', data: countries, min: MIN_WORKS_FOR_COUNTRY },
          ].map((tab) => {
            const isActive = dimensionTab === tab.key;
            const n = tab.data.rows?.length || 0;
            return (
              <button
                key={tab.key}
                onClick={() => setDimensionTab(tab.key)}
                className="rounded-sm px-2 py-0.5 transition-colors"
                style={{
                  border: `1px solid ${isActive ? PALETTE.ink : PALETTE.rule}`,
                  background: isActive ? PALETTE.ink : 'transparent',
                  color: isActive ? PALETTE.cream : PALETTE.charcoal,
                  fontFamily: FONT_MONO,
                  fontSize: 10.5,
                  letterSpacing: '0.03em',
                  whiteSpace: 'nowrap',
                }}
                title={`${tab.label} · ${n} eligible (each has at least ${tab.min} works)`}
              >
                {tab.label}
                <span style={{ marginLeft: 5, opacity: 0.7 }}>(n={n})</span>
              </button>
            );
          })}
        </div>
        <div
          className="mb-3"
          style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: '0.04em', color: PALETTE.muted }}
        >
          n = entities with enough works to qualify for ranking (thresholds vary by dimension; hover a pill for details)
        </div>

        {/* Active tab body: scatter on the left, ranked list on the right.
            On narrow screens they stack. */}
        {(() => {
          const tabConfig = {
            institutions: { data: institutions, min: MIN_WORKS_FOR_INSTITUTION, singular: 'institution',          plural: 'institutions',          filterKey: 'institutions' },
            fields:       { data: fields,       min: MIN_WORKS_FOR_FIELD,       singular: 'field',                plural: 'fields',                filterKey: 'fields' },
            subfields:    { data: subfields,    min: MIN_WORKS_FOR_SUBFIELD,    singular: 'subfield',             plural: 'subfields',             filterKey: 'subfields' },
            publishers:   { data: publishers,   min: MIN_WORKS_FOR_PUBLISHER,   singular: 'publisher',            plural: 'publishers',            filterKey: 'publishers' },
            countries:    { data: countries,    min: MIN_WORKS_FOR_COUNTRY,     singular: 'collaborator country', plural: 'collaborator countries',filterKey: 'collaborators' },
          }[dimensionTab];
          // Detect whether the active tab's dimension is also an active filter
          // chip. If so, the chart shows co-occurring entities on those papers
          // rather than just the filtered one, because OpenAlex's group_by
          // returns every entity that appears on any work in the filtered set.
          const filterChips = activeFilters[tabConfig.filterKey] || [];
          const dimensionIsFiltered = filterChips.length > 0;
          const filteredLabels = filterChips.map((c) => c.label || c.value).filter(Boolean);
          const chipDescription = filteredLabels.length === 0
            ? null
            : filteredLabels.length === 1
              ? filteredLabels[0]
              : filteredLabels.length === 2
                ? `${filteredLabels[0]} and ${filteredLabels[1]}`
                : `${filteredLabels[0]}, ${filteredLabels[1]}, and ${filteredLabels.length - 2} more`;
          return (
            <>
              {dimensionIsFiltered && (
                <div
                  className="mb-3 rounded-sm px-3 py-2"
                  style={{
                    background: PALETTE.cream,
                    border: `1px solid ${PALETTE.rule}`,
                    borderLeft: `3px solid ${PALETTE.gold}`,
                  }}
                >
                  <div
                    style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
                    className="uppercase mb-0.5"
                  >
                    Note · co-occurring on filtered works
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: PALETTE.charcoal, lineHeight: 1.45 }}>
                    You've filtered to {chipDescription ? <strong>{chipDescription}</strong> : `a ${tabConfig.singular}`}.
                    A single work can be linked to several {tabConfig.plural}, so the chart
                    shows every {tabConfig.singular} that co-occurs on these works (not just the one you filtered by).
                    Read this as a collaboration profile of the filtered subset rather than an exclusive view.
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
                <div className="md:col-span-3">
                  <div
                    style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.18em' }}
                    className="uppercase mb-2"
                  >
                    Distribution · each dot is one {tabConfig.singular}
                  </div>
                  <CitationReachScatter
                    rows={tabConfig.data.rows || []}
                    globalRate={tabConfig.data.globalRate || 0}
                    mode={mode}
                    minWorks={tabConfig.min}
                  status={tabConfig.data.status}
                  sortMode={sortMode}
                  topN={TOP_N}
                  meanCitesMap={meanCitesByDim[dimensionTab]?.status === 'ready' ? meanCitesByDim[dimensionTab].data : null}
                />
              </div>
              <div className="md:col-span-2">
                <div
                  style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.18em' }}
                  className="uppercase mb-2"
                >
                  Top {TOP_N} by {
                    sortMode === 'share'     ? `percentage ${mode === 'cited' ? 'cited' : 'uncited'}` :
                    sortMode === 'excess'    ? 'extra count vs expected' :
                    sortMode === 'meanCites' ? 'mean citations per work' :
                    'rank'
                  }
                </div>
                {renderList(tabConfig.data, tabConfig.min)}
              </div>
            </div>
            </>
          );
        })()}
      <div
        className="mt-3 border-t pt-2"
        style={{ borderColor: PALETTE.rule, fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.1em' }}
      >
        <span className="uppercase">
          Highlighted dots are the top {TOP_N} in the current ranking · Dashed line marks the country-wide rate
        </span>
      </div>
    </Card>
  );
};

// OpenAlex institution.type values (per https://docs.openalex.org/api-entities/institutions).
// We surface these as filter pills above the institutions chart, and the same colours
// are used for the y-axis labels in the producing-institutions chart so the visual
// association is direct. Education-typed pills use a neutral colour because the actual
// signal sits one level down in the MHESI subcategories (which have their own colours).
const INSTITUTION_TYPES = [
  { key: 'education',  label: 'Education',  color: '#1a1612' /* ink, see EDUCATION_SUBCATEGORIES for the per-bucket colours */ },
  { key: 'healthcare', label: 'Healthcare', color: '#7a2e3e' /* burgundy */ },
  { key: 'government', label: 'Government', color: '#3a342c' /* charcoal */ },
  { key: 'company',    label: 'Company',    color: '#b88a3e' /* gold */ },
  { key: 'nonprofit',  label: 'Nonprofit',  color: '#2c5f5d' /* teal */ },
  { key: 'facility',   label: 'Facility',   color: '#6b6155' /* muted */ },
  { key: 'archive',    label: 'Archive',    color: '#6b6155' /* muted */ },
  { key: 'funder',     label: 'Funder',     color: '#a04f1f' /* rust */ },
  { key: 'other',      label: 'Other',      color: '#6b6155' /* muted */ },
];

// MHESI 7-bucket classification of Thai higher education institutions.
// Source: Thailand_Higher_Education_Institutions.xlsx (May 2026), compiled
// from MHESI references and the Wikipedia categorized listing. 233 entries.
// Buckets: public, rajabhat, rajamangala, private, military_police,
// community, other_hei. The mapping is consulted only for institutions
// whose OpenAlex `country_code` is TH and `type` is `education`.
const EDUCATION_SUBCATEGORIES = [
  { key: 'public',          label: 'Public Universities',                    color: '#1f3a5f' },
  { key: 'rajabhat',        label: 'Rajabhat Universities',                  color: '#7a2e3e' },
  { key: 'rajamangala',     label: 'Rajamangala Universities of Technology', color: '#2c5f5d' },
  { key: 'private',         label: 'Private Universities',                   color: '#b88a3e' },
  { key: 'military_police', label: 'Military and Police',                    color: '#5d3a5a' },
  { key: 'community',       label: 'Community Colleges',                     color: '#4a6b3a' },
  { key: 'other_hei',       label: 'Other Higher Education',                 color: '#a04f1f' },
];

// Map normalized institution name → subcategory key.
const TH_HEI_SUBCATEGORY_MAP = new Map([
  // public: 41
  ['bunditpatanasilpa institute', 'public'],
  ['burapha university', 'public'],
  ['chiang mai university', 'public'],
  ['chitralada technology institute', 'public'],
  ['chulabhorn graduate institute', 'public'],
  ['chulalongkorn university', 'public'],
  ['hrh princess chulabhorn college of medical science', 'public'],
  ['kalasin university', 'public'],
  ['kasetsart university', 'public'],
  ['khon kaen university', 'public'],
  ['king mongkuts institute of technology ladkrabang', 'public'],
  ['king mongkuts university of technology north bangkok', 'public'],
  ['king mongkuts university of technology thonburi', 'public'],
  ['mae fah luang university', 'public'],
  ['maejo university', 'public'],
  ['mahachulalongkornrajavidyalaya university', 'public'],
  ['mahamakut buddhist university', 'public'],
  ['mahasarakham university', 'public'],
  ['mahidol university', 'public'],
  ['nakhon phanom university', 'public'],
  ['naresuan university', 'public'],
  ['national institute of development administration', 'public'],
  ['navamindradhiraj university', 'public'],
  ['pathumwan institute of technology', 'public'],
  ['praboromarajchanok institute', 'public'],
  ['prince of songkla university', 'public'],
  ['princess galyani vadhana institute of music', 'public'],
  ['princess of naradhiwas university', 'public'],
  ['ramkhamhaeng university', 'public'],
  ['silpakorn university', 'public'],
  ['srinakharinwirot university', 'public'],
  ['srisavarindhira thai red cross institute of nursing', 'public'],
  ['suan dusit university', 'public'],
  ['sukhothai thammathirat open university', 'public'],
  ['suranaree university of technology', 'public'],
  ['thailand national sports university', 'public'],
  ['thaksin university', 'public'],
  ['thammasat university', 'public'],
  ['ubon ratchathani university', 'public'],
  ['university of phayao', 'public'],
  ['walailak university', 'public'],
  // rajabhat: 38
  ['bansomdejchaopraya rajabhat university', 'rajabhat'],
  ['buri ram rajabhat university', 'rajabhat'],
  ['chaiyaphum rajabhat university', 'rajabhat'],
  ['chandrakasem rajabhat university', 'rajabhat'],
  ['chiang mai rajabhat university', 'rajabhat'],
  ['chiang rai rajabhat university', 'rajabhat'],
  ['dhonburi rajabhat university', 'rajabhat'],
  ['kamphaeng phet rajabhat university', 'rajabhat'],
  ['kanchanaburi rajabhat university', 'rajabhat'],
  ['lampang rajabhat university', 'rajabhat'],
  ['loei rajabhat university', 'rajabhat'],
  ['maha sarakham rajabhat university', 'rajabhat'],
  ['muban chom bung rajabhat university', 'rajabhat'],
  ['nakhon pathom rajabhat university', 'rajabhat'],
  ['nakhon ratchasima rajabhat university', 'rajabhat'],
  ['nakhon sawan rajabhat university', 'rajabhat'],
  ['nakhon si thammarat rajabhat university', 'rajabhat'],
  ['phetchabun rajabhat university', 'rajabhat'],
  ['phetchaburi rajabhat university', 'rajabhat'],
  ['phranakhon rajabhat university', 'rajabhat'],
  ['phranakhon si ayutthaya rajabhat university', 'rajabhat'],
  ['phuket rajabhat university', 'rajabhat'],
  ['pibulsongkram rajabhat university', 'rajabhat'],
  ['rajanagarindra rajabhat university', 'rajabhat'],
  ['rambhai barni rajabhat university', 'rajabhat'],
  ['roi et rajabhat university', 'rajabhat'],
  ['sakon nakhon rajabhat university', 'rajabhat'],
  ['sisaket rajabhat university', 'rajabhat'],
  ['songkhla rajabhat university', 'rajabhat'],
  ['suan sunandha rajabhat university', 'rajabhat'],
  ['suratthani rajabhat university', 'rajabhat'],
  ['surin rajabhat university', 'rajabhat'],
  ['thepsatri rajabhat university', 'rajabhat'],
  ['ubon ratchathani rajabhat university', 'rajabhat'],
  ['udon thani rajabhat university', 'rajabhat'],
  ['uttaradit rajabhat university', 'rajabhat'],
  ['valaya alongkorn rajabhat university', 'rajabhat'],
  ['yala rajabhat university', 'rajabhat'],
  // rajamangala: 9
  ['rajamangala university of technology isan', 'rajamangala'],
  ['rajamangala university of technology krungthep', 'rajamangala'],
  ['rajamangala university of technology lanna', 'rajamangala'],
  ['rajamangala university of technology phra nakhon', 'rajamangala'],
  ['rajamangala university of technology rattanakosin', 'rajamangala'],
  ['rajamangala university of technology srivijaya', 'rajamangala'],
  ['rajamangala university of technology suvarnabhumi', 'rajamangala'],
  ['rajamangala university of technology tawan ok', 'rajamangala'],
  ['rajamangala university of technology thanyaburi', 'rajamangala'],
  // private: 104
  ['arsom silp institute of the arts', 'private'],
  ['asia pacific international university', 'private'],
  ['assumption university', 'private'],
  ['bangkok arts and crafts college', 'private'],
  ['bangkok school of management', 'private'],
  ['bangkok suvarnabhumi university', 'private'],
  ['bangkok university', 'private'],
  ['bangkokthonburi university', 'private'],
  ['banglamung inter tech technological college', 'private'],
  ['banharn jamsai polytechnic college', 'private'],
  ['boonthavorn technology college', 'private'],
  ['bundit boriharnthurakit college', 'private'],
  ['cambridge college thailand', 'private'],
  ['chalermkarnchana university', 'private'],
  ['chaopraya university', 'private'],
  ['chiangrai college', 'private'],
  ['chonburi vocational college', 'private'],
  ['christian university', 'private'],
  ['college institute', 'private'],
  ['college of asian scholars', 'private'],
  ['dhurakij pundit university', 'private'],
  ['don bosco technological college', 'private'],
  ['dusit thani college', 'private'],
  ['e sarn university', 'private'],
  ['eastern asia university', 'private'],
  ['eastern university of management and technology', 'private'],
  ['ekawan vocational college', 'private'],
  ['far eastern university', 'private'],
  ['fatoni university', 'private'],
  ['galileo maritime academy', 'private'],
  ['hatyai university', 'private'],
  ['huachiew chalermprakiet university', 'private'],
  ['institute college', 'private'],
  ['institute of technology ayothaya', 'private'],
  ['international buddhist college', 'private'],
  ['international hotel and tourism industry management school', 'private'],
  ['jathupat suksasongkhro technological college', 'private'],
  ['kantana institute', 'private'],
  ['kantaralak technical college', 'private'],
  ['kasem bundit university', 'private'],
  ['khukhan industrial and community education college', 'private'],
  ['krirk university', 'private'],
  ['lampang inter tech college', 'private'],
  ['learning institute for everyone', 'private'],
  ['loengnoktha industrial and community education college', 'private'],
  ['lumnamping college', 'private'],
  ['mahanakorn university of technology', 'private'],
  ['nakhonratchasima college', 'private'],
  ['nakhonratchasima polytechnic college', 'private'],
  ['namphong technical college', 'private'],
  ['nation university', 'private'],
  ['nonthaburi technical college', 'private'],
  ['north bangkok university', 'private'],
  ['north chiang mai university', 'private'],
  ['north eastern university', 'private'],
  ['panyapiwat institute of management', 'private'],
  ['pathumthani technical college', 'private'],
  ['pathumthani university', 'private'],
  ['payap university', 'private'],
  ['phanomwan college', 'private'],
  ['phatthalung technical college', 'private'],
  ['phayakkhaphum phisai industrial and community education college', 'private'],
  ['phetchaburi polytechnic college', 'private'],
  ['phitsanulok university', 'private'],
  ['raffles international college', 'private'],
  ['raffles international college bangkok', 'private'],
  ['rajapark institute', 'private'],
  ['rakthai namyuen business administration technological college', 'private'],
  ['rangsit university', 'private'],
  ['ranong technical college', 'private'],
  ['ratchathani university', 'private'],
  ['rattana bundit university', 'private'],
  ['sae institute bangkok', 'private'],
  ['saengtham college', 'private'],
  ['saint johns university', 'private'],
  ['saint louis college', 'private'],
  ['samutprakan technical college', 'private'],
  ['santapol college', 'private'],
  ['shinawatra university', 'private'],
  ['siam technology college', 'private'],
  ['siam thanyaburi child and elderly care school', 'private'],
  ['siam university', 'private'],
  ['singburi vocational college', 'private'],
  ['songphinong industrial and community education college', 'private'],
  ['south east asia university', 'private'],
  ['southeast bangkok college', 'private'],
  ['southern college of technology', 'private'],
  ['sripatum university', 'private'],
  ['sriworakarn technology college', 'private'],
  ['st theresa international college', 'private'],
  ['stamford international university', 'private'],
  ['suphanburi technical college', 'private'],
  ['tapee university', 'private'],
  ['thai nichi institute of technology', 'private'],
  ['thonburi university', 'private'],
  ['thongsook college', 'private'],
  ['udonthani vocational college', 'private'],
  ['unicentre college thailand', 'private'],
  ['university of central thailand', 'private'],
  ['university of the thai chamber of commerce', 'private'],
  ['vidyasirimedhi institute of science and technology', 'private'],
  ['vongchavalitkul university', 'private'],
  ['webster university thailand', 'private'],
  ['western university', 'private'],
  // military_police: 11
  ['chulachomklao royal military academy', 'military_police'],
  ['command and general staff college', 'military_police'],
  ['judge advocate general school thailand', 'military_police'],
  ['national defence college', 'military_police'],
  ['navaminda kasatriyadhiraj royal thai air force academy', 'military_police'],
  ['phramongkutklao college of medicine', 'military_police'],
  ['police nursing college', 'military_police'],
  ['royal police cadet academy', 'military_police'],
  ['royal thai air force nursing college', 'military_police'],
  ['royal thai navy academy', 'military_police'],
  ['royal thai navy college of nursing', 'military_police'],
  // community: 22
  ['buriram community college', 'community'],
  ['community college', 'community'],
  ['mae hong son community college', 'community'],
  ['mukdahan community college', 'community'],
  ['nan community college', 'community'],
  ['narathiwat community college', 'community'],
  ['nong bua lamphu community college', 'community'],
  ['pattani community college', 'community'],
  ['phang nga community college', 'community'],
  ['phichit community college', 'community'],
  ['phrae community college', 'community'],
  ['ranong community college', 'community'],
  ['sa kaeo community college', 'community'],
  ['samut sakhon community college', 'community'],
  ['satun community college', 'community'],
  ['songkhla community college', 'community'],
  ['sukhothai community college', 'community'],
  ['tak community college', 'community'],
  ['trat community college', 'community'],
  ['uthai thani community college', 'community'],
  ['yala community college', 'community'],
  ['yasothon community college', 'community'],
  // other_hei: 8
  ['amata university', 'other_hei'],
  ['asian institute of hospitality management', 'other_hei'],
  ['asian institute of technology', 'other_hei'],
  ['civil aviation training center', 'other_hei'],
  ['cmkl university', 'other_hei'],
  ['irrigation college', 'other_hei'],
  ['merchant marine training center', 'other_hei'],
  ['supervisory unit', 'other_hei'],
  // Overrides: OpenAlex display names that differ from the canonical xlsx names
  // (typos, alternate romanizations, missing diacritics, word-order differences).
  ['rajamangala university of technology', 'rajamangala'],     // generic name used by OpenAlex for the system
  ['rajabhat maha sarakhamuniversity', 'rajabhat'],            // OpenAlex name has missing space
  ['buriram rajabhat university', 'rajabhat'],                 // canonical: 'buri ram'
  ['rajabhat rajanagarindra university', 'rajabhat'],          // canonical word order: 'rajanagarindra rajabhat'
  ['muban chombueng rajabhat university', 'rajabhat'],         // canonical romanization: 'chom bung'
  ['surindra rajabhat university', 'rajabhat'],                // canonical: 'surin'
  ['asian university', 'private'],                             // private
  ['southeast asia university', 'private'],                    // canonical: 'south east asia'
]);

// Normalize institution name for matching: lowercase, strip punctuation, collapse whitespace.
// Mirrors the Python normalizer used to build TH_HEI_SUBCATEGORY_MAP.
const normalizeInstitutionName = (name) => {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/['\u2019]/g, '')                  // apostrophes
    .replace(/[^a-z0-9\u0e00-\u0e7f\s]/g, ' ')  // strip punctuation, keep Thai
    .replace(/\s+/g, ' ')
    .trim();
};

// Look up the MHESI subcategory for a Thai institution by name. Falls back to
// 'other_hei' when the name isn't in the canonical mapping. The OpenAlex display
// name often varies slightly from the official name (typos, alternate romanizations,
// word-order differences), so unrecognised names get treated as Other Higher
// Education by default. To pin a specific institution to a known bucket, add the
// normalized OpenAlex name to TH_HEI_SUBCATEGORY_MAP above.
const subcategoryFor = (name) => {
  const normalized = normalizeInstitutionName(name);
  return TH_HEI_SUBCATEGORY_MAP.get(normalized) || 'other_hei';
};

// Order is deliberately not alphabetical; we list ASEAN+major research nations first
// for quick access at the top of the dropdown, then alphabetise the rest.
const FEATURED_COUNTRIES = [
  // ASEAN
  'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'LA', 'KH', 'MM', 'BN',
  // East Asia
  'CN', 'JP', 'KR', 'TW', 'HK',
  // South Asia
  'IN', 'PK', 'BD', 'LK', 'NP',
  // Anglophone
  'US', 'GB', 'AU', 'CA', 'NZ', 'IE',
  // Europe
  'DE', 'FR', 'NL', 'CH', 'IT', 'ES', 'SE', 'BE', 'AT', 'DK', 'FI', 'NO', 'PT',
  'PL', 'CZ', 'GR', 'IE',
  // Other
  'BR', 'MX', 'AR', 'CL', 'IL', 'TR', 'AE', 'SA', 'EG', 'ZA', 'RU',
];
const ALL_ISO_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU',
  'WF','WS',
  'YE','YT',
  'ZA','ZM','ZW',
];

const buildCountryList = () => {
  const seen = new Set();
  const featured = [];
  for (const c of FEATURED_COUNTRIES) {
    if (seen.has(c)) continue;
    seen.add(c);
    featured.push({ code: c, name: countryName(c), featured: true });
  }
  const rest = [];
  for (const c of ALL_ISO_CODES) {
    if (seen.has(c)) continue;
    rest.push({ code: c, name: countryName(c), featured: false });
  }
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [...featured, ...rest];
};

// Country selector: a small button that shows the current country, opens a popover
// with a search box and a scrollable list when clicked. ASEAN and major research
// nations are surfaced first for quick switching.
const CountrySelector = ({ country, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const allCountries = useMemo(buildCountryList, []);
  const popRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Close on outside click and Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Focus the search box when the popover opens
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? allCountries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
    : allCountries;
  const featured = filtered.filter((c) => c.featured);
  const rest = filtered.filter((c) => !c.featured);

  const pick = (code) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-sm px-3 py-1.5 transition-colors"
        style={{
          border: `1px solid ${PALETTE.ink}`,
          background: PALETTE.ink,
          color: PALETTE.cream,
          fontFamily: FONT_MONO,
          fontSize: 12,
          letterSpacing: '0.04em',
        }}
        title="Switch country"
      >
        <Globe2 size={13} />
        <span style={{ fontWeight: 500 }}>{country}</span>
        <span style={{ opacity: 0.7, fontFamily: FONT_BODY, letterSpacing: 0 }}>{countryName(country)}</span>
        <ChevronDown size={13} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute right-0 z-40 mt-1 w-[320px] rounded-md"
          style={{
            background: PALETTE.paper,
            border: `1px solid ${PALETTE.ink}`,
            boxShadow: '0 8px 20px rgba(26,22,18,0.12)',
          }}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: PALETTE.rule, background: PALETTE.cream }}>
            <Search size={13} style={{ color: PALETTE.muted }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country…"
              className="w-full bg-transparent outline-none"
              style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.ink }}
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto py-1" role="listbox">
            {featured.length > 0 && (
              <>
                <div
                  className="px-3 py-1.5"
                  style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
                >
                  ASEAN & MAJOR RESEARCH NATIONS
                </div>
                {featured.map((c) => (
                  <CountryRow key={c.code} c={c} active={c.code === country} onClick={() => pick(c.code)} />
                ))}
              </>
            )}
            {rest.length > 0 && (
              <>
                <div
                  className="px-3 py-1.5 mt-1"
                  style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted, borderTop: `1px solid ${PALETTE.rule}` }}
                >
                  ALL COUNTRIES
                </div>
                {rest.map((c) => (
                  <CountryRow key={c.code} c={c} active={c.code === country} onClick={() => pick(c.code)} />
                ))}
              </>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center" style={{ color: PALETTE.muted, fontSize: 13 }}>
                No country matches.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CountryRow = ({ c, active, onClick }) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors"
    style={{
      background: active ? PALETTE.cream : 'transparent',
      borderLeft: active ? `3px solid ${PALETTE.burgundy}` : '3px solid transparent',
      fontFamily: FONT_BODY,
      fontSize: 13,
      color: PALETTE.ink,
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(122,46,62,0.04)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
  >
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: PALETTE.muted,
        width: 28,
        letterSpacing: '0.04em',
      }}
    >
      {c.code}
    </span>
    <span className="flex-1">{c.name}</span>
    {active && (
      <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: PALETTE.burgundy, letterSpacing: '0.1em' }} className="uppercase">
        Active
      </span>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// APC (Article Processing Charge) spend panel.
//
// Reads the precomputed apc_by_publisher.json (produced offline by
// apc-pipeline/precompute_apc.mjs) and shows estimated national open-access
// fees by publisher for the years currently selected in the masthead. The
// figure is a LIST-PRICE CEILING attributed to Thai corresponding authors, not
// actual spend. See the methods note in the panel and apc-pipeline/README.md.
//
// This panel is intentionally decoupled from the live OpenAlex panels: summing
// APC requires per-work iteration that OpenAlex's group_by cannot do, so the
// heavy lifting happens in the offline pipeline and this panel just renders the
// result, refiltered by the selected years.
const fmtUSD = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const fmtTHB = (n) => '฿' + Math.round(n || 0).toLocaleString('en-US');

// Collapsible dashboard section. Wraps a group of panels under a clickable
// header that expands/collapses the group. Each section manages its own state.
const CollapsibleSection = ({ title, subtitle, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-4 flex w-full items-center gap-3 border-b pb-2 text-left"
        style={{ borderColor: PALETTE.ink, background: 'transparent', cursor: 'pointer' }}
      >
        <ChevronDown
          size={18}
          style={{ flex: 'none', color: PALETTE.ink, transition: 'transform 0.2s ease', transform: open ? 'none' : 'rotate(-90deg)' }}
        />
        <span style={{ fontFamily: FONT_DISPLAY, fontStyle: 'italic', fontSize: 24, fontWeight: 500, color: PALETTE.ink, lineHeight: 1.1 }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.12em' }} className="uppercase">
            {subtitle}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.1em' }} className="uppercase">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && children}
    </section>
  );
};

// Rank-over-time bump chart: each line is one entity's rank across the year
// window. Used by the Publishing channels panel's "Rank over time" tab.
const RankBumpChart = ({ rows, years, topN = 15, status, accentColor }) => {
  const W = 720;
  const H = 360;
  const PAD = { top: 28, right: 220, bottom: 36, left: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const [hover, setHover] = React.useState(null);

  if (status === 'loading') {
    return (
      <div className="flex h-[360px] items-center justify-center" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="ml-2">Computing rank trajectories…</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex h-[360px] items-center justify-center" style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY, fontSize: 13 }}>
        Could not load rank data.
      </div>
    );
  }
  if (!rows || rows.length === 0 || !years || years.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center" style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }}>
        Not enough data to build a rank chart.
      </div>
    );
  }

  const xFor = (year) => {
    if (years.length === 1) return PAD.left + plotW / 2;
    const idx = years.indexOf(year);
    return PAD.left + (idx / (years.length - 1)) * plotW;
  };
  const yFor = (rank) => PAD.top + ((rank - 1) / Math.max(1, topN - 1)) * plotH;

  const lastYear = years[years.length - 1];
  const sortedByLast = [...rows].sort((a, b) => {
    const ra = a.ranks[lastYear] ?? Infinity;
    const rb = b.ranks[lastYear] ?? Infinity;
    return ra - rb;
  });
  const colorRamp = [
    '#a04f1f', '#b56423', '#c87c30', '#cb8d4a', '#c69a64',
    '#a89878', '#888a82', '#6e8488', '#577e8e', '#477694',
    '#3a6f93', '#2f6890', '#2c5f7d', '#2b5469', '#2c4a55',
  ];
  const colorFor = (key) => {
    const idx = sortedByLast.findIndex((r) => r.key === key);
    if (idx < 0) return PALETTE.muted;
    return colorRamp[Math.min(idx, colorRamp.length - 1)];
  };

  return (
    <div className="relative" style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[1, 5, 10, 15].filter((r) => r <= topN).map((r) => (
          <g key={`y-${r}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yFor(r)} y2={yFor(r)} stroke={PALETTE.rule} strokeDasharray="2 4" />
            <text x={PAD.left - 6} y={yFor(r) + 3} textAnchor="end" style={{ fontFamily: FONT_MONO, fontSize: 9, fill: PALETTE.muted }}>#{r}</text>
          </g>
        ))}
        {years.map((y) => (
          <g key={`x-${y}`}>
            <text x={xFor(y)} y={PAD.top - 10} textAnchor="middle" style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.04em', fill: PALETTE.charcoal, fontWeight: 500 }}>{y}</text>
            <line x1={xFor(y)} x2={xFor(y)} y1={PAD.top} y2={H - PAD.bottom} stroke={PALETTE.rule} strokeDasharray="1 5" opacity="0.4" />
          </g>
        ))}
        <text x={14} y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90, 14, ${PAD.top + plotH / 2})`} style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.12em', fill: PALETTE.charcoal }}>RANK</text>
        {sortedByLast.map((row) => {
          const segments = [];
          for (let i = 0; i < years.length - 1; i++) {
            const y1 = years[i];
            const y2 = years[i + 1];
            const r1 = row.ranks[y1];
            const r2 = row.ranks[y2];
            if (r1 == null || r2 == null) {
              const fakeR1 = r1 ?? topN + 1;
              const fakeR2 = r2 ?? topN + 1;
              segments.push({ x1: xFor(y1), y1: yFor(fakeR1), x2: xFor(y2), y2: yFor(fakeR2), faded: true });
            } else {
              segments.push({ x1: xFor(y1), y1: yFor(r1), x2: xFor(y2), y2: yFor(r2), faded: false });
            }
          }
          const color = colorFor(row.key);
          const isHovered = hover && hover.key === row.key;
          return (
            <g key={row.key} onMouseEnter={() => setHover(row)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              {segments.map((s, i) => (
                <line key={`hit-${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth="14" />
              ))}
              {segments.map((s, i) => (
                <line key={`line-${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={isHovered ? 3 : 2} strokeOpacity={s.faded ? 0.25 : (hover && !isHovered ? 0.25 : 0.85)} strokeLinecap="round" />
              ))}
              {years.map((y) => {
                const r = row.ranks[y];
                if (r == null) return null;
                return (
                  <circle key={`pt-${y}`} cx={xFor(y)} cy={yFor(r)} r={isHovered ? 4.5 : 3} fill={color} stroke={PALETTE.paper} strokeWidth="1.2" fillOpacity={hover && !isHovered ? 0.35 : 1} />
                );
              })}
              {(() => {
                let labelYear = null;
                for (let i = years.length - 1; i >= 0; i--) {
                  if (row.ranks[years[i]] != null) { labelYear = years[i]; break; }
                }
                if (labelYear == null) return null;
                const r = row.ranks[labelYear];
                return (
                  <text x={W - PAD.right + 10} y={yFor(r) + 3} style={{ fontFamily: FONT_BODY, fontSize: isHovered ? 12 : 11, fill: hover && !isHovered ? PALETTE.muted : PALETTE.ink, fontWeight: isHovered ? 600 : 400 }}>
                    {row.label.length > 28 ? row.label.slice(0, 27) + '…' : row.label}
                  </text>
                );
              })()}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute rounded-sm px-3 py-2" style={{ background: PALETTE.ink, color: PALETTE.cream, fontFamily: FONT_BODY, fontSize: 11.5, lineHeight: 1.45, border: `1px solid ${PALETTE.ink}`, boxShadow: '0 4px 12px rgba(0,0,0,0.18)', top: 8, right: 8, maxWidth: 300 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hover.label}</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, opacity: 0.9 }}>
            {years.map((y) => {
              const r = hover.ranks[y];
              const c = hover.counts[y];
              return (
                <div key={y}>
                  {y}: {r != null ? `#${r}` : '—'}
                  {c != null && <span style={{ opacity: 0.7 }}> ({fmtFull(c)} works)</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// FX + client-side pricing helpers (mirror apc-pipeline/precompute_apc.mjs).
const APC_GBP_USD = (apcData.currency && apcData.currency.gbp_usd) || 1.27;
const APC_EUR_USD = (apcData.currency && apcData.currency.eur_usd) || 1.08;
const APC_AVG_THB = 34.0;
const APC_MAX_LIVE = 6000; // cap on works priced live per selection
const apcStripIssn = (s) => (typeof s === 'string' ? s.toUpperCase().replace(/[^0-9X]/g, '') : '');
const APC_STOP = /\b(the|a|an|of|and|for|in|on)\b/g;
const apcNormTitle = (t) => {
  if (!t) return null;
  let s = String(t).toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(APC_STOP, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
};
const apcArrUsd = (a) => {
  if (!a) return null;
  if (a[0] != null) return a[0];
  if (a[2] != null) return Math.round(a[2] * APC_GBP_USD);
  if (a[1] != null) return Math.round(a[1] * APC_EUR_USD);
  return null;
};
const apcObjUsd = (o) => {
  if (!o) return null;
  if (o.usd != null) return o.usd;
  if (o.gbp != null) return Math.round(o.gbp * APC_GBP_USD);
  if (o.eur != null) return Math.round(o.eur * APC_EUR_USD);
  return null;
};
const apcDefaultsRe = (publisherDefaults || []).map((d) => ({ ...d, re: new RegExp(d.match, 'i') }));
const apcPriceWork = (w) => {
  const src = (w.primary_location && w.primary_location.source) || {};
  const oa = (w.open_access && w.open_access.oa_status) || null;
  const issns = [];
  if (src.issn_l) issns.push(apcStripIssn(src.issn_l));
  for (const i of (src.issn || [])) issns.push(apcStripIssn(i));
  for (const n of issns) { const u = apcArrUsd(apcPricing.issn[n]); if (u != null) return u; }
  const tn = apcNormTitle(src.display_name);
  if (tn) { const u = apcArrUsd(apcPricing.title[tn]); if (u != null) return u; }
  const host = src.host_organization_name || '';
  for (const d of apcDefaultsRe) {
    if (d.re.test(host)) {
      const u = apcObjUsd(oa === 'gold' ? d.gold : oa === 'hybrid' ? d.hybrid : null);
      if (u != null) return u;
    }
  }
  if (w.apc_list && w.apc_list.value_usd != null) return w.apc_list.value_usd;
  if (w.apc_paid && w.apc_paid.value_usd != null) return w.apc_paid.value_usd;
  return null;
};
const apcThaiCorr = (authorships) => {
  const isTH = (a) => (a.countries || []).includes('TH') || (a.institutions || []).some((i) => i.country_code === 'TH');
  const corr = (authorships || []).filter((a) => a.is_corresponding);
  if (corr.length) return corr.some(isTH);
  const first = (authorships || []).find((a) => a.author_position === 'first') || (authorships || [])[0];
  return first ? isTH(first) : false;
};

// Gold-vs-hybrid proportion bar.
const OaSplit = ({ gold, hybrid }) => {
  const tot = (gold || 0) + (hybrid || 0);
  if (tot <= 0) return null;
  const gp = (gold / tot) * 100, hp = (hybrid / tot) * 100;
  return (
    <div className="mb-5">
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em', color: PALETTE.muted }} className="uppercase mb-2">
        Gold vs hybrid open access
      </div>
      <div className="flex w-full overflow-hidden" style={{ height: 26, borderRadius: 3, border: `1px solid ${PALETTE.rule}` }}>
        <div style={{ width: `${gp}%`, background: OA_COLORS.gold, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PALETTE.ink, fontFamily: FONT_MONO, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden' }}
             title={`Gold: ${fmtUSD(gold)} (${gp.toFixed(1)}%)`}>
          {gp > 12 ? `Gold ${gp.toFixed(0)}%` : ''}
        </div>
        <div style={{ width: `${hp}%`, background: OA_COLORS.hybrid, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PALETTE.paper, fontFamily: FONT_MONO, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden' }}
             title={`Hybrid: ${fmtUSD(hybrid)} (${hp.toFixed(1)}%)`}>
          {hp > 12 ? `Hybrid ${hp.toFixed(0)}%` : ''}
        </div>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted }} className="mt-1">
        Gold {fmtUSD(gold)} · Hybrid {fmtUSD(hybrid)}
      </div>
    </div>
  );
};

const ApcPanel = ({ years, country, filters, instFilterIds }) => {
  const apcReady = apcData && apcData.status !== 'placeholder' && (apcData.by_publisher || []).length > 0;
  const hasChips = Object.values(filters || {}).some((arr) => (arr || []).length > 0);
  const hasInst = Array.isArray(instFilterIds) && instFilterIds.length > 0;
  const filterActive = hasChips || hasInst;
  const instTooMany = hasInst && instFilterIds.length > 90;

  const usedYears = ((years || []).filter((y) => (apcData.years || []).includes(y)));
  const yearsForNat = usedYears.length ? usedYears : (apcData.years || []);

  // National precomputed view, summed over the selected years.
  const national = useMemo(() => {
    if (!apcReady) return null;
    let tUsd = 0, tThb = 0, tWorks = 0, tPriced = 0, gold = 0, hybrid = 0;
    const rows = (apcData.by_publisher || []).map((p) => {
      let usd = 0, thb = 0, works = 0, priced = 0, g = 0, h = 0;
      for (const y of yearsForNat) {
        const cell = (p.by_year || {})[y] || (p.by_year || {})[String(y)];
        if (cell) { usd += cell.usd || 0; thb += cell.thb || 0; works += cell.works || 0; priced += cell.priced || 0; g += cell.gold || 0; h += cell.hybrid || 0; }
      }
      tUsd += usd; tThb += thb; tWorks += works; tPriced += priced;
      return { key: p.publisher, label: cleanLabel(p.publisher, 34), usd, works, priced, gold: g, hybrid: h, basis: p.basis };
    }).filter((r) => r.usd > 0).sort((a, b) => b.usd - a.usd);
    const oa = (apcData.by_oa_status && apcData.by_oa_status.by_year) || {};
    for (const y of yearsForNat) { const c = oa[y] || oa[String(y)]; if (c) { gold += c.gold || 0; hybrid += c.hybrid || 0; } }
    return { rows, totalUsd: tUsd, totalThb: tThb, totalWorks: tWorks, totalPriced: tPriced, gold, hybrid };
  }, [apcReady, JSON.stringify(yearsForNat)]);

  // Live view, computed from OpenAlex for the exact current selection.
  const [live, setLive] = useState({ status: 'idle' });
  useEffect(() => {
    // APC estimation is calibrated for Thailand only, so never run live pricing
    // for another country (it would mis-attribute via the Thai-author check).
    if (country !== 'TH') { setLive({ status: 'idle' }); return; }
    if (!filterActive) { setLive({ status: 'idle' }); return; }
    if (instTooMany) { setLive({ status: 'toolarge', reason: 'inst' }); return; }
    let cancelled = false;
    (async () => {
      try {
        setLive({ status: 'loading' });
        let filter = buildFilterString(country, years, filters) + ',open_access.oa_status:gold|hybrid';
        if (hasInst) filter += ',authorships.institutions.id:' + instFilterIds.join('|');
        const cj = await fetchJson(withMailto(`${OPENALEX_BASE}/works?filter=${filter}&per-page=1`));
        const count = (cj.meta && cj.meta.count) || 0;
        if (cancelled) return;
        if (count > APC_MAX_LIVE) { setLive({ status: 'toolarge', reason: 'count', count }); return; }
        const SEL = 'id,open_access,primary_location,authorships,apc_list,apc_paid';
        const agg = {};
        let usd = 0, works = 0, priced = 0, gold = 0, hybrid = 0;
        // Fetch all pages in parallel. The selection is under the cap (< 10000),
        // so OpenAlex numbered paging is valid and the pages don't need to run
        // sequentially the way cursor paging does. The shared rate limiter still
        // paces the sends, but no request waits on the previous one's response.
        const pages = Math.min(50, Math.max(1, Math.ceil(count / 200)));
        const pageResults = await Promise.all(
          Array.from({ length: pages }, (_, i) =>
            fetchJson(withMailto(`${OPENALEX_BASE}/works?filter=${filter}&select=${SEL}&per-page=200&page=${i + 1}`))
              .then((j) => j.results || [])
              .catch(() => []))
        );
        if (cancelled) return;
        for (const res of pageResults) {
          for (const w of res) {
            if (!apcThaiCorr(w.authorships)) continue;
            works++;
            const oa = (w.open_access && w.open_access.oa_status) || null;
            const src = (w.primary_location && w.primary_location.source) || {};
            const pub = src.host_organization_name || 'Unknown / no publisher';
            const p = apcPriceWork(w);
            if (!agg[pub]) agg[pub] = { usd: 0, works: 0, priced: 0, gold: 0, hybrid: 0 };
            agg[pub].works++;
            if (p != null) {
              priced++; usd += p; agg[pub].usd += p; agg[pub].priced++;
              if (oa === 'gold') { gold += p; agg[pub].gold += p; } else if (oa === 'hybrid') { hybrid += p; agg[pub].hybrid += p; }
            }
          }
        }
        if (cancelled) return;
        const rows = Object.entries(agg).map(([key, v]) => ({ key, label: cleanLabel(key, 34), usd: v.usd, works: v.works, priced: v.priced, gold: v.gold, hybrid: v.hybrid }))
          .filter((r) => r.usd > 0).sort((a, b) => b.usd - a.usd);
        setLive({ status: 'ready', totalUsd: usd, totalThb: usd * APC_AVG_THB, totalWorks: works, totalPriced: priced, gold, hybrid, rows });
      } catch (e) {
        if (!cancelled) setLive({ status: 'error', error: (e && e.message) || 'Live pricing failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [country, JSON.stringify(years), JSON.stringify(filters), JSON.stringify(instFilterIds || null)]);

  const header = (hint) => (
    <SectionTitle icon={Banknote} kicker="Open access fees" title="Estimated APC spend by publisher" hint={hint} />
  );
  const wrap = (children) => <Card className="p-5 lg:col-span-12" collapsible>{children}</Card>;

  // Thailand only. The precomputed national totals are Thai, the
  // corresponding-author attribution hardcodes TH, and the price reference
  // reflects what Thai authors pay (Thailand is upper-middle-income, so no
  // automatic LMIC waivers). For any other country we cannot produce a valid
  // estimate, so we say so plainly rather than show Thailand's numbers or
  // mis-attributed live pricing.
  if (country !== 'TH') {
    return wrap(<>
      {header('Thailand only')}
      <div className="rounded-sm px-4 py-6" style={{ background: PALETTE.cream, border: `1px dashed ${PALETTE.rule}`, fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal, lineHeight: 1.6 }}>
        <p style={{ marginBottom: 8 }}>APC spend estimation is available for Thailand only. The price reference and corresponding-author attribution were calibrated for {countryName('TH')}, so these figures would not be valid for {countryName(country)}.</p>
        <p style={{ fontFamily: FONT_MONO, fontSize: 12, color: PALETTE.muted }}>Switch the country selector back to Thailand to see estimated open access fees.</p>
      </div>
    </>);
  }

  // Placeholder: no precompute and no active filter.
  if (!apcReady && !filterActive) {
    return wrap(<>
      {header('Awaiting precompute')}
      <div className="rounded-sm px-4 py-6" style={{ background: PALETTE.cream, border: `1px dashed ${PALETTE.rule}`, fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal, lineHeight: 1.6 }}>
        <p style={{ marginBottom: 8 }}>This panel shows estimated article processing charges paid to each publisher. The national data has not been computed yet.</p>
        <p style={{ fontFamily: FONT_MONO, fontSize: 12, color: PALETTE.ink }}>Run <strong>node apc-pipeline/precompute_apc.mjs</strong> with an OpenAlex API key, then reload. Filtering re-prices live.</p>
      </div>
    </>);
  }

  // Live status screens.
  if (filterActive && live.status === 'loading') {
    return wrap(<>{header('Live · pricing current selection…')}<div className="px-2 py-6"><SkeletonBars rows={6} /></div></>);
  }
  if (filterActive && live.status === 'toolarge') {
    const msg = live.reason === 'inst'
      ? `This institution-type selection spans too many institutions (${(instFilterIds || []).length}) to price live. Pick a narrower subtype or also select a discipline.`
      : `This selection covers ${(live.count || 0).toLocaleString()} works, above the ${APC_MAX_LIVE.toLocaleString()} live-pricing cap. Narrow the filter (a specific institution, subfield, or fewer years) to price it live.`;
    return wrap(<>{header('Selection too large for live pricing')}
      <div className="rounded-sm px-4 py-6" style={{ background: PALETTE.cream, border: `1px dashed ${PALETTE.rule}`, fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal }}>{msg}</div>
    </>);
  }
  if (filterActive && live.status === 'error') {
    return wrap(<>{header('Live pricing unavailable')}
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center" style={{ color: PALETTE.burgundy, fontFamily: FONT_BODY }}>
        <AlertCircle size={20} className="mb-2" />
        <div style={{ fontSize: 13 }}>Could not price this selection live.</div>
        <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 4 }}>{live.error}</div>
      </div>
    </>);
  }

  const v = filterActive ? (live.status === 'ready' ? live : null) : national;
  if (!v) return wrap(<>{header('Open access fees')}<div className="px-2 py-6"><SkeletonBars rows={6} /></div></>);

  const matchRate = v.totalWorks ? (v.totalPriced / v.totalWorks) : 0;
  const yearLabel = yearsForNat.length === (apcData.years || []).length
    ? `${Math.min(...yearsForNat)}–${Math.max(...yearsForNat)}` : yearsForNat.join(', ');
  const hint = filterActive
    ? `Live · current selection · ${yearLabel}`
    : `National · precomputed · ${yearLabel}`;
  const maxUsd = v.rows.length ? v.rows[0].usd : 1;
  const TOP = 20;
  const shown = v.rows.slice(0, TOP);

  return wrap(<>
    {header(hint)}
    <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-sm p-4" style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em', color: PALETTE.muted }} className="uppercase">Estimated APC (USD)</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, color: PALETTE.ink, lineHeight: 1.1 }} className="mt-2">{fmtUSD(v.totalUsd)}</div>
      </div>
      <div className="rounded-sm p-4" style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em', color: PALETTE.muted }} className="uppercase">Estimated APC (THB)</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, color: PALETTE.burgundy, lineHeight: 1.1 }} className="mt-2">{fmtTHB(v.totalThb)}</div>
      </div>
      <div className="rounded-sm p-4" style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em', color: PALETTE.muted }} className="uppercase">Price match rate</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 500, color: PALETTE.teal, lineHeight: 1.1 }} className="mt-2">{(matchRate * 100).toFixed(1)}%</div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted }} className="mt-1">{fmtFull(v.totalPriced)} of {fmtFull(v.totalWorks)} APC-bearing works priced</div>
      </div>
    </div>

    <OaSplit gold={v.gold} hybrid={v.hybrid} />

    <div className="space-y-2">
      {shown.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div style={{ width: 200, fontFamily: FONT_BODY, fontSize: 12, color: PALETTE.charcoal, textAlign: 'right', flex: 'none' }} title={r.key}>{r.label}</div>
          <div className="flex-1">
            <div className="flex" style={{ height: 18, borderRadius: 2, overflow: 'hidden', width: `${Math.max(2, (r.usd / maxUsd) * 100)}%`, transition: 'width 0.4s ease' }}
                 title={`${fmtUSD(r.usd)} (Gold ${fmtUSD(r.gold || 0)}, Hybrid ${fmtUSD(r.hybrid || 0)})`}>
              <div style={{ width: `${r.usd ? ((r.gold || 0) / r.usd) * 100 : 0}%`, background: OA_COLORS.gold }} />
              <div style={{ width: `${r.usd ? ((r.hybrid || 0) / r.usd) * 100 : 0}%`, background: OA_COLORS.hybrid }} />
            </div>
          </div>
          <div style={{ width: 220, fontFamily: FONT_MONO, fontSize: 11, color: PALETTE.ink, flex: 'none' }}>
            {fmtUSD(r.usd)}
            <span style={{ color: PALETTE.muted }}> · {r.priced}/{r.works}</span>
            {r.basis && (
              <span title="How this publisher was priced: by ISSN is most precise; by title and flat rate are estimates."
                style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 2, fontSize: 9, letterSpacing: '0.04em', border: `1px solid ${PALETTE.rule}`, color: r.basis === 'by ISSN' ? PALETTE.teal : PALETTE.rust, background: PALETTE.cream }}>
                {r.basis}
              </span>
            )}
          </div>
        </div>
      ))}
      {v.rows.length > TOP && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted }} className="pt-1">Showing top {TOP} of {v.rows.length} publishers by estimated spend.</div>
      )}
      {v.rows.length === 0 && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.muted }} className="px-2 py-4">No priced open access works in this selection.</div>
      )}
    </div>

    <div className="mt-5 rounded-sm px-4 py-3" style={{ background: PALETTE.paper, border: `1px solid ${PALETTE.rule}` }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.2em', color: PALETTE.muted }} className="uppercase mb-2">Method &amp; caveats</div>
      <ul style={{ fontFamily: FONT_BODY, fontSize: 12, color: PALETTE.charcoal, lineHeight: 1.6, listStyle: 'disc', paddingLeft: 18 }}>
        {(apcData.caveats || []).map((c, i) => (<li key={i} style={{ marginBottom: 3 }}>{c}</li>))}
      </ul>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted }} className="mt-2">
        {filterActive ? 'Live: priced from OpenAlex for the current selection (THB at an average rate).' : 'National: precomputed totals (THB at per-year rates).'} Prices from curated publisher lists plus OpenAlex apc_list/DOAJ.
      </div>
    </div>
  </>);
};

export default function ResearchOutputDashboard() {
  useFonts();

  // Country code drives the entire dashboard. Default Thailand; persisted in localStorage
  // so reloads remember the last choice. Validated against ISO regex below.
  const [country, setCountry] = useState(() => {
    if (typeof window === 'undefined') return 'TH';
    const saved = window.localStorage?.getItem('dashboard.country');
    return /^[A-Z]{2}$/.test(saved || '') ? saved : 'TH';
  });

  // Multi-year selection. `years` is the source of truth: a sorted array of
  // years currently active (always at least one). `year` is the representative
  // year (the most recent in the selection) used for labels, comparison anchors,
  // and the Producing Institutions per-year lookup. By keeping `year` as a derived
  // number we avoid touching every downstream reference; only the filter-string
  // builder and the few panels that need a multi-year-aware view check `years`.
  const [years, setYears] = useState([2025]);
  const year = years.length > 0 ? Math.max(...years) : 2025;
  const setYear = (y) => setYears([y]); // back-compat for any code that calls setYear

  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState({});
  const [state, setState] = useState({});

  // Persist country and clear filters when it changes (institution/publisher/funder
  // IDs from one country don't apply once the corpus shifts to another).
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('dashboard.country', country);
    }
    setFilters({});
  }, [country]);

  // How many bars/slices each panel shows. Defaults aim for legible at first glance.
  const DEFAULT_LIMITS = {
    institutions: 15, fields: 14, subfields: 12, docTypes: 7,
    oaStatus: 6, publishers: 12, languages: 8, sdgs: 14,
    collaborators: 14, funders: 12,
  };
  const [displayLimits, setDisplayLimits] = useState(DEFAULT_LIMITS);
  const [tableOpenDim, setTableOpenDim] = useState(null);

  // Local filter state for the institutions chart. These don't go through OpenAlex;
  // we already have type and subcategory in the metadata, so we filter in JS.
  // 'all' means no narrowing applied.
  const [instTypeFilter, setInstTypeFilter] = useState('all');
  const [instSubcategoryFilter, setInstSubcategoryFilter] = useState('all');

  // Publishing-channels view: 'top' (bar chart) or 'time' (rank-over-time bump
  // chart, only meaningful in multi-year mode). The bump chart is lazy-loaded.
  const [publisherView, setPublisherView] = useState('top');
  const [publisherRankCache, setPublisherRankCache] = useState({
    status: 'idle', rows: [], years: [], signature: null,
  });
  // Lazy-load the rank-over-time data when the "Rank over time" tab is active.
  // Window rule: a single selected year expands to the 5-year window ending at
  // that year (e.g. 2023 -> 2019..2023), so the baseline is always the latest
  // selected year counting backwards. A multi-year selection uses exactly the
  // selected years (e.g. 2023 + 2024 -> just those two). One group_by request
  // per year in the window. Cached by a signature of country + filters + window.
  useEffect(() => {
    if (publisherView !== 'time') return;
    if (!years || years.length === 0) return;

    const sortedSel = [...years].sort((a, b) => a - b);
    const windowYears = sortedSel.length >= 2
      ? sortedSel
      : (() => {
          const anchor = sortedSel[0];
          const arr = [];
          for (let y = anchor - 4; y <= anchor; y++) arr.push(y);
          return arr;
        })();

    const signature = JSON.stringify({
      country,
      windowYears,
      filters: Object.entries(filters || {})
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => [k, v.map((c) => c.value).sort()])
        .sort(),
    });
    if (publisherRankCache.signature === signature) return;
    if (publisherRankCache.status === 'loading') return;

    let cancelled = false;
    setPublisherRankCache({ status: 'loading', rows: [], years: [], signature });

    const fetchYear = async (y) => {
      const filterStr = buildFilterString(country, y, filters, 'publishers');
      // per-page=200 returns the full top-200 publishers per year (OpenAlex group_by
      // counts are exact regardless of page size; 200 just gives a complete ranking
      // and matches the Top publishers panel). We still only chart the top 15.
      const url = withMailto(
        `${OPENALEX_BASE}/works?filter=${filterStr}` +
        `&group_by=primary_location.source.host_organization&per-page=200`
      );
      try {
        const j = await fetchJson(url);
        const items = (j.group_by || []).map((g, idx) => ({
          key: g.key,
          label: g.key_display_name || 'Unknown',
          count: g.count || 0,
          rank: idx + 1,
        }));
        return [y, items];
      } catch {
        return [y, null];
      }
    };

    Promise.all(windowYears.map(fetchYear)).then((perYearResults) => {
      if (cancelled) return;
      const totalByKey = new Map();
      const labelByKey = new Map();
      for (const [, items] of perYearResults) {
        if (!items) continue;
        for (const it of items) {
          totalByKey.set(it.key, (totalByKey.get(it.key) || 0) + it.count);
          if (!labelByKey.has(it.key)) labelByKey.set(it.key, it.label);
        }
      }
      const topKeys = [...totalByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k);
      const rows = topKeys.map((key) => {
        const ranks = {};
        const counts = {};
        for (const [year, items] of perYearResults) {
          if (!items) continue;
          const item = items.find((it) => it.key === key);
          if (item) { ranks[year] = item.rank; counts[year] = item.count; }
        }
        return { key, label: labelByKey.get(key) || 'Unknown', ranks, counts };
      });
      setPublisherRankCache({ status: 'ready', rows, years: windowYears, signature });
    }).catch((e) => {
      if (cancelled) return;
      setPublisherRankCache({ status: 'error', rows: [], years: [], signature, error: e.message });
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publisherView, country, years, JSON.stringify(filters)]);

  const setLimit = (dim) => (n) => setDisplayLimits((s) => ({ ...s, [dim]: n }));
  const limitFor = (dim) => displayLimits[dim] ?? DEFAULT_LIMITS[dim] ?? 12;
  const sliceFor = (dim) => (state[dim]?.data || []).slice(0, limitFor(dim));

  // Total distinct items in a panel's dataset, with a flag for whether the data
  // is likely truncated by OpenAlex's 200-per-page group_by cap. The institutions
  // panel paginates so its count is exact; other panels show one page only and
  // the cap is hit when exactly 200 rows came back.
  const panelN = (dim) => {
    const data = state[dim]?.data || [];
    const n = data.length;
    if (n === 0) return null;
    // Institutions is paginated; trust the count exactly.
    if (dim === 'institutions') return { count: n, truncated: false };
    // Single-page panels: 200 rows = at the OpenAlex group_by cap, so flag.
    return { count: n, truncated: n >= 200 };
  };

  // Roster metadata lookup: OpenAlex institution id -> { type, subcategory,
  // country, label }. Built from the /institutions roster, which is the only
  // source of institution type and MHESI subcategory. Used to enrich the
  // filtered group_by counts below and to drop foreign co-author institutions.
  const institutionsRosterMeta = useMemo(() => {
    const m = new Map();
    for (const d of (state.institutions?.data || [])) m.set(d.key, d);
    return m;
  }, [state.institutions?.data]);

  // The producing-institutions chart data. Counts come from the in-selection
  // group_by (state.institutionsCounts) so the panel responds to publisher,
  // discipline, and other filter chips. Each count is joined to the roster for
  // its type/subcategory; entries with no roster match (foreign co-author
  // institutions, or any beyond the roster) are dropped, which also restricts
  // the list to the active country. Local type/subcategory pills filter further.
  const institutionsFiltered = useMemo(() => {
    const counts = state.institutionsCounts?.data || [];
    let base = counts
      .map((d) => {
        const meta = institutionsRosterMeta.get(d.key);
        if (!meta) return null;
        return {
          key: d.key,
          label: meta.label,
          fullLabel: meta.fullLabel,
          value: d.value,
          country: meta.country,
          type: meta.type,
          subcategory: meta.subcategory,
        };
      })
      .filter(Boolean);
    if (instTypeFilter !== 'all') {
      base = base.filter((d) => d.type === instTypeFilter);
    }
    if (instSubcategoryFilter !== 'all') {
      base = base.filter((d) => d.subcategory === instSubcategoryFilter);
    }
    return base;
  }, [state.institutionsCounts?.data, institutionsRosterMeta, instTypeFilter, instSubcategoryFilter]);

  // Available education-subcategory pills: only those actually present in the
  // current data set, in canonical (MHESI) display order.
  const subcategoriesPresent = useMemo(() => {
    const all = state.institutions?.data || [];
    const set = new Set();
    for (const d of all) {
      if (d.type === 'education' && d.subcategory) set.add(d.subcategory);
    }
    return EDUCATION_SUBCATEGORIES.filter((sc) => set.has(sc.key));
  }, [state.institutions?.data]);

  // Reset subcategory filter when type filter changes away from 'education' or 'all'.
  useEffect(() => {
    if (instTypeFilter !== 'all' && instTypeFilter !== 'education') {
      setInstSubcategoryFilter('all');
    }
  }, [instTypeFilter]);

  const toggleFilter = (dim, item) => {
    setFilters((prev) => {
      const current = prev[dim] || [];
      const exists = current.find((c) => c.value === item.value);
      const nextList = exists
        ? current.filter((c) => c.value !== item.value)
        : [...current, item];
      const next = { ...prev };
      if (nextList.length === 0) delete next[dim];
      else next[dim] = nextList;
      return next;
    });
  };

  const removeFilter = (dim, value) => {
    setFilters((prev) => {
      const nextList = (prev[dim] || []).filter((c) => c.value !== value);
      const next = { ...prev };
      if (nextList.length === 0) delete next[dim];
      else next[dim] = nextList;
      return next;
    });
  };

  const clearFilters = () => setFilters({});

  // When a type or subcategory pill is active, derive the matching set of OpenAlex
  // institution IDs from the loaded data and inject them into every panel's filter
  // string (except the institutions panel itself, which already filters locally).
  // This makes the type/subcategory pills behave as cross-filters, just like clicking
  // an individual institution bar would.
  const syntheticInstitutionFilter = useMemo(() => {
    const all = state.institutions?.data || [];
    if (instTypeFilter === 'all' && instSubcategoryFilter === 'all') return null;
    let matching = all;
    if (instTypeFilter !== 'all') {
      matching = matching.filter((d) => d.type === instTypeFilter);
    }
    if (instSubcategoryFilter !== 'all') {
      matching = matching.filter((d) => d.subcategory === instSubcategoryFilter);
    }
    if (matching.length === 0) return null;
    const ids = matching.map((d) => stripPrefix(d.key));
    // OpenAlex filter URLs can get long; cap at 200 IDs to stay under the
    // ~2KB practical URL limit. The xlsx-derived MHESI buckets all fit easily,
    // since the largest (private) is 104 entries.
    const capped = ids.slice(0, 200);
    return {
      ids: capped,
      cappedAt: ids.length > 200 ? 200 : null,
      totalMatching: ids.length,
      label: instSubcategoryFilter !== 'all'
        ? (EDUCATION_SUBCATEGORIES.find((sc) => sc.key === instSubcategoryFilter)?.label || instSubcategoryFilter)
        : (INSTITUTION_TYPES.find((t) => t.key === instTypeFilter)?.label || instTypeFilter),
    };
  }, [state.institutions?.data, instTypeFilter, instSubcategoryFilter]);

  const filterStrings = useMemo(() => {
    // Base filters, always built from the breadcrumb chips.
    const baseAll = buildFilterString(country, years, filters);
    const baseByDim = {};
    Object.keys(DIMENSIONS).forEach((d) => {
      baseByDim[d] = buildFilterString(country, years, filters, d);
    });

    // Augment with the synthetic institution-ID filter when a type/subcategory is active.
    const inst = syntheticInstitutionFilter;
    const augmented = (s, includeInstitutions) => {
      if (!inst || !includeInstitutions) return s;
      const idsClause = `authorships.institutions.id:${inst.ids.join('|')}`;
      return s ? `${s},${idsClause}` : idsClause;
    };

    const m = { all: augmented(baseAll, true) };
    Object.keys(DIMENSIONS).forEach((d) => {
      // The institutions panel itself doesn't need the synthetic filter applied,
      // because it already shows the full TH institution list and filters locally.
      m[d] = augmented(baseByDim[d], d !== 'institutions');
    });
    return m;
  }, [country, years, filters, syntheticInstitutionFilter]);

  useEffect(() => {
    let cancelled = false;
    const setPanel = (key, patch) => {
      if (cancelled) return;
      setState((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));
    };

    const run = async (key, url, transform) => {
      setPanel(key, { status: 'loading', error: null });
      try {
        const json = await fetchJson(url);
        if (cancelled) return;
        const data = transform ? await transform(json) : json;
        setPanel(key, { status: 'ready', data });
      } catch (e) {
        if (cancelled) return;
        setPanel(key, { status: 'error', error: e.message || 'Fetch failed' });
      }
    };

    run('total', countUrl(filterStrings.all), (j) => j?.meta?.count ?? 0);
    run('oaCount', countUrl(filterStrings.all, 'is_oa:true'), (j) => j?.meta?.count ?? 0);
    run('intlCount', countUrl(filterStrings.all, 'countries_distinct_count:>1'), (j) => j?.meta?.count ?? 0);
    // Domestic-only: works whose author affiliations are all from a single country
    // (the active country). We fetch the count and reuse it in the collaborators panel
    // so users see the share of domestic-only output below the cross-border bar chart.
    run('domesticCount', countUrl(filterStrings.all, 'countries_distinct_count:1'), (j) => j?.meta?.count ?? 0);

    // Outgoing citations: sum (refs * works) across the reference-count distribution.
    // OpenAlex doesn't expose a direct sum aggregation, so we group_by referenced_works_count
    // and compute the weighted total client-side. Note: works whose bibliographies haven't
    // been parsed land in the key=0 bucket, so we also surface the "with refs" count.
    run('outgoingCites', groupUrl(filterStrings.all, 'referenced_works_count'), (j) => {
      const groups = j?.group_by || [];
      let totalRefs = 0;
      let totalWorks = 0;
      let worksWithRefs = 0;
      for (const g of groups) {
        const refs = Number(g.key) || 0;
        const c = g.count || 0;
        totalRefs += refs * c;
        totalWorks += c;
        if (refs > 0) worksWithRefs += c;
      }
      return { totalRefs, totalWorks, worksWithRefs };
    });

    // Incoming citations: same trick as outgoing, but on cited_by_count instead of
    // referenced_works_count. The distribution gives us {key: <citation count>, count:
    // <number of works with that many cites>}; we sum (key * count) to get total cites
    // received by the active selection. Average = total / totalWorks.
    run('incomingCites', groupUrl(filterStrings.all, 'cited_by_count'), (j) => {
      const groups = j?.group_by || [];
      let totalCites = 0;
      let totalWorks = 0;
      let citedWorks = 0;
      for (const g of groups) {
        const c = Number(g.key) || 0;
        const w = g.count || 0;
        totalCites += c * w;
        totalWorks += w;
        if (c > 0) citedWorks += w;
      }
      return { totalCites, totalWorks, citedWorks };
    });

    // Cited vs uncited share for the active selection. Cheap: two count requests.
    run('citedShare', countUrl(filterStrings.all, 'cited_by_count:>0'), (j) => j?.meta?.count ?? 0);
    run('uncitedShare', countUrl(filterStrings.all, 'cited_by_count:0'), (j) => j?.meta?.count ?? 0);

    // Prior-year comparisons for the visibility overview card. Only fired in
    // single-year mode, where there's a well-defined "the active year" to swap
    // out of the filter string. In multi-year mode the comparison view is
    // hidden and these fetches are skipped.
    if (years.length === 1) {
      for (let offset = 1; offset <= 5; offset++) {
        const targetYear = year - offset;
        if (targetYear < 2000) break;
        const prevYearAll = filterStrings.all.replace(
          new RegExp(`publication_year:${year}\\b`),
          `publication_year:${targetYear}`
        );
        run(`prevYearCited_${offset}`,   countUrl(prevYearAll, 'cited_by_count:>0'), (j) => j?.meta?.count ?? 0);
        run(`prevYearUncited_${offset}`, countUrl(prevYearAll, 'cited_by_count:0'),  (j) => j?.meta?.count ?? 0);
      }
    }

    run('topWorks', topWorksUrl(filterStrings.all), (j) =>
      (j.results || []).map((w) => ({
        id: w.id,
        doi: w.doi,
        title: w.title || 'Untitled',
        cites: w.cited_by_count || 0,
        type: TYPE_NAMES[w.type] || w.type || '—',
        venue: w.primary_location?.source?.display_name || '—',
        oa: w.open_access?.is_oa,
        firstAuthor:
          (w.authorships || []).find((a) => a.author_position === 'first')?.author?.display_name ||
          (w.authorships || [])[0]?.author?.display_name ||
          '—',
      }))
    );

    run('docTypes', groupUrl(filterStrings.docTypes, 'type'), (j) =>
      (j.group_by || []).map((g) => ({
        key: g.key,
        label: TYPE_NAMES[g.key] || g.key_display_name || g.key,
        value: g.count,
      })).filter((d) => d.value > 0)
    );

    run('oaStatus', groupUrl(filterStrings.oaStatus, 'open_access.oa_status'), (j) =>
      (j.group_by || []).map((g) => ({
        key: g.key,
        label: g.key.charAt(0).toUpperCase() + g.key.slice(1),
        value: g.count,
      })).filter((d) => d.value > 0)
    );

    run('languages', groupUrl(filterStrings.languages, 'language'), (j) =>
      (j.group_by || [])
        .map((g) => ({
          key: g.key,
          label: LANG_NAMES[g.key] || g.key_display_name || g.key,
          value: g.count,
        }))
        .filter((d) => d.value > 0)
    );

    run('fields', groupUrl(filterStrings.fields, 'primary_topic.field.id'), (j) =>
      (j.group_by || [])
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 32), value: g.count }))
        .filter((d) => d.value > 0)
    );

    run('subfields', groupUrl(filterStrings.subfields, 'primary_topic.subfield.id'), (j) =>
      (j.group_by || [])
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 38), value: g.count }))
        .filter((d) => d.value > 0)
    );

    run('publishers', groupUrl(filterStrings.publishers, 'primary_location.source.host_organization'), (j) =>
      (j.group_by || [])
        .filter((g) => g.key && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 36), value: g.count }))
    );

    // Producing-institution counts WITHIN the current selection. Unlike the
    // roster fetched from the /institutions endpoint (which carries each
    // institution's global annual works_count and never sees the works filter),
    // this group_by counts each institution's contribution to the filtered
    // corpus, so the panel responds to publisher, discipline, and other chips.
    // It also returns foreign co-author institutions, which the panel drops by
    // joining against the country roster for type metadata. See institutionsFiltered.
    run('institutionsCounts', groupUrl(filterStrings.institutions, 'authorships.institutions.id'), (j) =>
      (j.group_by || [])
        .filter((g) => g.key && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 40), value: g.count }))
        .filter((d) => d.value > 0)
    );

    run('collaborators', groupUrl(filterStrings.collaborators, 'authorships.countries'), (j) => {
      const all = j.group_by || [];
      return all
        .map((g) => {
          // OpenAlex returns either the bare ISO-2 code or a full URL
          // like https://openalex.org/countries/TH. Normalise to the code.
          const raw = g.key || '';
          const m = raw.match(/\/countries\/([A-Z]{2})$/i);
          const code = (m ? m[1] : raw).toUpperCase();
          return { key: code, label: countryName(code), value: g.count, _rawKey: g.key };
        })
        .filter((g) => g.key && g.key !== country && g.key && g.key !== 'UNKNOWN' && g.key.length === 2);
    });

    run('sdgs', groupUrl(filterStrings.sdgs, 'sustainable_development_goals.id'), (j) =>
      (j.group_by || [])
        .map((g) => {
          const num = (g.key || '').match(/\/(\d+)$/)?.[1];
          const label = num ? `SDG ${num} · ${g.key_display_name}` : g.key_display_name;
          return { key: g.key, label: cleanLabel(label, 42), value: g.count };
        })
        .filter((d) => d.value > 0)
    );

    run('funders', groupUrl(filterStrings.funders, 'funders.id'), (j) =>
      (j.group_by || [])
        .filter((g) => g.key && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 38), value: g.count }))
    );

    return () => { cancelled = true; };
  }, [year, refreshKey, filterStrings]);

  // Institution roster (metadata only): fetched from the /institutions endpoint,
  // keyed solely on country and years. It supplies type/subcategory metadata and
  // the id set for the synthetic type filter; the chart counts come separately
  // from the in-selection group_by in the main effect. Keeping the roster in its
  // own effect, independent of the filter chips, breaks an infinite-render loop
  // that would otherwise occur: filter chips → filterStrings change → main effect
  // refires → roster reference changes → syntheticInstitutionFilter recomputes →
  // filterStrings change → loop. Decoupling stops the cascade.
  useEffect(() => {
    let cancelled = false;
    const setPanel = (key, patch) => {
      if (cancelled) return;
      setState((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));
    };

    setPanel('institutions', { status: 'loading', error: null });
    (async () => {
      try {
        const allInsts = [];
        for (let page = 1; page <= 5; page++) {
          if (cancelled) return;
          const url = withMailto(
            `${OPENALEX_BASE}/institutions?filter=country_code:${country}` +
            `&per-page=200&page=${page}` +
            `&select=id,display_name,type,country_code,counts_by_year`
          );
          const j = await fetchJson(url);
          if (cancelled) return;
          const batch = j.results || [];
          allInsts.push(...batch);
          if (batch.length < 200) break;
        }
        if (cancelled) return;
        // This roster now serves as metadata only: it supplies each institution's
        // type and MHESI subcategory (for the pills and the y-axis colours) and the
        // id set used by the synthetic type filter. The chart counts come from the
        // in-selection group_by (state.institutionsCounts), which is naturally
        // bounded by the corpus, so the old counts_by_year inflation that affected
        // mis-disambiguated institutions (e.g. National Institute for Fusion Science
        // for JP) no longer reaches the display and needs no ceiling workaround.
        const data = allInsts
          .map((inst) => {
            const type = inst.type || 'other';
            return {
              key: inst.id,
              label: inst.display_name || 'Unknown',
              fullLabel: inst.display_name,
              country: inst.country_code,
              type,
              subcategory: type === 'education' ? subcategoryFor(inst.display_name) : null,
            };
          })
          .filter((d) => {
            // Keep only institutions actually located in the active country.
            if (d.country !== country) return false;
            // Exclude known-misclassified institutions for this country
            // (data quality issue at OpenAlex; see comment near
            // EXCLUDED_INSTITUTIONS_BY_COUNTRY at top of file).
            const excluded = EXCLUDED_INSTITUTIONS_BY_COUNTRY[country];
            if (excluded && excluded.has(d.key)) return false;
            return true;
          });
        setPanel('institutions', { status: 'ready', data });
      } catch (e) {
        if (cancelled) return;
        setPanel('institutions', { status: 'error', error: e.message || 'Fetch failed' });
      }
    })();

    return () => { cancelled = true; };
  }, [country, years, refreshKey]);

  const selKeys = (dim) => (filters[dim] || []).map((f) => f.value);

  // Returns a click handler only if the dimension is filterable; otherwise undefined,
  // which causes HBar/Donut to render without cursor pointer or selection styling.
  const onPick = (dim) => {
    const def = DIMENSIONS[dim];
    if (!def?.filterable) return undefined;
    return (entry) => {
      if (!entry || !entry.key) return;
      toggleFilter(dim, { value: entry.key, label: entry.label });
    };
  };

  const totalCount = state.total?.data;
  const oaCount = state.oaCount?.data;
  const intlCount = state.intlCount?.data;
  const filterCount = Object.values(filters).reduce((s, arr) => s + (arr?.length || 0), 0);

  // Ref to the inline breadcrumb so the sticky variant knows when it scrolls out of view.
  const breadcrumbAnchorRef = React.useRef(null);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: `radial-gradient(1200px 600px at 10% -10%, ${PALETTE.cream} 0%, ${PALETTE.paper} 60%, ${PALETTE.paper} 100%)`,
        color: PALETTE.ink,
        fontFamily: FONT_BODY,
      }}
    >
      <StickyFilterBreadcrumb
        filters={filters}
        onRemove={removeFilter}
        onClear={clearFilters}
        anchorRef={breadcrumbAnchorRef}
      />
      <header className="border-b" style={{ borderColor: PALETTE.ink, background: PALETTE.paper }}>
        {/* OAR Chula logo strip + cross-link to companion dashboard */}
        <div className="border-b" style={{ borderColor: PALETTE.rule }}>
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 py-3">
            <a
              href="https://www.car.chula.ac.th"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block"
              title="Office of Academic Resources, Chulalongkorn University"
            >
              <img
                src="oar_logo.png"
                alt="Office of Academic Resources, Chulalongkorn University"
                style={{ height: 44, width: 'auto', display: 'block' }}
              />
            </a>
            <a
              href="https://thailand-citations-dashboard.vercel.app/"
              target="_blank"
              rel="noreferrer noopener"
              className="th-cross-link inline-flex items-center gap-1.5 px-3 py-2 transition-colors"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                background: PALETTE.cream,
                color: PALETTE.charcoal,
                border: `1px solid ${PALETTE.rule}`,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
              title="Open the Thailand Citations Dashboard in a new tab"
            >
              <span className="hidden sm:inline">Thailand Citations Dashboard</span>
              <span className="sm:hidden">Citations Dashboard</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-[1400px] px-6 pt-6 pb-5">
          <div className="flex items-center justify-between gap-4">
            <div
              style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.22em' }}
              className="uppercase"
            >
              Bibliometric Brief · OpenAlex · {country}
            </div>
            <div
              style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.18em' }}
              className="uppercase hidden md:block"
            >
              Vol. {year} · Issue {String(new Date().getMonth() + 1).padStart(2, '0')}/{String(new Date().getFullYear()).slice(2)}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <h1
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 500,
                  fontSize: 'clamp(36px, 4.6vw, 60px)',
                  lineHeight: 0.98,
                  letterSpacing: '-0.018em',
                  color: PALETTE.ink,
                }}
              >
                {countryName(country)} <em style={{ fontStyle: 'italic', color: PALETTE.burgundy }}>Research</em> Output
              </h1>
              <p
                className="mt-3 max-w-2xl"
                style={{ fontFamily: FONT_BODY, fontSize: 14, color: PALETTE.charcoal, lineHeight: 1.55 }}
              >
                A live, policy-oriented breakdown of scholarly works with at least one {countryName(country)} institutional
                affiliation, drawn from the OpenAlex knowledge graph. Click any bar or slice to focus the entire dashboard;
                click again to release. Multiple filters compose with AND across dimensions and OR within them.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <CountrySelector country={country} onChange={setCountry} />
              <div className="flex flex-wrap items-center gap-2">
                {/* Multi-select year tabs. Click to toggle each year; cannot
                    deselect the last remaining year (the dashboard always needs
                    at least one). The All/Reset pills below give quick presets. */}
                <div className="flex items-center gap-1 rounded-sm" style={{ border: `1px solid ${PALETTE.ink}` }}>
                  {YEARS.map((y) => {
                    const selected = years.includes(y);
                    return (
                      <button
                        key={y}
                        onClick={() => {
                          if (selected) {
                            // Don't allow deselecting the last year
                            if (years.length > 1) {
                              setYears(years.filter((v) => v !== y));
                            }
                          } else {
                            setYears([...years, y].sort((a, b) => a - b));
                          }
                        }}
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          letterSpacing: '0.04em',
                          background: selected ? PALETTE.ink : 'transparent',
                          color: selected ? PALETTE.cream : PALETTE.ink,
                        }}
                        className="px-3 py-1.5 transition-colors"
                        title={selected ? (years.length > 1 ? `Remove ${y} from selection` : 'Cannot deselect the only active year') : `Add ${y} to selection`}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
                {/* Year preset shortcuts */}
                <button
                  onClick={() => setYears([...YEARS].sort((a, b) => a - b))}
                  disabled={years.length === YEARS.length}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    border: `1px solid ${PALETTE.rule}`,
                    background: 'transparent',
                    color: years.length === YEARS.length ? PALETTE.rule : PALETTE.muted,
                    cursor: years.length === YEARS.length ? 'default' : 'pointer',
                  }}
                  className="rounded-sm px-2 py-1 uppercase"
                  title="Select all available years"
                >
                  All
                </button>
                <button
                  onClick={() => setYears([YEARS[0]])}
                  disabled={years.length === 1 && years[0] === YEARS[0]}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    border: `1px solid ${PALETTE.rule}`,
                    background: 'transparent',
                    color: (years.length === 1 && years[0] === YEARS[0]) ? PALETTE.rule : PALETTE.muted,
                    cursor: (years.length === 1 && years[0] === YEARS[0]) ? 'default' : 'pointer',
                  }}
                  className="rounded-sm px-2 py-1 uppercase"
                  title="Reset to current year only"
                >
                  Reset
                </button>
              </div>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors"
                style={{
                  border: `1px solid ${PALETTE.ink}`,
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  background: 'transparent',
                }}
              >
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {syntheticInstitutionFilter && (
            <div
              className="mt-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
              style={{
                background: PALETTE.cream,
                borderColor: PALETTE.burgundy,
              }}
            >
              <span
                style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em', color: PALETTE.burgundy }}
                className="uppercase"
              >
                Cross-filter
              </span>
              <span
                style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal }}
              >
                Whole dashboard restricted to{' '}
                <strong style={{ color: PALETTE.ink }}>{syntheticInstitutionFilter.label}</strong>
                {' '}({fmtFull(syntheticInstitutionFilter.totalMatching)} institution{syntheticInstitutionFilter.totalMatching === 1 ? '' : 's'}
                {syntheticInstitutionFilter.cappedAt ? `, capped at ${syntheticInstitutionFilter.cappedAt}` : ''}
                )
              </span>
              <button
                onClick={() => {
                  setInstTypeFilter('all');
                  setInstSubcategoryFilter('all');
                }}
                style={{
                  marginLeft: 'auto',
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: PALETTE.burgundy,
                  textDecoration: 'underline',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}

          <FilterBreadcrumb
            filters={filters}
            onRemove={removeFilter}
            onClear={clearFilters}
            innerRef={breadcrumbAnchorRef}
          />
        </div>
      </header>

      <section className="mx-auto max-w-[1400px] px-6 pt-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <StatCard
            kicker={filterCount ? 'Filtered works' : `Total works · ${country} affiliated`}
            value={totalCount != null ? fmtFull(totalCount) : '—'}
            sub={`Records in OpenAlex matching the active selection in ${year}.`}
            accent={PALETTE.ink}
            loading={state.total?.status === 'loading'}
          />
          <StatCard
            kicker="Open access share"
            value={totalCount && oaCount != null ? pct(oaCount, totalCount) : '—'}
            sub={oaCount != null && totalCount ? `${fmtFull(oaCount)} of ${fmtFull(totalCount)} works are openly readable.` : 'Loading slice…'}
            accent={PALETTE.gold}
            loading={state.oaCount?.status === 'loading' || state.total?.status === 'loading'}
          />
          <StatCard
            kicker="International co-authorship"
            value={totalCount && intlCount != null ? pct(intlCount, totalCount) : '—'}
            sub={intlCount != null && totalCount ? `${fmtFull(intlCount)} works include ≥2 country affiliations.` : 'Loading slice…'}
            accent={PALETTE.teal}
            loading={state.intlCount?.status === 'loading' || state.total?.status === 'loading'}
          />
          <StatCard
            kicker="Incoming citations"
            value={
              state.incomingCites?.data?.totalCites != null
                ? fmt(state.incomingCites.data.totalCites)
                : '—'
            }
            sub={
              state.incomingCites?.data
                ? (() => {
                    const { totalCites, totalWorks, citedWorks } = state.incomingCites.data;
                    if (!totalWorks) return 'No works in current selection.';
                    const avg = (totalCites / totalWorks).toFixed(1);
                    const citedShare = pct(citedWorks, totalWorks);
                    return `${avg} cites/work avg · ${fmtFull(citedWorks)} of ${fmtFull(totalWorks)} works (${citedShare}) cited at least once.`;
                  })()
                : 'Loading slice…'
            }
            accent={PALETTE.rust}
            loading={state.incomingCites?.status === 'loading'}
          />
          <StatCard
            kicker="Outgoing citations"
            value={
              state.outgoingCites?.data?.totalRefs != null
                ? fmt(state.outgoingCites.data.totalRefs)
                : '—'
            }
            sub={
              state.outgoingCites?.data
                ? (() => {
                    const { totalRefs, totalWorks, worksWithRefs } = state.outgoingCites.data;
                    if (!worksWithRefs) return 'No reference data parsed for this selection.';
                    const avg = (totalRefs / worksWithRefs).toFixed(1);
                    const cov = pct(worksWithRefs, totalWorks);
                    return `${avg} refs/work avg · ${fmtFull(worksWithRefs)} of ${fmtFull(totalWorks)} works (${cov}) have parsed references.`;
                  })()
                : 'Loading slice…'
            }
            accent={PALETTE.plum}
            loading={state.outgoingCites?.status === 'loading'}
          />
        </div>
      </section>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div
          className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-sm px-4 py-2.5"
          style={{ background: PALETTE.paper, border: `1px solid ${PALETTE.rule}` }}
        >
          <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }} className="uppercase">
            Legend
          </span>
          <span className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 flex-none items-center justify-center rounded-sm"
              style={{ background: PALETTE.ink, color: PALETTE.cream }}
            >
              <Filter size={12} strokeWidth={1.8} />
            </span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.charcoal }}>
              Solid icon: click a bar or slice to filter the whole dashboard
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 flex-none items-center justify-center rounded-sm"
              style={{ background: 'transparent', color: PALETTE.muted, border: `1px solid ${PALETTE.rule}` }}
            >
              <Filter size={12} strokeWidth={1.8} />
            </span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.charcoal }}>
              Outline icon: display only
            </span>
          </span>
        </div>
        <CollapsibleSection title="Publication Landscape" subtitle="Who and what">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card className="p-5 lg:col-span-12" collapsible>
            <SectionTitle
              icon={Building2}
              filterable
              kicker="Producing institutions"
              title="Where the research happens"
              hint={`${countryName(country)} institutions · counts within the current selection`}
              count={
                state.institutionsCounts?.status === 'ready'
                  ? `${institutionsFiltered.length} of ${(state.institutions?.data || []).length}`
                  : null
              }
              countLabel="institutions"
            />
            {/* Type filter pills */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span
                style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
                className="uppercase mr-1"
              >
                Type
              </span>
              <InstPill
                active={instTypeFilter === 'all'}
                onClick={() => setInstTypeFilter('all')}
                label="All types"
              />
              {INSTITUTION_TYPES.map((t) => {
                const present = (state.institutions?.data || []).some((d) => d.type === t.key);
                if (!present) return null;
                return (
                  <InstPill
                    key={t.key}
                    active={instTypeFilter === t.key}
                    onClick={() => setInstTypeFilter(t.key)}
                    label={t.label}
                    color={t.color}
                  />
                );
              })}
            </div>
            {/* Education subcategory pills, only shown when relevant */}
            {(instTypeFilter === 'education' || instTypeFilter === 'all') && subcategoriesPresent.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span
                  style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
                  className="uppercase mr-1"
                >
                  {instTypeFilter === 'education' ? 'Education subtype' : 'Education subtype (optional)'}
                </span>
                <InstPill
                  active={instSubcategoryFilter === 'all'}
                  onClick={() => setInstSubcategoryFilter('all')}
                  label="All"
                  subtle
                />
                {subcategoriesPresent.map((sc) => (
                  <InstPill
                    key={sc.key}
                    active={instSubcategoryFilter === sc.key}
                    onClick={() => {
                      setInstSubcategoryFilter(sc.key);
                      // Auto-narrow type to education when picking a subcategory
                      if (instTypeFilter === 'all') setInstTypeFilter('education');
                    }}
                    label={sc.label}
                    color={sc.color}
                    subtle
                  />
                ))}
              </div>
            )}
            <ChartFrame
              status={state.institutionsCounts?.status}
              error={state.institutionsCounts?.error}
              hint={
                institutionsFiltered.length === 0
                  ? 'No institutions match the active filters.'
                  : `Showing ${institutionsFiltered.length} of ${(state.institutions?.data || []).length} ${countryName(country)} institutions producing output in the current selection.`
              }
            >
              <HBar
                data={institutionsFiltered.slice(0, limitFor('institutions'))}
                color={PALETTE.navy}
                onBarClick={onPick('institutions')}
                selectedKeys={selKeys('institutions')}
                yAxisWidth={(() => {
                  // Size the y-axis to fit the longest visible label, with a sensible
                  // cap so very long names don't push the bar plot off-screen. At
                  // 11px IBM Plex Sans, the average glyph is ~6.2px wide, so the
                  // formula approximates the rendered width.
                  const visible = institutionsFiltered.slice(0, limitFor('institutions'));
                  const longest = visible.reduce((m, d) => Math.max(m, (d.label || '').length), 0);
                  return Math.min(420, Math.max(220, Math.round(longest * 6.2) + 16));
                })()}
                tickFillFn={(d) => {
                  // Education-typed institutions: use the MHESI subcategory colour.
                  // Other types: use the type's own colour. Both come from the same
                  // arrays (EDUCATION_SUBCATEGORIES, INSTITUTION_TYPES) that drive
                  // the pill colours, so the visual lookup is self-consistent.
                  if (d.type === 'education' && d.subcategory) {
                    const sc = EDUCATION_SUBCATEGORIES.find((s) => s.key === d.subcategory);
                    if (sc) return sc.color;
                  }
                  const t = INSTITUTION_TYPES.find((it) => it.key === d.type);
                  return t?.color || PALETTE.charcoal;
                }}
              />
              <ChartControls
                total={institutionsFiltered.length}
                limit={limitFor('institutions')}
                onLimitChange={setLimit('institutions')}
                onOpenTable={() => setTableOpenDim('institutions')}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Layers}
              filterable
              kicker="Disciplinary mix"
              title="Fields of inquiry"
              hint="OpenAlex primary_topic.field"
              count={panelN('fields')?.count}
              countLabel={panelN('fields')?.truncated ? 'fields shown · capped at 200' : 'distinct fields'}
            />
            <ChartFrame status={state.fields?.status} error={state.fields?.error}>
              <HBar
                data={sliceFor('fields')}
                color={PALETTE.burgundy}
                onBarClick={onPick('fields')}
                selectedKeys={selKeys('fields')}
              />
              <ChartControls
                total={(state.fields?.data || []).length}
                limit={limitFor('fields')}
                onLimitChange={setLimit('fields')}
                onOpenTable={() => setTableOpenDim('fields')}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Sparkles}
              filterable
              kicker="Granular topics"
              title="Active subfields"
              hint="OpenAlex primary_topic.subfield"
              count={panelN('subfields')?.count}
              countLabel={panelN('subfields')?.truncated ? 'subfields shown · capped at 200' : 'distinct subfields'}
            />
            <ChartFrame status={state.subfields?.status} error={state.subfields?.error}>
              <HBar
                data={sliceFor('subfields')}
                color={PALETTE.forest}
                onBarClick={onPick('subfields')}
                selectedKeys={selKeys('subfields')}
              />
              <ChartControls
                total={(state.subfields?.data || []).length}
                limit={limitFor('subfields')}
                onLimitChange={setLimit('subfields')}
                onOpenTable={() => setTableOpenDim('subfields')}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={FileText}
              kicker="Output forms"
              title="Document types"
              count={panelN('docTypes')?.count}
              countLabel="document types"
            />
            <ChartFrame status={state.docTypes?.status} error={state.docTypes?.error}>
              <Donut
                data={sliceFor('docTypes')}
                height={260}
                onSliceClick={onPick('docTypes')}
                selectedKeys={selKeys('docTypes')}
              />
              <ChartControls
                total={(state.docTypes?.data || []).length}
                limit={limitFor('docTypes')}
                onLimitChange={setLimit('docTypes')}
                onOpenTable={() => setTableOpenDim('docTypes')}
                options={[5, 7, 10]}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Languages}
              kicker="Language of record"
              title="Publication languages"
              count={panelN('languages')?.count}
              countLabel="languages"
            />
            <ChartFrame status={state.languages?.status} error={state.languages?.error}>
              <Donut
                data={sliceFor('languages')}
                height={260}
                onSliceClick={onPick('languages')}
                selectedKeys={selKeys('languages')}
              />
              <ChartControls
                total={(state.languages?.data || []).length}
                limit={limitFor('languages')}
                onLimitChange={setLimit('languages')}
                onOpenTable={() => setTableOpenDim('languages')}
                options={[5, 8, 12]}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Globe2}
              filterable
              kicker="Co-authorship reach"
              title="International collaborators"
              hint={`${countryName(country)} excluded from list`}
              count={panelN('collaborators')?.count}
              countLabel={panelN('collaborators')?.truncated ? 'co-author countries · capped at 200' : 'co-author countries'}
            />
            <ChartFrame
              status={state.collaborators?.status}
              error={state.collaborators?.error}
              hint="A work appears in every co-author country it includes; numbers therefore exceed total works."
            >
              <HBar
                data={sliceFor('collaborators')}
                color={PALETTE.plum}
                onBarClick={onPick('collaborators')}
                selectedKeys={selKeys('collaborators')}
              />
              <ChartControls
                total={(state.collaborators?.data || []).length}
                limit={limitFor('collaborators')}
                onLimitChange={setLimit('collaborators')}
                onOpenTable={() => setTableOpenDim('collaborators')}
              />
              {state.domesticCount?.status === 'ready' && totalCount ? (
                <div
                  className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm px-3 py-2"
                  style={{ background: PALETTE.cream, border: `1px solid ${PALETTE.rule}` }}
                >
                  <span
                    style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', color: PALETTE.muted }}
                    className="uppercase"
                  >
                    Domestic-only
                  </span>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: PALETTE.charcoal }}>
                    <strong style={{ color: PALETTE.ink, fontFamily: FONT_MONO }}>
                      {fmtFull(state.domesticCount.data)}
                    </strong>{' '}
                    works ({pct(state.domesticCount.data, totalCount)}) involve {countryName(country)} authors only — no
                    international co-authors.
                  </span>
                </div>
              ) : null}
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Target}
              filterable
              kicker="Mission alignment"
              title="UN Sustainable Development Goals"
              hint="OpenAlex SDG classifier"
              count={panelN('sdgs')?.count}
              countLabel="SDGs covered"
            />
            <ChartFrame status={state.sdgs?.status} error={state.sdgs?.error}>
              <HBar
                data={sliceFor('sdgs')}
                color={PALETTE.gold}
                onBarClick={onPick('sdgs')}
                selectedKeys={selKeys('sdgs')}
              />
              <ChartControls
                total={(state.sdgs?.data || []).length}
                limit={limitFor('sdgs')}
                onLimitChange={setLimit('sdgs')}
                onOpenTable={() => setTableOpenDim('sdgs')}
                options={[10, 14, 17]}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6" collapsible>
            <SectionTitle
              icon={Banknote}
              filterable
              kicker="Funding landscape"
              title="Acknowledged funders"
              hint="From grants metadata; coverage is partial"
              count={panelN('funders')?.count}
              countLabel={panelN('funders')?.truncated ? 'funders shown · capped at 200' : 'distinct funders'}
            />
            <ChartFrame
              status={state.funders?.status}
              error={state.funders?.error}
              hint="Many works lack funder metadata in Crossref; absence here does not mean absence of funding."
            >
              <HBar
                data={sliceFor('funders')}
                color={PALETTE.rust}
                onBarClick={onPick('funders')}
                selectedKeys={selKeys('funders')}
              />
              <ChartControls
                total={(state.funders?.data || []).length}
                limit={limitFor('funders')}
                onLimitChange={setLimit('funders')}
                onOpenTable={() => setTableOpenDim('funders')}
              />
            </ChartFrame>
          </Card>
        </div>
        </CollapsibleSection>

        <CollapsibleSection title="Publishing" subtitle="Where and how much">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card className="p-5 lg:col-span-12" collapsible>
            <SectionTitle
              icon={Newspaper}
              filterable
              kicker="Publishing channels"
              title={publisherView === 'time'
                ? `Publisher rank over time · ${countryName(country)}`
                : `Top publishers carrying ${countryName(country)} output`}
              hint={publisherView === 'time'
                ? `${years.length >= 2 ? `${years.length}-year selection` : `5-year window ending ${Math.max(...years)}`} · top 15`
                : 'Host organisation of the primary location'}
              count={publisherView === 'top' ? panelN('publishers')?.count : null}
              countLabel={publisherView === 'top'
                ? (panelN('publishers')?.truncated ? 'publishers shown · capped at 200' : 'distinct publishers')
                : null}
            />
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {[
                { key: 'top', label: 'Top publishers' },
                { key: 'time', label: 'Rank over time' },
              ].map((tab) => {
                const isActive = publisherView === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setPublisherView(tab.key)}
                    className="rounded-sm px-2.5 py-1 transition-colors"
                    style={{
                      border: `1px solid ${isActive ? PALETTE.ink : PALETTE.rule}`,
                      background: isActive ? PALETTE.ink : 'transparent',
                      color: isActive ? PALETTE.cream : PALETTE.charcoal,
                      fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.03em',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {publisherView === 'top' ? (
              <ChartFrame status={state.publishers?.status} error={state.publishers?.error}>
                <HBar
                  data={sliceFor('publishers')}
                  color={PALETTE.teal}
                  onBarClick={onPick('publishers')}
                  selectedKeys={selKeys('publishers')}
                />
                <ChartControls
                  total={(state.publishers?.data || []).length}
                  limit={limitFor('publishers')}
                  onLimitChange={setLimit('publishers')}
                  onOpenTable={() => setTableOpenDim('publishers')}
                />
              </ChartFrame>
            ) : (
              <>
                <p className="-mt-1 mb-3 max-w-3xl" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.muted, lineHeight: 1.5 }}>
                  Each line traces one publisher's rank position across the selected window. Crossings indicate one publisher overtaking another; dramatic swings indicate volatility. Top-ranked publishers in the most recent year carry warmer colours. Hover a line for year-by-year ranks and counts.
                </p>
                <RankBumpChart
                  rows={publisherRankCache.rows}
                  years={publisherRankCache.years}
                  topN={15}
                  status={publisherRankCache.status === 'idle' ? 'loading' : publisherRankCache.status}
                  accentColor={PALETTE.teal}
                />
              </>
            )}
          </Card>

          <Card className="p-5 lg:col-span-12" collapsible>
            <SectionTitle
              icon={BookOpen}
              filterable
              kicker="Access regime"
              title="Open access pathways"
              hint="Share of works by OA status · click a segment to filter"
              count={panelN('oaStatus')?.count}
              countLabel="OA pathways"
            />
            <ChartFrame status={state.oaStatus?.status} error={state.oaStatus?.error}>
              <ProportionBar
                data={state.oaStatus?.data || []}
                colorMap={OA_COLORS}
                onSegmentClick={onPick('oaStatus')}
                selectedKeys={selKeys('oaStatus')}
              />
            </ChartFrame>
          </Card>

          <ApcPanel
            years={years}
            country={country}
            filters={filters}
            instFilterIds={
              (instTypeFilter === 'all' && instSubcategoryFilter === 'all')
                ? null
                : (institutionsFiltered || []).map((d) => normalizeFilterValue(d.key))
            }
          />
        </div>
        </CollapsibleSection>

        <CollapsibleSection title="Visibility" subtitle="Reach and impact">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Cited vs uncited overview. In single-year mode shows up to 5 prior
              years for comparison; in multi-year mode shows just the aggregate. */}
          <Card className="p-5 lg:col-span-12" collapsible>
            <SectionTitle
              icon={Sparkles}
              kicker="Citation reach"
              title="Cited vs uncited share"
              hint={years.length === 1
                ? (year > 2000 ? `Compared to ${year - 1}` : null)
                : `Aggregate of ${years.length} selected year${years.length === 1 ? '' : 's'}`}
              count={(() => {
                const cited = state.citedShare?.data;
                const total = (state.citedShare?.data || 0) + (state.uncitedShare?.data || 0);
                if (!total) return null;
                return `${pct(cited, total)} cited · ${fmtFull(total)} works`;
              })()}
            />
            <p
              className="-mt-2 mb-4 max-w-3xl"
              style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.muted, lineHeight: 1.55 }}
            >
              {years.length === 1
                ? `Share of ${countryName(country)}-affiliated works that have received at least one citation versus those still uncited, within the current filter selection. Citations accumulate over time, so a small uncited share in the latest year is normal and decays as the corpus ages.`
                : `Share of ${countryName(country)}-affiliated works across the selected year range that have received at least one citation versus those still uncited. Year-over-year comparison is hidden in multi-year mode; switch to a single year to see the prior-years comparison bars.`}
            </p>
            <CitationReachBars
              series={
                years.length === 1
                  ? [
                      // Single-year mode: active year + up to five priors for comparison
                      {
                        year,
                        cited: state.citedShare?.data || 0,
                        uncited: state.uncitedShare?.data || 0,
                        emphasis: true,
                      },
                      ...[1, 2, 3, 4, 5].map((offset) => ({
                        year: year - offset,
                        cited: state[`prevYearCited_${offset}`]?.data || 0,
                        uncited: state[`prevYearUncited_${offset}`]?.data || 0,
                        emphasis: false,
                      })),
                    ]
                  : [
                      // Multi-year mode: single aggregate row, no comparison
                      {
                        year: years.length === 2
                          ? `${Math.min(...years)} & ${Math.max(...years)}`
                          : `${Math.min(...years)}–${Math.max(...years)}` +
                            (years.length === Math.max(...years) - Math.min(...years) + 1 ? '' : ` (${years.length} years)`),
                        cited: state.citedShare?.data || 0,
                        uncited: state.uncitedShare?.data || 0,
                        emphasis: true,
                      },
                    ]
              }
              year={year}
              status={state.citedShare?.status}
              error={state.citedShare?.error}
            />
          </Card>

          {/* Merged citation-insight section. The mode toggle inside the section
              switches between cited and uncited subsets without duplicating chrome. */}
          <CitationInsightSection
            year={year}
            country={country}
            baseFilterStr={filterStrings.all}
            countryInstitutionIds={(state.institutions?.data || []).map((d) => d.key)}
            activeFilters={filters}
          />

          <Card className="p-5 lg:col-span-12" collapsible>
            <SectionTitle
              icon={TrendingUp}
              kicker="Visibility"
              title="Prominent works"
              hint="Live ranking; very recent works under-cite"
              count={state.topWorks?.data ? state.topWorks.data.length : null}
              countLabel="top works ranked"
            />
            <p
              className="-mt-2 mb-4 max-w-3xl"
              style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.muted, lineHeight: 1.55 }}
            >
              Top {countryName(country)}-affiliated publications by incoming citation count, ranked from the works in the active
              selection. Citation counts accumulate over time, so works from the most recent year typically appear lower than their
              eventual standing.
            </p>
            <ChartFrame status={state.topWorks?.status} error={state.topWorks?.error}>
              <ol className="space-y-3">
                {(state.topWorks?.data || []).map((w, i) => (
                  <li key={w.id} className="flex gap-3 border-b pb-3 last:border-b-0" style={{ borderColor: PALETTE.rule }}>
                    <div
                      style={{
                        fontFamily: FONT_DISPLAY, fontStyle: 'italic', color: PALETTE.burgundy,
                        fontSize: 22, lineHeight: 1, width: 32,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={w.doi || w.id}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{
                          fontFamily: FONT_DISPLAY, fontWeight: 500, color: PALETTE.ink,
                          fontSize: 14, lineHeight: 1.3, textDecoration: 'none',
                        }}
                        className="block hover:underline"
                      >
                        {w.title}
                      </a>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"
                        style={{ fontFamily: FONT_BODY, fontSize: 11, color: PALETTE.muted }}
                      >
                        <span>{w.firstAuthor}{(w.firstAuthor && w.firstAuthor !== '—') ? ' et al.' : ''}</span>
                        <span>·</span>
                        <span style={{ fontStyle: 'italic' }}>{w.venue}</span>
                        <span>·</span>
                        <span style={{ fontFamily: FONT_MONO }}>{w.type}</span>
                        {w.oa && (
                          <span
                            style={{
                              fontFamily: FONT_MONO, background: PALETTE.gold,
                              color: PALETTE.paper, padding: '1px 6px', fontSize: 9,
                              letterSpacing: '0.08em',
                            }}
                          >
                            OA
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: FONT_MONO, color: PALETTE.ink, fontSize: 13,
                        fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                      className="text-right"
                    >
                      {fmtFull(w.cites)}
                      <div style={{ fontSize: 9, color: PALETTE.muted, fontWeight: 400, letterSpacing: '0.1em' }} className="uppercase">
                        cites
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </ChartFrame>
          </Card>
        </div>
        </CollapsibleSection>

        <Card className="mt-6 p-6">
          <SectionTitle icon={Database} kicker="Methods & caveats" title="On reading these numbers" />
          <div
            className="grid grid-cols-1 gap-5 md:grid-cols-3"
            style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.charcoal, lineHeight: 1.6 }}
          >
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">Source</div>
              All counts come from the OpenAlex Works API filtered by{' '}
              <code style={{ fontFamily: FONT_MONO, background: PALETTE.cream, padding: '1px 4px' }}>authorships.institutions.country_code:{country}</code>{' '}
              and the active selection. SDG and topic tags use OpenAlex’s in-house classifiers; topic taxonomy is hierarchical (domain → field → subfield → topic).
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">Cross-filtering</div>
              Each chart computes its breakdown with all <em>other</em> active filters applied, but ignores its own dimension. That is why the Institutions chart still shows many bars after you click one. Across dimensions filters are AND; within one dimension, OR.
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">2025 caveat</div>
              The current year is still being indexed. OpenAlex has reported reduced affiliation metadata coverage for some
              2025 articles, particularly from commercial publishers, so absolute counts are conservative for the latest year.
              Triangulate against Scopus, Web of Science, and Dimensions for institutional reporting.
            </div>
          </div>
        </Card>
      </main>

      <footer className="border-t" style={{ borderColor: PALETTE.rule, background: PALETTE.paper }}>
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          {/* Acknowledgement row: prose, slightly larger and unstyled, before the meta strip */}
          <div
            className="flex flex-col gap-2 border-b pb-4 md:flex-row md:items-center md:justify-between"
            style={{ borderColor: PALETTE.rule }}
          >
            <div
              style={{ fontFamily: FONT_BODY, fontSize: 12, color: PALETTE.charcoal, lineHeight: 1.55, maxWidth: 760 }}
            >
              Built by the{' '}
              <a
                href="https://www.car.chula.ac.th"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: PALETTE.burgundy, textDecoration: 'underline' }}
              >
                Office of Academic Resources, Chulalongkorn University
              </a>
              . Dashboard scaffolding, data wiring, and visual design were developed in collaboration with{' '}
              <a
                href="https://www.anthropic.com/claude"
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: PALETTE.burgundy, textDecoration: 'underline' }}
              >
                Claude
              </a>
              , Anthropic's AI assistant.
            </div>
            <div
              style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.16em' }}
              className="uppercase"
            >
              {new Date().getFullYear()} · CC0 / MIT
            </div>
          </div>
          <div
            className="mt-3 flex flex-col items-start justify-between gap-2 md:flex-row md:items-center"
            style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.12em' }}
          >
            <div className="uppercase">Data · OpenAlex.org (CC0) · openalex.org/works</div>
            <div className="uppercase">Live API · No caching · Counts may shift between loads</div>
          </div>
        </div>
      </footer>

      <TableModal
        open={!!tableOpenDim}
        onClose={() => setTableOpenDim(null)}
        title={tableOpenDim ? (DIMENSIONS[tableOpenDim]?.label || tableOpenDim) : ''}
        kicker="Full data · sortable · exportable"
        data={tableOpenDim === 'institutions'
          ? institutionsFiltered
          : (tableOpenDim ? (state[tableOpenDim]?.data || []) : [])}
        filterable={tableOpenDim ? !!DIMENSIONS[tableOpenDim]?.filterable : false}
        selectedKeys={tableOpenDim ? selKeys(tableOpenDim) : []}
        onToggleFilter={tableOpenDim && DIMENSIONS[tableOpenDim]?.filterable
          ? (item) => toggleFilter(tableOpenDim, item)
          : undefined}
        onClearAllInDim={tableOpenDim
          ? () => {
              setFilters((prev) => {
                const next = { ...prev };
                delete next[tableOpenDim];
                return next;
              });
            }
          : undefined}
      />
    </div>
  );
}
