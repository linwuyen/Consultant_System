# Four-firm Coverage Audit

Audit baseline date: 2026-08-09 (Asia/Taipei)

Scope: McKinsey & Company, BCG, Deloitte, PwC public research metadata.

## Baseline before crawler quality fixes

Initial JSON snapshot: `2026-08-08T17:09:53Z`.

| Company | Rows | Usable dated research | Baseline verdict | Main finding |
|---|---:|---:|---|---|
| McKinsey | 0 | 0 | FAIL | Current official Insights/MGI pages had recent research, but discovery returned no stored records. |
| BCG | 6 | 6 | PARTIAL | Article URLs were valid, but publication dates were parsed incorrectly. |
| Deloitte | 50 | ~6 | FAIL | Topic/industry/research-center navigation pages consumed the discovery budget. |
| PwC | 49 | 0 | FAIL | Service/category pages dominated instead of dated research. |

## Production audit path

The production system no longer treats the legacy JSON audit as the authoritative gate.

Cloudflare Worker refresh now performs:

```text
official source pages
↓
robots.txt check
↓
ranked article discovery
↓
valid publication-date extraction
↓
D1 upsert
↓
limited stale URL revalidation
↓
D1 four-firm coverage audit
↓
coverage_audits history
```

Current endpoint:

```text
GET /api/coverage
```

## Acceptance criteria

Per company:

- `PASS`
  - at least 3 active records;
  - every active record included in the aggregate has a publication date;
  - latest report is no older than 60 days.
- `PARTIAL`
  - at least one dated active record;
  - latest report is no older than 120 days.
- `FAIL`
  - no usable recent coverage.

Production workflow behavior:

- any company `FAIL` → final workflow quality gate fails;
- `PARTIAL` → warning, deployment and fallback snapshot remain available;
- all `PASS` → full coverage pass.

The audit is intentionally a minimum quality gate, not proof of exhaustive indexing.

## Source-of-truth policy

Canonical source configuration is:

```text
config/sources.json
```

`scripts/generate_worker_config.mjs` generates the Worker deployment config from it. This prevents the Python fallback crawler and the Cloudflare Worker from drifting into different source lists.

## Data-quality protections now implemented

- `<main>`-first discovery and ranked links instead of first-N DOM order.
- Research/article-like path scoring.
- Publication date required before a discovered page enters D1.
- Visible `<time>` date preferred before JSON-LD/meta fallback.
- Metadata-only storage; no full article mirroring.
- robots.txt enforcement before listing/article fetches.
- 404/410 revalidation marks stale records inactive.
- `last_checked_at`, `failure_count`, and `last_http_status` stored in D1.
- Coverage history stored in `coverage_audits`.
- D1 JSON/CSV exports are used to keep GitHub Pages fallback snapshots synchronized.

## Legacy audit

`scripts/audit_coverage.py` remains useful only for the manual emergency JSON fallback workflow. It is no longer the production source of truth.
