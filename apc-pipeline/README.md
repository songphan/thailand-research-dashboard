# APC spend pipeline

This folder adds an estimate of national Article Processing Charge (APC) spend by publisher to the Thailand Research dashboard. It answers one question: how much do Thai-affiliated corresponding authors pay, at list price, in open access fees to each major publisher.

## What it produces

A new dashboard panel, "Estimated APC spend by publisher," that shows spend in USD (primary) and THB (secondary) for the years selected in the masthead, a price match rate, a per-publisher breakdown, and a methods and caveats note. The panel reads a single precomputed file, `../src/data/apc_by_publisher.json`.

## Why a precompute step

Every other panel in the dashboard uses OpenAlex `group_by` aggregations, which return counts only. APC cost cannot be produced that way because OpenAlex has no facet that sums APC across a query. Estimating a national total requires walking the individual works for each year, reading each one's open access status and APC fields, attaching a price, and adding them up. That iteration runs once, offline, here. The dashboard then loads the small result file instantly.

## The two scripts

`build_reference.py` parses the five curated publisher price lists in `../apc/` into one normalized table, `apc_reference.json`, keyed by ISSN with USD, EUR, and GBP prices, business model (fully open access, hybrid, subsidized, none), and a provenance tag. It covers Elsevier, Wiley, and Springer Nature. Run it whenever you update or add a publisher list.

```
pip install openpyxl pdfplumber
python build_reference.py
```

`precompute_apc.mjs` pulls Thai works from OpenAlex per year, prices them against the reference table, and writes `../src/data/apc_by_publisher.json`. Requires Node 18 or newer and an OpenAlex API key.

```
export OPENALEX_API_KEY=oax_your_key_here   # get one free at https://openalex.org/settings/api
node precompute_apc.mjs
```

After it finishes, reload the dashboard. The panel switches from the "awaiting precompute" placeholder to live figures.

## Methodology

Corpus. Works with at least one Thai institutional affiliation from OpenAlex, restricted at query time to Gold and Hybrid open access. Only these two pathways incur an APC; Diamond, Green, Bronze, and Closed do not.

Attribution. A work counts toward Thailand only when a corresponding author is Thai-affiliated, since APC liability normally sits with the corresponding author's institution. This avoids inflating the national total through international co-authorship. When OpenAlex has flagged no corresponding author for a work, the script falls back to the first listed author. The split between the two methods is reported in the output as `attribution_methods`.

Pricing. Each work is priced in this order: the curated publisher reference matched by ISSN first, because those 2026 lists are current and are the only reliable source of hybrid prices; then OpenAlex `apc_list.value_usd`, which draws largely on DOAJ for fully open access journals; then OpenAlex `apc_paid.value_usd`. Works that match none of these are counted but not summed, and the share that received a price is reported as the match rate. The mix of price sources is reported as `price_sources`.

Currency. The headline figure is USD, because OpenAlex and all three publisher lists carry a USD value. THB is shown alongside using a per-year average exchange rate documented in `currency.thb_per_usd` inside the output file. Edit those rates in `precompute_apc.mjs` to match your preferred source, such as the Bank of Thailand annual average.

## The unpriced-journal worklist (targeted collection)

Every run of `precompute_apc.mjs` also writes `unpriced_journals.json` and `unpriced_journals.csv`: the journals that actually appear in Thailand's Gold and Hybrid output but received no price, aggregated by journal and ranked by Thai work count. The console prints how many of these are Taylor & Francis, Routledge, or Dove.

This is the worklist for targeted publisher collection. Rather than harvesting all of a publisher's journals, collect APCs only for the journals on this list, because those are the only ones that move the national estimate. For Taylor & Francis specifically, whose Open Access Cost Finder has no bulk export and prices one journal at a time by article type and country, this list turns an intractable 2,568-journal crawl into a bounded set (typically a few hundred or fewer). Add the collected prices as a normal publisher file in `../apc/` and rerun both scripts.

## What the estimate is and is not

The figure is an estimated list-price ceiling, not actual spend. Real outlay is lower wherever a transformative or read-and-publish agreement, an institutional membership, or a negotiated discount applies. Thailand is an upper-middle-income country, so it generally does not receive the automatic full APC waivers publishers grant low and lower-middle-income countries, which makes the list-price approach more defensible here than it would be for a lower-income setting. The credibility of any year's number rests on its match rate, which the panel shows prominently. Treat a low match rate as a signal to extend the reference table, not as a reason to distrust the priced portion.

## Adding publishers: drop a file in, no code edits

`build_reference.py` ingests every file in `../apc/`. The five validated lists (Elsevier, Wiley, Springer Nature) use explicit parsers. Any other file you drop in is handled by a generic auto-detector that finds the header row, the ISSN column, the title, and the USD, EUR, and GBP columns on its own. So to add a publisher you do not edit code. You:

1. Download the publisher's APC price list as `.xlsx`, `.csv`, or `.pdf`.
2. Name the file with the publisher and a model hint, for example `Taylor & Francis hybrid APC 2026.xlsx` or `SAGE open access APCs.csv`. The publisher and the business model (hybrid versus fully open access) are read from the file name.
3. Drop it in `../apc/` and run `python build_reference.py`, then `node precompute_apc.mjs`.

The builder prints a verification block for every auto-detected file, headed "Auto-detected files (VERIFY THESE)", showing the publisher it inferred, the columns it locked onto, the row and priced counts, and three sample rows. Check that block before trusting a new list. If it could not find an ISSN or a currency column, it says so, and you may need to tidy the file (delete banner rows above the table, or rename columns to include the word ISSN and a currency code) and rerun.

The auto-detector was validated against the existing Elsevier and Wiley files: run through the generic path they reproduce the same ISSNs and prices as the bespoke parsers, including the Wiley layout where currency codes sit on a second header row. A PDF list is detected the same way as long as its table has a clear header row.

## Which publishers to fetch, and why these

Fully open access houses such as MDPI, Frontiers, PLOS, Hindawi, and PeerJ are already priced automatically at run time by the pipeline's OpenAlex `apc_list` and DOAJ fallback, so they need no file. The manual effort is worth spending only on the hybrid-heavy subscription publishers, whose hybrid APCs neither OpenAlex nor DOAJ carries reliably. In rough order of likely Thai output: Taylor and Francis, SAGE, Oxford University Press, Cambridge University Press, the American Chemical Society, IEEE, Emerald, the Royal Society of Chemistry, IOP Publishing, Wolters Kluwer, Karger, Thieme, and De Gruyter. Each of these publishes an APC or open access price list on its website; search the publisher name with "APC price list" to find the current file. The file name keywords for all of these are already mapped, so a file named after the publisher is attributed to a tidy display name automatically.

A note on retrieval. These lists must be downloaded by hand because publisher sites are outside the sandbox's network allowlist, so the assistant cannot fetch them for you. Once a file is in `../apc/`, rerunning the two scripts wires it in.
