import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  CartesianGrid, LabelList
} from 'recharts';
import {
  TrendingUp, BookOpen, Globe2, Sparkles, RefreshCw, AlertCircle, Database,
  Building2, Newspaper, FileText, Layers, Languages, Target, Banknote, Loader2
} from 'lucide-react';

const OPENALEX_BASE = 'https://api.openalex.org';

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

// Inject editorial typography
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

// Country code to name (a small, useful subset for collaborators)
const COUNTRIES = {
  TH: 'Thailand', US: 'United States', CN: 'China', JP: 'Japan', GB: 'United Kingdom',
  DE: 'Germany', AU: 'Australia', KR: 'South Korea', IN: 'India', FR: 'France',
  CA: 'Canada', NL: 'Netherlands', IT: 'Italy', SG: 'Singapore', MY: 'Malaysia',
  ID: 'Indonesia', VN: 'Vietnam', PH: 'Philippines', LA: 'Laos', KH: 'Cambodia',
  MM: 'Myanmar', TW: 'Taiwan', HK: 'Hong Kong', CH: 'Switzerland', SE: 'Sweden',
  ES: 'Spain', BE: 'Belgium', AT: 'Austria', DK: 'Denmark', NO: 'Norway',
  FI: 'Finland', BR: 'Brazil', NZ: 'New Zealand', IE: 'Ireland', IL: 'Israel',
  RU: 'Russia', PL: 'Poland', CZ: 'Czechia', PT: 'Portugal', GR: 'Greece',
  TR: 'Türkiye', SA: 'Saudi Arabia', AE: 'UAE', EG: 'Egypt', ZA: 'South Africa',
  PK: 'Pakistan', BD: 'Bangladesh', NP: 'Nepal', LK: 'Sri Lanka', MX: 'Mexico',
  CL: 'Chile', AR: 'Argentina',
};

const countryName = (code) => COUNTRIES[code] || code;

const LANG_NAMES = {
  en: 'English', th: 'Thai', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian',
  it: 'Italian', id: 'Indonesian', vi: 'Vietnamese', ms: 'Malay',
};

const TYPE_NAMES = {
  article: 'Journal article',
  'book-chapter': 'Book chapter',
  book: 'Book',
  dissertation: 'Dissertation',
  preprint: 'Preprint',
  dataset: 'Dataset',
  review: 'Review',
  paratext: 'Paratext',
  editorial: 'Editorial',
  letter: 'Letter',
  report: 'Report',
  'reference-entry': 'Reference entry',
  standard: 'Standard',
  'peer-review': 'Peer review',
  erratum: 'Erratum',
  other: 'Other',
};

// Fetcher with timeout and JSON parse
async function fetchJson(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Build a base filter
const baseFilter = (year) => `authorships.institutions.country_code:TH,publication_year:${year}`;

// Group-by query
const groupUrl = (year, groupBy, perPage = 200) =>
  `${OPENALEX_BASE}/works?filter=${baseFilter(year)}&group_by=${groupBy}&per-page=${perPage}`;

// Total count (per-page=1 for efficiency)
const countUrl = (year, extraFilter = '') =>
  `${OPENALEX_BASE}/works?filter=${baseFilter(year)}${extraFilter ? ',' + extraFilter : ''}&per-page=1`;

// Top works by citations
const topWorksUrl = (year) =>
  `${OPENALEX_BASE}/works?filter=${baseFilter(year)}&sort=cited_by_count:desc&per-page=10&select=id,doi,title,cited_by_count,authorships,primary_location,type,open_access`;

// Institution metadata batch lookup
const institutionsBatchUrl = (ids) =>
  `${OPENALEX_BASE}/institutions?filter=openalex:${ids.join('|')}&per-page=200&select=id,display_name,country_code,type,ror`;

// ---------- UI components ----------

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

const HBar = ({ data, labelKey = 'label', valueKey = 'value', height = 320, color = PALETTE.navy, accentTop = false }) => {
  if (!data || data.length === 0) {
    return <div style={{ color: PALETTE.muted, fontFamily: FONT_BODY, fontSize: 13 }} className="px-3 py-6">No data.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
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
        <Bar dataKey={valueKey} radius={[0, 1, 1, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={accentTop && i === 0 ? PALETTE.burgundy : color} />
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

const Donut = ({ data, height = 280, colorMap }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
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
            >
              {data.map((d, i) => (
                <Cell key={i} fill={(colorMap && colorMap[d.key]) || SERIES[i % SERIES.length]} />
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
        {data.map((d, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span
              className="mt-1.5 inline-block h-2 w-2 flex-none rounded-full"
              style={{ background: (colorMap && colorMap[d.key]) || SERIES[i % SERIES.length] }}
            />
            <span style={{ color: PALETTE.charcoal }} className="flex-1">{d.label}</span>
            <span style={{ fontFamily: FONT_MONO, color: PALETTE.ink, fontWeight: 500 }}>{fmtFull(d.value)}</span>
            <span style={{ fontFamily: FONT_MONO, color: PALETTE.muted, fontSize: 10, width: 44 }} className="text-right">
              {pct(d.value, total)}
            </span>
          </li>
        ))}
      </ul>
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

// ---------- Main component ----------

export default function ThailandResearchDashboard() {
  useFonts();

  const [year, setYear] = useState(2025);
  const [refreshKey, setRefreshKey] = useState(0);

  // Granular state per panel so failures don't block siblings
  const [state, setState] = useState({});

  const setPanel = (key, patch) =>
    setState((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));

  useEffect(() => {
    let cancelled = false;

    const run = async (key, url, transform) => {
      setPanel(key, { status: 'loading', error: null, data: null });
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

    // Total
    run('total', countUrl(year), (j) => j?.meta?.count ?? 0);

    // Open access slice
    run('oaCount', countUrl(year, 'is_oa:true'), (j) => j?.meta?.count ?? 0);

    // International collaboration slice (works that include >1 country)
    // We approximate as: total minus works with only TH on authorship countries.
    // Simpler approach: count works that have any non-TH country.
    // OpenAlex doesn't directly support "not equal" on multi-valued fields easily,
    // so we derive from group-by collaborators below.

    // Document types
    run('docTypes', groupUrl(year, 'type'), (j) =>
      (j.group_by || []).map((g) => ({
        key: g.key,
        label: TYPE_NAMES[g.key] || g.key_display_name || g.key,
        value: g.count,
      })).filter(d => d.value > 0)
    );

    // OA status (gold/green/hybrid/bronze/closed/diamond)
    run('oaStatus', groupUrl(year, 'open_access.oa_status'), (j) =>
      (j.group_by || []).map((g) => ({
        key: g.key,
        label: g.key.charAt(0).toUpperCase() + g.key.slice(1),
        value: g.count,
      })).filter(d => d.value > 0)
    );

    // Languages
    run('languages', groupUrl(year, 'language'), (j) =>
      (j.group_by || [])
        .map((g) => ({
          key: g.key,
          label: LANG_NAMES[g.key] || g.key_display_name || g.key,
          value: g.count,
        }))
        .filter((d) => d.value > 0)
        .slice(0, 8)
    );

    // Fields (broad disciplines, ~26 across OpenAlex)
    run('fields', groupUrl(year, 'primary_topic.field.id'), (j) =>
      (j.group_by || [])
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 32), value: g.count }))
        .filter((d) => d.value > 0)
        .slice(0, 14)
    );

    // Subfields (granular disciplines)
    run('subfields', groupUrl(year, 'primary_topic.subfield.id'), (j) =>
      (j.group_by || [])
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 38), value: g.count }))
        .filter((d) => d.value > 0)
        .slice(0, 12)
    );

    // Publishers
    run('publishers', groupUrl(year, 'primary_location.source.host_organization'), (j) =>
      (j.group_by || [])
        .filter((g) => g.key && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 36), value: g.count }))
        .slice(0, 12)
    );

    // International collaborators (countries on the work other than TH)
    run('collaborators', groupUrl(year, 'authorships.countries'), (j) => {
      const all = j.group_by || [];
      const filtered = all
        .filter((g) => g.key && g.key !== 'TH' && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: countryName(g.key), value: g.count }))
        .slice(0, 14);
      return filtered;
    });

    // SDGs
    run('sdgs', groupUrl(year, 'sustainable_development_goals.id'), (j) => {
      const arr = (j.group_by || [])
        .map((g) => {
          const num = (g.key || '').match(/\/(\d+)$/)?.[1];
          const label = num ? `SDG ${num} · ${g.key_display_name}` : g.key_display_name;
          return { key: g.key, label: cleanLabel(label, 42), value: g.count };
        })
        .filter((d) => d.value > 0);
      return arr.slice(0, 14);
    });

    // Funders
    run('funders', groupUrl(year, 'grants.funder'), (j) =>
      (j.group_by || [])
        .filter((g) => g.key && g.key !== 'unknown')
        .map((g) => ({ key: g.key, label: cleanLabel(g.key_display_name, 38), value: g.count }))
        .slice(0, 12)
    );

    // Institutions: group_by then filter to Thai by metadata batch lookup
    run('institutions', groupUrl(year, 'authorships.institutions.id'), async (j) => {
      const top = (j.group_by || []).slice(0, 60);
      if (top.length === 0) return [];
      const ids = top.map((g) => stripPrefix(g.key));
      const meta = await fetchJson(institutionsBatchUrl(ids));
      const byId = {};
      (meta.results || []).forEach((inst) => {
        byId[stripPrefix(inst.id)] = inst;
      });
      return top
        .map((g) => {
          const id = stripPrefix(g.key);
          const m = byId[id];
          return {
            key: g.key,
            label: cleanLabel(g.key_display_name, 38),
            value: g.count,
            country: m?.country_code,
            type: m?.type,
          };
        })
        .filter((d) => d.country === 'TH')
        .slice(0, 15);
    });

    // Top cited works
    run('topWorks', topWorksUrl(year), (j) =>
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
        thAffil: (w.authorships || []).some((a) =>
          (a.institutions || []).some((i) => i.country_code === 'TH')
        ),
      }))
    );

    return () => {
      cancelled = true;
    };
  }, [year, refreshKey]);

  // Derived metrics
  const totalCount = state.total?.data;
  const oaCount = state.oaCount?.data;
  const collabSum = useMemo(() => {
    const arr = state.collaborators?.data;
    if (!arr) return null;
    // Approximate count of works with international co-authorship by max non-TH count.
    // The proper number is the count of works where any country != TH appears.
    // Recharts data already gives this; we use the largest single country as a lower bound, but
    // the true number is bounded above by sum and below by max. We surface a separate query for accuracy.
    return null;
  }, [state.collaborators]);

  // Separate true count for international collaboration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Works with at least one TH author AND at least one author from another country.
        // OpenAlex supports: institutions_distinct_count > 1 alongside TH filter, but the cleanest
        // proxy is is_authors_truncated + countries_distinct_count > 1. We use countries_distinct_count.
        const url = `${OPENALEX_BASE}/works?filter=${baseFilter(year)},countries_distinct_count:>1&per-page=1`;
        setPanel('intlCount', { status: 'loading' });
        const j = await fetchJson(url);
        if (cancelled) return;
        setPanel('intlCount', { status: 'ready', data: j?.meta?.count ?? 0 });
      } catch (e) {
        if (cancelled) return;
        setPanel('intlCount', { status: 'error', error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [year, refreshKey]);

  const intlCount = state.intlCount?.data;

  const topInstitution = state.institutions?.data?.[0];
  const topField = state.fields?.data?.[0];

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: `radial-gradient(1200px 600px at 10% -10%, ${PALETTE.cream} 0%, ${PALETTE.paper} 60%, ${PALETTE.paper} 100%)`,
        color: PALETTE.ink,
        fontFamily: FONT_BODY,
      }}
    >
      {/* Editorial header */}
      <header
        className="border-b"
        style={{ borderColor: PALETTE.ink, background: PALETTE.paper }}
      >
        <div className="mx-auto max-w-[1400px] px-6 pt-6 pb-5">
          <div className="flex items-center justify-between gap-4">
            <div
              style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.22em' }}
              className="uppercase"
            >
              Bibliometric Brief · OpenAlex · TH
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
                  fontStyle: 'normal',
                  fontSize: 'clamp(36px, 4.6vw, 60px)',
                  lineHeight: 0.98,
                  letterSpacing: '-0.018em',
                  color: PALETTE.ink,
                }}
              >
                Thailand <em style={{ fontStyle: 'italic', color: PALETTE.burgundy }}>Research</em> Output
              </h1>
              <p
                className="mt-3 max-w-2xl"
                style={{ fontFamily: FONT_BODY, fontSize: 14, color: PALETTE.charcoal, lineHeight: 1.55 }}
              >
                A live, policy-oriented breakdown of scholarly works with at least one Thai institutional affiliation,
                drawn from the OpenAlex knowledge graph. Counts update as publishers deposit new metadata; treat 2025 as still ripening.
              </p>
            </div>
            <div className="flex items-center gap-3">
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
                aria-label="Refresh"
              >
                <RefreshCw size={13} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stat strip */}
      <section className="mx-auto max-w-[1400px] px-6 pt-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            kicker="Total works · TH affiliated"
            value={totalCount != null ? fmtFull(totalCount) : '—'}
            sub={`Records in OpenAlex with ≥1 author at a Thai institution in ${year}.`}
            accent={PALETTE.ink}
            loading={state.total?.status === 'loading'}
          />
          <StatCard
            kicker="Open access share"
            value={
              totalCount && oaCount != null
                ? pct(oaCount, totalCount)
                : '—'
            }
            sub={oaCount != null && totalCount ? `${fmtFull(oaCount)} of ${fmtFull(totalCount)} works are openly readable.` : 'Loading slice…'}
            accent={PALETTE.gold}
            loading={state.oaCount?.status === 'loading' || state.total?.status === 'loading'}
          />
          <StatCard
            kicker="International co-authorship"
            value={
              totalCount && intlCount != null
                ? pct(intlCount, totalCount)
                : '—'
            }
            sub={intlCount != null && totalCount ? `${fmtFull(intlCount)} works include ≥2 country affiliations.` : 'Loading slice…'}
            accent={PALETTE.teal}
            loading={state.intlCount?.status === 'loading' || state.total?.status === 'loading'}
          />
          <StatCard
            kicker="Top contributor · TH"
            value={
              topInstitution ? (
                <span style={{ fontSize: 22, lineHeight: 1.15, fontStyle: 'italic' }}>
                  {topInstitution.label}
                </span>
              ) : '—'
            }
            sub={topInstitution ? `${fmtFull(topInstitution.value)} works · ${pct(topInstitution.value, totalCount || 0)} of national output` : 'Loading…'}
            accent={PALETTE.burgundy}
            loading={state.institutions?.status === 'loading'}
          />
        </div>
      </section>

      {/* Main grid */}
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Institutions */}
          <Card className="p-5 lg:col-span-7">
            <SectionTitle
              icon={Building2}
              kicker="Producing institutions"
              title="Where the research happens"
              hint="Top 15 Thai institutions by works count"
            />
            <ChartFrame
              status={state.institutions?.status}
              error={state.institutions?.error}
              hint="Filtered to institutions with country_code = TH after group-by lookup."
            >
              <HBar data={state.institutions?.data || []} height={420} color={PALETTE.navy} accentTop />
            </ChartFrame>
          </Card>

          {/* Fields */}
          <Card className="p-5 lg:col-span-5">
            <SectionTitle
              icon={Layers}
              kicker="Disciplinary mix"
              title="Fields of inquiry"
              hint="OpenAlex primary_topic.field"
            />
            <ChartFrame status={state.fields?.status} error={state.fields?.error}>
              <HBar data={state.fields?.data || []} height={420} color={PALETTE.burgundy} />
            </ChartFrame>
          </Card>

          {/* Document types */}
          <Card className="p-5 lg:col-span-4">
            <SectionTitle
              icon={FileText}
              kicker="Output forms"
              title="Document types"
            />
            <ChartFrame status={state.docTypes?.status} error={state.docTypes?.error}>
              <Donut data={(state.docTypes?.data || []).slice(0, 7)} height={260} />
            </ChartFrame>
          </Card>

          {/* OA Status */}
          <Card className="p-5 lg:col-span-4">
            <SectionTitle
              icon={BookOpen}
              kicker="Access regime"
              title="Open access pathways"
              hint="Gold · Green · Hybrid · Bronze · Closed"
            />
            <ChartFrame status={state.oaStatus?.status} error={state.oaStatus?.error}>
              <Donut data={state.oaStatus?.data || []} height={260} colorMap={OA_COLORS} />
            </ChartFrame>
          </Card>

          {/* Languages */}
          <Card className="p-5 lg:col-span-4">
            <SectionTitle
              icon={Languages}
              kicker="Language of record"
              title="Publication languages"
            />
            <ChartFrame status={state.languages?.status} error={state.languages?.error}>
              <Donut data={state.languages?.data || []} height={260} />
            </ChartFrame>
          </Card>

          {/* Publishers */}
          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Newspaper}
              kicker="Publishing channels"
              title="Top publishers carrying Thai output"
              hint="Host organisation of the primary location"
            />
            <ChartFrame status={state.publishers?.status} error={state.publishers?.error}>
              <HBar data={state.publishers?.data || []} height={380} color={PALETTE.teal} />
            </ChartFrame>
          </Card>

          {/* Subfields */}
          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Sparkles}
              kicker="Granular topics"
              title="Active subfields"
              hint="OpenAlex primary_topic.subfield"
            />
            <ChartFrame status={state.subfields?.status} error={state.subfields?.error}>
              <HBar data={state.subfields?.data || []} height={380} color={PALETTE.forest} />
            </ChartFrame>
          </Card>

          {/* Collaborators */}
          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Globe2}
              kicker="Co-authorship reach"
              title="International collaborators"
              hint="Country counts on works with ≥1 TH author"
            />
            <ChartFrame
              status={state.collaborators?.status}
              error={state.collaborators?.error}
              hint="A work appears in every co-author country it includes; numbers therefore exceed total works."
            >
              <HBar data={state.collaborators?.data || []} height={420} color={PALETTE.plum} />
            </ChartFrame>
          </Card>

          {/* SDGs */}
          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={Target}
              kicker="Mission alignment"
              title="UN Sustainable Development Goals"
              hint="OpenAlex SDG classifier"
            />
            <ChartFrame status={state.sdgs?.status} error={state.sdgs?.error}>
              <HBar data={state.sdgs?.data || []} height={420} color={PALETTE.gold} />
            </ChartFrame>
          </Card>

          {/* Funders */}
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
              hint="Many works lack funder metadata in Crossref; absence in this list does not mean absence of funding."
            >
              <HBar data={state.funders?.data || []} height={380} color={PALETTE.rust} />
            </ChartFrame>
          </Card>

          {/* Top cited works */}
          <Card className="p-5 lg:col-span-6">
            <SectionTitle
              icon={TrendingUp}
              kicker="Visibility"
              title="Most-cited works of the year"
              hint="Live ranking; very recent works under-cite"
            />
            <ChartFrame status={state.topWorks?.status} error={state.topWorks?.error}>
              <ol className="space-y-3">
                {(state.topWorks?.data || []).map((w, i) => (
                  <li key={w.id} className="flex gap-3 border-b pb-3 last:border-b-0" style={{ borderColor: PALETTE.rule }}>
                    <div
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontStyle: 'italic',
                        color: PALETTE.burgundy,
                        fontSize: 22,
                        lineHeight: 1,
                        width: 32,
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
                          fontFamily: FONT_DISPLAY,
                          fontWeight: 500,
                          color: PALETTE.ink,
                          fontSize: 14,
                          lineHeight: 1.3,
                          textDecoration: 'none',
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
                              fontFamily: FONT_MONO,
                              background: PALETTE.gold,
                              color: PALETTE.paper,
                              padding: '1px 6px',
                              fontSize: 9,
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
                        fontFamily: FONT_MONO,
                        color: PALETTE.ink,
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
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

        {/* Methods note */}
        <Card className="mt-6 p-6">
          <SectionTitle
            icon={Database}
            kicker="Methods & caveats"
            title="On reading these numbers"
          />
          <div
            className="grid grid-cols-1 gap-5 md:grid-cols-3"
            style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: PALETTE.charcoal, lineHeight: 1.6 }}
          >
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">Source</div>
              All counts come from the OpenAlex Works API filtered by{' '}
              <code style={{ fontFamily: FONT_MONO, background: PALETTE.cream, padding: '1px 4px' }}>authorships.institutions.country_code:TH</code>{' '}
              and the selected publication year. SDG and topic tags use OpenAlex’s in-house classifiers; topic taxonomy is hierarchical (domain → field → subfield → topic).
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">2025 caveat</div>
              The current year is still being indexed. Crossref deposits and OpenAlex affiliation parsing continue for months after the calendar year ends. OpenAlex has reported reduced affiliation metadata coverage for 2025 articles, particularly from some commercial publishers, so the absolute count is conservative.
            </div>
            <div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.16em', color: PALETTE.muted }} className="uppercase mb-1.5">Cross-checks</div>
              For institutional reporting, triangulate against Scopus (<code style={{ fontFamily: FONT_MONO }}>AFFILCOUNTRY(Thailand) AND PUBYEAR IS {year}</code>), Web of Science, and Dimensions. Differences between sources reflect coverage and affiliation-parsing rules, not errors.
            </div>
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer
        className="border-t"
        style={{ borderColor: PALETTE.rule, background: PALETTE.paper }}
      >
        <div
          className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-2 px-6 py-5 md:flex-row md:items-center"
          style={{ fontFamily: FONT_MONO, fontSize: 10, color: PALETTE.muted, letterSpacing: '0.12em' }}
        >
          <div className="uppercase">
            Data · OpenAlex.org (CC0) · openalex.org/works
          </div>
          <div className="uppercase">
            Live API · No caching · Counts may shift between loads
          </div>
        </div>
      </footer>
    </div>
  );
}
