import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  CartesianGrid, LabelList
} from 'recharts';
import {
  TrendingUp, BookOpen, Globe2, Sparkles, RefreshCw, AlertCircle, Database,
  Building2, Newspaper, FileText, Layers, Languages, Target, Banknote, Loader2, X,
  Table as TableIcon, Download, Search, ChevronDown
} from 'lucide-react';

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
const buildFilterString = (country, year, filters, excludeDim = null) => {
  const parts = [`authorships.institutions.country_code:${country}`, `publication_year:${year}`];
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

async function fetchJson(url, timeoutMs = 25000, attempt = 0) {
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
      // Retry on transient failures: 429 (rate limit), 502/503/504 (gateway/timeout).
      // Use exponential backoff with jitter; this matters most when OPENALEX_API_KEY
      // is not set or when many parallel calls fire (the dashboard fires ~14 on load).
      const isTransient = res.status === 429 || res.status >= 502;
      const maxAttempts = res.status === 429 ? 4 : 2;
      if (isTransient && attempt < maxAttempts) {
        clearTimeout(t);
        // 800ms, 1.6s, 3.2s, 6.4s base + 0-600ms jitter
        const base = 800 * Math.pow(2, attempt);
        const wait = base + Math.random() * 600;
        await new Promise((r) => setTimeout(r, wait));
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

// Paginate group_by results past OpenAlex's 200-per-page cap using their
// group_by_continuation_token. We cap at maxPages to avoid runaway loops.
// The API returns groups in descending count order, so the first 200 covers
// the bulk of the distribution; pagination matters for long-tail dimensions
// where many entities share small counts (e.g. all Thai institutions).
async function fetchAllGroups(filterStr, groupBy, maxPages = 5) {
  const all = [];
  let token = null;
  for (let page = 0; page < maxPages; page++) {
    const tokenParam = token ? `&group_by_continuation_token=${encodeURIComponent(token)}` : '';
    const url = withMailto(
      `${OPENALEX_BASE}/works?filter=${filterStr}&group_by=${groupBy}&per-page=200${tokenParam}`
    );
    const j = await fetchJson(url);
    const batch = j.group_by || [];
    all.push(...batch);
    token = j.group_by_continuation_token;
    if (!token || batch.length === 0) break;
  }
  return all;
}

const Card = ({ children, className = '', style = {} }) => (
  <div
    className={`rounded-md ${className}`}
    style={{
      background: PALETTE.paper,
      border: `1px solid ${PALETTE.rule}`,
      boxShadow: '0 1px 0 rgba(26,22,18,0.03)',
      ...style,
    }}
  >
    {children}
  </div>
);

const SectionTitle = ({ icon: Icon, kicker, title, hint }) => (
  <div className="mb-4 flex items-start justify-between gap-3">
    <div className="flex items-start gap-3">
      {Icon && (
        <div
          className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-sm"
          style={{ background: PALETTE.ink, color: PALETTE.cream }}
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
  color = PALETTE.navy, accentTop = false, onBarClick, selectedKeys = []
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
          width={170}
          tick={{ fill: PALETTE.charcoal, fontFamily: FONT_BODY, fontSize: 11 }}
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

// Small toggle pill used for the institution type/subcategory filters.
const InstPill = ({ active, onClick, label, subtle = false }) => (
  <button
    onClick={onClick}
    className="rounded-sm px-2 py-1 transition-colors"
    style={{
      border: `1px solid ${active ? PALETTE.ink : PALETTE.rule}`,
      background: active ? PALETTE.ink : 'transparent',
      color: active ? PALETTE.cream : (subtle ? PALETTE.muted : PALETTE.charcoal),
      fontFamily: FONT_MONO,
      fontSize: subtle ? 10 : 11,
      letterSpacing: '0.04em',
    }}
  >
    {label}
  </button>
);

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

// OpenAlex institution.type values (per https://docs.openalex.org/api-entities/institutions).
// We surface these as filter pills above the institutions chart.
const INSTITUTION_TYPES = [
  { key: 'education',  label: 'Education' },
  { key: 'healthcare', label: 'Healthcare' },
  { key: 'government', label: 'Government' },
  { key: 'company',    label: 'Company' },
  { key: 'nonprofit',  label: 'Nonprofit' },
  { key: 'facility',   label: 'Facility' },
  { key: 'archive',    label: 'Archive' },
  { key: 'funder',     label: 'Funder' },
  { key: 'other',      label: 'Other' },
];

// Education-subcategory derivation. OpenAlex doesn't expose this directly, so we
// classify by keywords in the institution display_name. Order matters: more specific
// patterns come first. Falls back to 'other-education' for anything not matched.
const EDUCATION_SUBCATEGORIES = [
  { key: 'university',     label: 'University',         test: (n) => /\b(university|universiti|universität|universidad|université|universita|มหาวิทยาลัย)\b/i.test(n) },
  { key: 'institute',      label: 'Institute',          test: (n) => /\b(institute of technology|technological institute|polytechnic|institute)\b/i.test(n) },
  { key: 'college',        label: 'College',            test: (n) => /\b(college|วิทยาลัย)\b/i.test(n) },
  { key: 'school',         label: 'School',             test: (n) => /\b(school|academy|conservatory)\b/i.test(n) },
  { key: 'medical-school', label: 'Medical school',     test: (n) => /\b(medical|medicine)\s+(school|college|center|centre)\b/i.test(n) },
  { key: 'research-ed',    label: 'Research centre',    test: (n) => /\b(research|laboratory|laboratorium|center|centre)\b/i.test(n) },
];
const subcategoryFor = (name) => {
  if (!name) return 'other-education';
  for (const sc of EDUCATION_SUBCATEGORIES) {
    if (sc.test(name)) return sc.key;
  }
  return 'other-education';
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

export default function ResearchOutputDashboard() {
  useFonts();

  // Country code drives the entire dashboard. Default Thailand; persisted in localStorage
  // so reloads remember the last choice. Validated against ISO regex below.
  const [country, setCountry] = useState(() => {
    if (typeof window === 'undefined') return 'TH';
    const saved = window.localStorage?.getItem('dashboard.country');
    return /^[A-Z]{2}$/.test(saved || '') ? saved : 'TH';
  });

  const [year, setYear] = useState(2025);
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

  const setLimit = (dim) => (n) => setDisplayLimits((s) => ({ ...s, [dim]: n }));
  const limitFor = (dim) => displayLimits[dim] ?? DEFAULT_LIMITS[dim] ?? 12;
  const sliceFor = (dim) => (state[dim]?.data || []).slice(0, limitFor(dim));

  // Apply local type/subcategory filters to the institutions chart data.
  // The full list (post-pagination) is in state.institutions.data; we narrow it
  // in-memory rather than re-querying OpenAlex.
  const institutionsFiltered = useMemo(() => {
    const all = state.institutions?.data || [];
    let filtered = all;
    if (instTypeFilter !== 'all') {
      filtered = filtered.filter((d) => d.type === instTypeFilter);
    }
    if (instSubcategoryFilter !== 'all') {
      filtered = filtered.filter((d) => d.subcategory === instSubcategoryFilter);
    }
    return filtered;
  }, [state.institutions?.data, instTypeFilter, instSubcategoryFilter]);

  // Available subcategories: only show subcategory pills if the user has selected
  // 'education' as the type filter (or if we have any education institutions in
  // the data, which we do by default).
  const subcategoriesPresent = useMemo(() => {
    const all = state.institutions?.data || [];
    const set = new Set();
    for (const d of all) {
      if (d.type === 'education' && d.subcategory) set.add(d.subcategory);
    }
    return EDUCATION_SUBCATEGORIES.filter((sc) => set.has(sc.key))
      .concat(set.has('other-education') ? [{ key: 'other-education', label: 'Other education' }] : []);
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

  const filterStrings = useMemo(() => {
    const m = { all: buildFilterString(country, year, filters) };
    Object.keys(DIMENSIONS).forEach((d) => {
      m[d] = buildFilterString(country, year, filters, d);
    });
    return m;
  }, [country, year, filters]);

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

    // Institutions: paginate the group_by past the 200-per-page cap so we capture
    // all Thai institutions (as of late 2025 there are ~260+). The metadata lookup
    // also batched, so we end up with full type and subcategory tags for filtering.
    setPanel('institutions', { status: 'loading', error: null });
    (async () => {
      try {
        const top = await fetchAllGroups(filterStrings.institutions, 'authorships.institutions.id', 5);
        if (cancelled) return;
        if (top.length === 0) {
          setPanel('institutions', { status: 'ready', data: [] });
          return;
        }
        const ids = top.map((g) => stripPrefix(g.key));
        const insts = await fetchInstitutionsMetadata(ids);
        if (cancelled) return;
        const byId = {};
        insts.forEach((inst) => {
          byId[stripPrefix(inst.id)] = inst;
        });
        const data = top
          .map((g) => {
            const id = stripPrefix(g.key);
            const m = byId[id];
            const type = m?.type || 'other';
            return {
              key: g.key,
              label: cleanLabel(g.key_display_name, 38),
              fullLabel: m?.display_name || g.key_display_name,
              value: g.count,
              country: m?.country_code,
              type,
              subcategory: type === 'education' ? subcategoryFor(m?.display_name || g.key_display_name) : null,
            };
          })
          .filter((d) => d.country === country);
        setPanel('institutions', { status: 'ready', data });
      } catch (e) {
        if (cancelled) return;
        setPanel('institutions', { status: 'error', error: e.message || 'Fetch failed' });
      }
    })();

    return () => { cancelled = true; };
  }, [year, refreshKey, filterStrings]);

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
              <div className="flex items-center gap-1 rounded-sm" style={{ border: `1px solid ${PALETTE.ink}` }}>
                {YEARS.map((y) => (
                  <button
                    key={y}
                    onClick={() => setYear(y)}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      letterSpacing: '0.04em',
                      background: y === year ? PALETTE.ink : 'transparent',
                      color: y === year ? PALETTE.cream : PALETTE.ink,
                    }}
                    className="px-3 py-1.5 transition-colors"
                  >
                    {y}
                  </button>
                ))}
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

          <FilterBreadcrumb
            filters={filters}
            onRemove={removeFilter}
            onClear={clearFilters}
            innerRef={breadcrumbAnchorRef}
          />
        </div>
      </header>

      <section className="mx-auto max-w-[1400px] px-6 pt-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Card className="p-5 lg:col-span-12">
            <SectionTitle
              icon={Building2}
              kicker="Producing institutions"
              title="Where the research happens"
              hint={`All ${countryName(country)} institutions · click bar to filter dashboard`}
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
                    subtle
                  />
                ))}
              </div>
            )}
            <ChartFrame
              status={state.institutions?.status}
              error={state.institutions?.error}
              hint={
                institutionsFiltered.length === 0 && (state.institutions?.data || []).length > 0
                  ? 'No institutions match the active type/subcategory filter.'
                  : `Showing ${institutionsFiltered.length} of ${(state.institutions?.data || []).length} ${countryName(country)} institutions.`
              }
            >
              <HBar
                data={institutionsFiltered.slice(0, limitFor('institutions'))}
                color={PALETTE.navy}
                accentTop
                onBarClick={onPick('institutions')}
                selectedKeys={selKeys('institutions')}
              />
              <ChartControls
                total={institutionsFiltered.length}
                limit={limitFor('institutions')}
                onLimitChange={setLimit('institutions')}
                onOpenTable={() => setTableOpenDim('institutions')}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Layers}
              kicker="Disciplinary mix"
              title="Fields of inquiry"
              hint="OpenAlex primary_topic.field"
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

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Sparkles}
              kicker="Granular topics"
              title="Active subfields"
              hint="OpenAlex primary_topic.subfield"
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

          <Card className="p-5 lg:col-span-4">
            <SectionTitle icon={FileText} kicker="Output forms" title="Document types" />
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

          <Card className="p-5 lg:col-span-4">
            <SectionTitle
              icon={BookOpen}
              kicker="Access regime"
              title="Open access pathways"
              hint="Gold · Green · Hybrid · Bronze · Closed"
            />
            <ChartFrame status={state.oaStatus?.status} error={state.oaStatus?.error}>
              <Donut
                data={sliceFor('oaStatus')}
                height={260}
                colorMap={OA_COLORS}
                onSliceClick={onPick('oaStatus')}
                selectedKeys={selKeys('oaStatus')}
              />
              <ChartControls
                total={(state.oaStatus?.data || []).length}
                limit={limitFor('oaStatus')}
                onLimitChange={setLimit('oaStatus')}
                onOpenTable={() => setTableOpenDim('oaStatus')}
                options={[5, 6]}
              />
            </ChartFrame>
          </Card>

          <Card className="p-5 lg:col-span-4">
            <SectionTitle icon={Languages} kicker="Language of record" title="Publication languages" />
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

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Newspaper}
              kicker="Publishing channels"
              title={`Top publishers carrying ${countryName(country)} output`}
              hint="Host organisation of the primary location"
            />
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
          </Card>

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Globe2}
              kicker="Co-authorship reach"
              title="International collaborators"
              hint={`${countryName(country)} excluded from list`}
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
              {/* Domestic-collaboration summary */}
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

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Target}
              kicker="Mission alignment"
              title="UN Sustainable Development Goals"
              hint="OpenAlex SDG classifier"
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

          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Banknote}
              kicker="Funding landscape"
              title="Acknowledged funders"
              hint="From grants metadata; coverage is partial"
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

          <Card className="p-5 lg:col-span-12">
            <SectionTitle
              icon={TrendingUp}
              kicker="Visibility"
              title="Most-cited works in selection"
              hint="Live ranking; very recent works under-cite"
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
