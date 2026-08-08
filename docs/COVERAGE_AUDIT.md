# Four-firm Coverage Audit

Audit date: 2026-08-09 (Asia/Taipei)

Scope: McKinsey & Company, BCG, Deloitte, PwC public research metadata collected by `scripts/update_reports.py`.

## Baseline before crawler quality fixes

Database snapshot: `2026-08-08T17:09:53Z` (2026-08-09 01:09:53 Asia/Taipei)

| Company | Rows | Usable dated research | Baseline verdict | Main finding |
|---|---:|---:|---|---|
| McKinsey | 0 | 0 | FAIL | Current official Insights/MGI pages had recent research, but discovery returned no stored records. |
| BCG | 6 | 6 | PARTIAL | Article URLs were valid, but publication dates were parsed incorrectly. |
| Deloitte | 50 | ~6 | FAIL | The first-link cap was consumed by topic/industry/research-center navigation pages. |
| PwC | 49 | 0 | FAIL | Almost all stored rows were service/category pages rather than dated research. |

## External spot checks used for the audit

### McKinsey

Official Insights and MGI pages showed current material including:

- `Escaping the pilot trap: Building HR for the agentic era` — 2026-08-04
- `How do we reach universal prosperity by 2100?` — 2026-08-05
- `The global balance sheet 2026: Imbalance and divergence` — 2026-07-23

Baseline database contained no McKinsey rows.

### BCG

Official `Most Recent Insights` showed:

- `AI-First Procurement: How Autonomous Agents Drive Competitive Advantage` — 2026-08-07
- `The Unexpected Ways GLP-1s Are Transforming Consumer Behavior` — 2026-08-06
- `Do You Own Your Enterprise Cortex?` — 2026-08-06
- `The AI-First Asset Manager` — 2026-08-06
- `How CEOs Can Make the Most of Their Time After Leaving the Corner Office` — 2026-08-05
- `Entrepreneurial Capitalism Will Be Built City by City` — 2026-08-05

The baseline database had these article URLs, but dates were several days earlier, proving that page metadata date selection was unreliable.

### Deloitte

Official Deloitte Insights currently highlights real articles such as:

- `2026 Deloitte Back-to-School Survey`
- `AI adoption to adaptation`
- `Rewiring the enterprise operating model for AI scale`

The baseline database instead contained many undated hub pages such as `Industry`, `Operations`, `Strategy`, `Technology management`, and research-center landing pages.

### PwC

Official PwC pages expose dated research such as:

- `The AI advantage hiding in risk management` — 2026-07-20
- `Where to play in the increasingly diverse data centre economy` — 2026-07-14
- Energy, utilities & resources publications with 2026-06/07 items
- Public Sector Research Centre with 2026 research items

The baseline database contained 49 PwC rows, almost all undated service pages such as `Consulting services`, `Deals`, `Global tax services`, and `Workforce`.

## Root causes

1. Discovery scanned document links in DOM order and stopped after 50 candidates, allowing site-wide navigation to consume the budget.
2. `looks_like_report()` only validated URL paths; it did not distinguish a research article from a service/category landing page.
3. Date parsing handled ISO/numeric dates but not common English publication labels such as `August 7, 2026` or `09 July 2026`.
4. Date extraction trusted page metadata before the visible publication date. BCG exposed a concrete counterexample where this produced wrong dates.
5. Legacy undated false positives were preserved forever because the database merge never pruned them.
6. PwC's global site mixes research, issues, industries, and services heavily, so one generic landing page is insufficient for useful coverage.

## Fixes deployed

- Search inside `<main>` first and skip links inside `nav/header/footer`.
- Rank all candidate links before applying the per-source cap instead of stopping at the first links encountered.
- Boost article-like paths and links whose surrounding card text contains a publication date.
- Parse both `Month DD, YYYY` and `DD Month YYYY` publication formats.
- Prefer a visible date near the article H1 over potentially stale metadata dates.
- Require a valid publication date before a page can enter the research database.
- Purge legacy undated rows on the next successful refresh while preserving dated historical research.
- Expand PwC sources to Today’s Issues, C-suite Insights, Energy Publications, and the Public Sector Research Centre.
- Add `scripts/audit_coverage.py` for repeatable four-company quality checks.

## Automated acceptance criteria

`python scripts/audit_coverage.py` returns PASS only when:

- all four companies have at least 3 dated rows;
- each company's latest stored report is no older than 60 days;
- there are no undated rows;
- there are no duplicate URLs.

The automated gate is intentionally a minimum coverage test, not proof of exhaustive indexing. Periodic external spot checks against each firm's official latest page remain necessary when site structures change.
