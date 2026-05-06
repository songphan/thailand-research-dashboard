# Thailand Research Output · OpenAlex Dashboard

A live, policy-oriented dashboard of scholarly works with at least one Thai institutional affiliation, drawn from the OpenAlex knowledge graph. Built with Vite, React, Tailwind, and Recharts.

The dashboard breaks the year's output down by producing institution, publisher, document type, field and subfield, open access pathway, language, international co-authorship reach, UN Sustainable Development Goal alignment, acknowledged funder, and most-cited works.

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Vite will open the dashboard at http://localhost:5173. Pick a year from the masthead to refilter every panel; press Refresh to re-fetch.

## Build for production

```bash
npm run build
npm run preview
```

The static site is emitted to `dist/`. `npm run preview` serves it locally on port 4173 for a final check before deploying.

## Push to GitHub

From the project folder, after creating an empty repo on github.com:

```bash
git init
git add .
git commit -m "Initial dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/thailand-research-dashboard.git
git push -u origin main
```

If GitHub asks for credentials, use a Personal Access Token (Settings, Developer settings, Personal access tokens, Tokens classic) instead of your account password.

## Deploy

### Vercel (easiest)

Sign in at vercel.com with your GitHub account, click *Import Project*, pick this repo, accept defaults. Vercel detects Vite automatically. No environment variables required.

### Netlify

Sign in at netlify.com, click *Add new site, Import an existing project*, pick the repo. Build command `npm run build`, publish directory `dist`. Done.

### GitHub Pages

```bash
npm install -D gh-pages
```

Add to `package.json`:

```json
"scripts": {
  "deploy": "npm run build && gh-pages -d dist"
}
```

Edit `vite.config.js` and change `base: './'` to `base: '/thailand-research-dashboard/'` (or whatever your repo is named). Then:

```bash
npm run deploy
```

In the repo settings on GitHub, set Pages source to the `gh-pages` branch.

## Data source

All counts come from the OpenAlex Works API filtered by `authorships.institutions.country_code:TH` and the selected publication year. SDG and topic tags use OpenAlex in-house classifiers; the topic taxonomy is hierarchical (domain, field, subfield, topic).

No API key is required. For routine use, register your email with OpenAlex by appending `&mailto=you@example.com` to each request URL in `src/Dashboard.jsx`. This puts you in the polite pool, which gives more generous rate limits.

## Caveats

- 2025 is still being indexed. Crossref deposits and OpenAlex affiliation parsing continue for months after the calendar year ends, so the absolute count for the current year will keep rising.
- OpenAlex has reported reduced affiliation metadata coverage for some 2025 articles, particularly from Elsevier journals. The dashboard surfaces this in the methods card.
- For institutional reporting, triangulate with Scopus (`AFFILCOUNTRY(Thailand) AND PUBYEAR IS YYYY`), Web of Science, and Dimensions. Differences across sources reflect coverage and affiliation-parsing rules, not errors.

## Structure

```
thailand-research-dashboard/
├── index.html              Google Fonts and Vite mount
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
└── src/
    ├── App.jsx             Thin wrapper
    ├── Dashboard.jsx       The full dashboard component
    ├── index.css           Tailwind directives and global resets
    └── main.jsx            React mount point
```

## License

OpenAlex data is released under CC0. Dashboard code is offered under the MIT License; adapt freely.
