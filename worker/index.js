import { SOURCES, TOPICS } from './config.generated.js';

const EXCLUDES = [
  '/careers','/about','/contact','/locations','/people','/privacy','/terms','/cookies',
  '/events','/search','/login','/subscribe','/newsletter','/sitemap','/services/'
];
const MAX_PER_SOURCE = 4;
const REVALIDATE_PER_RUN = 4;
const UA = 'ConsultantSystemBot/3.0 (+https://github.com/linwuyen/Consultant_System; metadata-only research index)';
const COMPANIES = ['McKinsey','BCG','Deloitte','PwC'];

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }
});
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const escLike = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m);
const shaId = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))))
  .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);

async function syncSources(env) {
  for (const source of SOURCES) {
    await env.DB.prepare(`
      INSERT INTO sources(company,name,url,enabled)
      VALUES(?,?,?,1)
      ON CONFLICT(url) DO UPDATE SET company=excluded.company,name=excluded.name,enabled=1
    `).bind(source.company, source.name, source.url).run();
  }
}

async function bootstrapIfEmpty(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first();
  if (Number(row?.n || 0) > 0) return;
  try {
    const response = await fetch('https://raw.githubusercontent.com/linwuyen/Consultant_System/main/data/reports.json', {
      headers: { 'user-agent': UA }
    });
    if (!response.ok) return;
    const payload = await response.json();
    const items = (payload.reports || [])
      .filter((item) => item.url && item.title && item.company && item.date)
      .slice(0, 1000);
    const ts = now();
    for (let i = 0; i < items.length; i += 40) {
      const batch = items.slice(i, i + 40).map((item) => env.DB.prepare(`
        INSERT OR IGNORE INTO reports(
          id,company,title,published_at,url,description,topics_json,source_name,
          discovered_at,last_seen_at,active,last_checked_at,failure_count,last_http_status
        ) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,0,200)
      `).bind(
        item.id || crypto.randomUUID(), item.company, item.title, item.date, item.url,
        item.description || '', JSON.stringify(item.topics || []), item.source_name || item.company,
        item.discovered_at || ts, item.last_seen_at || ts, ts
      ));
      if (batch.length) await env.DB.batch(batch);
    }
  } catch (error) {
    console.log('bootstrap failed', error?.message || error);
  }
}

function stripTags(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function metaAttr(html, key, val) {
  const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+${key}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${escaped}["'][^>]*>`, 'i');
  const match = html.match(re);
  return stripTags(match?.[1] || match?.[2] || '');
}
function canonical(base, href) {
  try {
    const url = new URL(href, base);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}
function sameHost(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}
function validCandidate(url, source) {
  const path = new URL(url).pathname.toLowerCase();
  return sameHost(url, source.url)
    && source.allow.some((prefix) => path.startsWith(prefix.toLowerCase()))
    && !EXCLUDES.some((part) => path.includes(part))
    && path.split('/').filter(Boolean).length >= 2;
}
function linksFrom(html, source) {
  const output = [];
  const seen = new Set();
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(main))) {
    const url = canonical(source.url, match[1]);
    if (!url || seen.has(url) || !validCandidate(url, source)) continue;
    seen.add(url);
    const text = stripTags(match[2]);
    const path = new URL(url).pathname;
    let score = 0;
    if (/\/20\d{2}\//.test(path)) score += 8;
    if (/article|report|survey|insight|research|publication|outlook|trend|future|ai|economic/i.test(`${path} ${text}`)) score += 3;
    if (/overview|index|center|centre|topics?$|industry$|industries$/i.test(path)) score -= 6;
    output.push({ url, score });
  }
  return output.sort((a, b) => b.score - a.score).slice(0, MAX_PER_SOURCE).map((item) => item.url);
}
function normalizeDate(raw = '') {
  raw = stripTags(raw).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const match = raw.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}
function inferTopics(text = '') {
  const lower = text.toLowerCase();
  return Object.entries(TOPICS)
    .filter(([, words]) => words.some((word) => lower.includes(word.toLowerCase())))
    .map(([topic]) => topic)
    .slice(0, 6);
}
function extract(html, url, source) {
  let title = metaAttr(html, 'property', 'og:title') || metaAttr(html, 'name', 'twitter:title');
  if (!title) title = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  if (!title) title = stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  title = title.replace(/\s+[|–-]\s+(McKinsey.*|BCG|Deloitte.*|PwC.*)$/i, '').trim().slice(0, 300);

  const description = (metaAttr(html, 'property', 'og:description') || metaAttr(html, 'name', 'description') || '').slice(0, 700);

  const timeMatch = html.match(/<time\b[^>]*(?:datetime=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/time>/i);
  const jsonLdDate = html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1] || '';
  const metaDate = metaAttr(html, 'property', 'article:published_time')
    || metaAttr(html, 'name', 'date')
    || metaAttr(html, 'name', 'publish-date')
    || metaAttr(html, 'name', 'publication_date');
  const date = normalizeDate(timeMatch?.[1] || stripTags(timeMatch?.[2] || '') || jsonLdDate || metaDate);

  if (!title || title.length < 5 || !date) return null;
  return {
    title,
    description,
    date,
    topics: inferTopics(`${title} ${description}`),
    url,
    company: source.company,
    source_name: source.name,
  };
}

function parseRobots(text) {
  const groups = [];
  let current = { agents: [], rules: [] };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (current.rules.length) {
        groups.push(current);
        current = { agents: [], rules: [] };
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current.agents.length) {
      current.rules.push({ type: key, path: value });
    }
  }
  if (current.agents.length || current.rules.length) groups.push(current);
  return groups;
}
function robotsAllows(groups, url) {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const ua = UA.toLowerCase();
  const relevant = groups.filter((group) => group.agents.some((agent) => agent === '*' || ua.includes(agent)));
  let best = null;
  for (const group of relevant) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      if (path.startsWith(rule.path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.type === 'allow'))) {
        best = rule;
      }
    }
  }
  return !best || best.type === 'allow';
}
async function robotsAllowed(url, cache) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (!cache.has(origin)) {
    try {
      const response = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': UA } });
      cache.set(origin, response.ok ? parseRobots(await response.text()) : []);
    } catch {
      cache.set(origin, []);
    }
  }
  return robotsAllows(cache.get(origin), url);
}
async function fetchText(url, robotsCache) {
  if (!(await robotsAllowed(url, robotsCache))) {
    const error = new Error('robots_disallowed');
    error.code = 'ROBOTS';
    throw error;
  }
  const response = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.8' },
    redirect: 'follow'
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('not_html');
  return response.text();
}

async function upsertReport(env, item, checkedAt) {
  const id = await shaId(`${item.company}|${item.url}`);
  await env.DB.prepare(`
    INSERT INTO reports(
      id,company,title,published_at,url,description,topics_json,source_name,
      discovered_at,last_seen_at,active,last_checked_at,failure_count,last_http_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,0,200)
    ON CONFLICT(url) DO UPDATE SET
      company=excluded.company,
      title=excluded.title,
      published_at=excluded.published_at,
      description=excluded.description,
      topics_json=excluded.topics_json,
      source_name=excluded.source_name,
      last_seen_at=excluded.last_seen_at,
      active=1,
      last_checked_at=excluded.last_checked_at,
      failure_count=0,
      last_http_status=200
  `).bind(
    id, item.company, item.title, item.date, item.url, item.description,
    JSON.stringify(item.topics), item.source_name, checkedAt, checkedAt, checkedAt
  ).run();
}

async function revalidateExisting(env, robotsCache) {
  const rows = await env.DB.prepare(`
    SELECT id,url FROM reports
    WHERE active=1
    ORDER BY COALESCE(last_checked_at,last_seen_at,discovered_at) ASC
    LIMIT ?
  `).bind(REVALIDATE_PER_RUN).all();
  let inactive = 0;
  for (const row of rows.results || []) {
    const checkedAt = now();
    try {
      if (!(await robotsAllowed(row.url, robotsCache))) continue;
      const response = await fetch(row.url, { method: 'HEAD', headers: { 'user-agent': UA }, redirect: 'follow' });
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('UPDATE reports SET active=0,last_checked_at=?,failure_count=failure_count+1,last_http_status=? WHERE id=?')
          .bind(checkedAt, response.status, row.id).run();
        inactive += 1;
      } else if (response.ok || (response.status >= 300 && response.status < 400)) {
        await env.DB.prepare('UPDATE reports SET last_checked_at=?,failure_count=0,last_http_status=? WHERE id=?')
          .bind(checkedAt, response.status, row.id).run();
      } else {
        await env.DB.prepare('UPDATE reports SET last_checked_at=?,failure_count=failure_count+1,last_http_status=? WHERE id=?')
          .bind(checkedAt, response.status, row.id).run();
      }
    } catch {
      await env.DB.prepare('UPDATE reports SET last_checked_at=?,failure_count=failure_count+1 WHERE id=?')
        .bind(checkedAt, row.id).run();
    }
  }
  return inactive;
}

function ageDays(date) {
  if (!date) return Infinity;
  const ms = Date.now() - new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : Infinity;
}
async function computeCoverage(env, persist = false) {
  const result = await env.DB.prepare(`
    SELECT company,COUNT(*) AS records,
      SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS dated,
      MAX(published_at) AS latest
    FROM reports WHERE active=1 GROUP BY company ORDER BY company
  `).all();
  const map = Object.fromEntries((result.results || []).map((row) => [row.company, row]));
  const companies = COMPANIES.map((company) => {
    const row = map[company] || {};
    const records = Number(row.records || 0);
    const dated = Number(row.dated || 0);
    const latest = row.latest || null;
    const age = ageDays(latest);
    let status = 'FAIL';
    if (records >= 3 && dated === records && age <= 60) status = 'PASS';
    else if (records > 0 && dated > 0 && age <= 120) status = 'PARTIAL';
    return { company, records, dated, undated: records - dated, latest, age_days: Number.isFinite(age) ? age : null, status };
  });
  const overall = companies.every((item) => item.status === 'PASS') ? 'PASS'
    : companies.some((item) => item.status === 'FAIL') ? 'FAIL' : 'PARTIAL';
  const audit = { checked_at: now(), status: overall, companies };
  if (persist) {
    await env.DB.prepare('INSERT INTO coverage_audits(checked_at,status,detail_json) VALUES(?,?,?)')
      .bind(audit.checked_at, audit.status, JSON.stringify(companies)).run();
  }
  return audit;
}

async function refreshAll(env) {
  await syncSources(env);
  const startedAt = now();
  const run = await env.DB.prepare("INSERT INTO crawl_runs(started_at,status) VALUES(?,'running') RETURNING id").bind(startedAt).first();
  const robotsCache = new Map();
  let discovered = 0;
  let upserted = 0;
  let errors = 0;
  const detail = {};

  for (const source of SOURCES) {
    let sourceCount = 0;
    try {
      const listing = await fetchText(source.url, robotsCache);
      const links = linksFrom(listing, source);
      discovered += links.length;
      for (const url of links) {
        try {
          const item = extract(await fetchText(url, robotsCache), url, source);
          if (!item) continue;
          const checkedAt = now();
          await upsertReport(env, item, checkedAt);
          upserted += 1;
          sourceCount += 1;
        } catch (error) {
          errors += 1;
          console.log('article fetch failed', source.name, url, error?.message || error);
        }
      }
      await env.DB.prepare('UPDATE sources SET last_success_at=?,last_error=NULL WHERE url=?').bind(now(), source.url).run();
      detail[source.name] = { status: 'ok', records: sourceCount, candidates: links.length };
    } catch (error) {
      errors += 1;
      const message = String(error?.message || error).slice(0, 500);
      detail[source.name] = { status: error?.code === 'ROBOTS' ? 'robots_disallowed' : 'error', error: message };
      await env.DB.prepare('UPDATE sources SET last_error=? WHERE url=?').bind(message, source.url).run();
    }
  }

  const inactivated = await revalidateExisting(env, robotsCache);
  const coverage = await computeCoverage(env, true);
  const finishedAt = now();
  const runStatus = coverage.status === 'FAIL' ? 'coverage_fail' : errors ? 'partial' : 'success';
  await env.DB.prepare(`
    UPDATE crawl_runs SET finished_at=?,status=?,discovered=?,upserted=?,error_count=?,detail_json=? WHERE id=?
  `).bind(finishedAt, runStatus, discovered, upserted, errors, JSON.stringify({ ...detail, revalidation: { inactivated }, coverage }), run?.id).run();

  return { started_at: startedAt, finished_at: finishedAt, status: runStatus, discovered, upserted, errors, inactivated, detail, coverage };
}

async function apiReports(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') || 50)));
  const where = ['active=1'];
  const binds = [];
  const q = params.get('q')?.trim();
  if (q) {
    const value = `%${escLike(q)}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR topics_json LIKE ? ESCAPE '\\')");
    binds.push(value, value, value);
  }
  if (params.get('company')) { where.push('company=?'); binds.push(params.get('company')); }
  if (params.get('topic')) { where.push("topics_json LIKE ? ESCAPE '\\'"); binds.push(`%${escLike('"' + params.get('topic') + '"')}%`); }
  if (params.get('year')) { where.push('published_at LIKE ?'); binds.push(`${params.get('year')}%`); }
  const sort = {
    'date-asc': 'published_at ASC',
    company: 'company ASC, published_at DESC',
    title: 'title ASC',
    'date-desc': 'published_at DESC'
  }[params.get('sort') || 'date-desc'] || 'published_at DESC';
  const predicate = where.join(' AND ');
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE ${predicate}`).bind(...binds).first();
  const result = await env.DB.prepare(`
    SELECT id,company,title,published_at AS date,url,description,topics_json,source_name,
      discovered_at,last_seen_at,last_checked_at,failure_count,last_http_status
    FROM reports WHERE ${predicate} ORDER BY ${sort} LIMIT ? OFFSET ?
  `).bind(...binds, pageSize, (page - 1) * pageSize).all();
  return json({
    reports: (result.results || []).map((row) => ({ ...row, topics: JSON.parse(row.topics_json || '[]'), topics_json: undefined })),
    total: Number(count?.n || 0), page, page_size: pageSize
  });
}
async function apiStats(env) {
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) dated,
      MAX(published_at) latest
    FROM reports WHERE active=1
  `).first();
  const companies = await env.DB.prepare(`
    SELECT company,COUNT(*) records,
      SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) dated,
      MAX(published_at) latest
    FROM reports WHERE active=1 GROUP BY company ORDER BY company
  `).all();
  const crawl = await env.DB.prepare('SELECT * FROM crawl_runs ORDER BY id DESC LIMIT 1').first();
  return json({
    updated_at: crawl?.finished_at || null,
    total: Number(totals?.total || 0),
    dated: Number(totals?.dated || 0),
    latest: totals?.latest || null,
    companies: companies.results || [],
    last_crawl: crawl || null
  });
}
async function apiFilters(env) {
  const companies = await env.DB.prepare('SELECT DISTINCT company FROM reports WHERE active=1 ORDER BY company').all();
  const years = await env.DB.prepare("SELECT DISTINCT substr(published_at,1,4) year FROM reports WHERE active=1 AND published_at IS NOT NULL ORDER BY year DESC").all();
  const topicRows = await env.DB.prepare('SELECT topics_json FROM reports WHERE active=1').all();
  const topics = [...new Set((topicRows.results || []).flatMap((row) => {
    try { return JSON.parse(row.topics_json || '[]'); } catch { return []; }
  }))].sort();
  return json({
    companies: (companies.results || []).map((row) => row.company),
    years: (years.results || []).map((row) => row.year),
    topics
  });
}
async function exportRows(env) {
  const result = await env.DB.prepare(`
    SELECT id,company,title,published_at AS date,url,description,topics_json,source_name,
      discovered_at,last_seen_at,last_checked_at,active
    FROM reports WHERE active=1 ORDER BY published_at DESC,company,title LIMIT 5000
  `).all();
  return (result.results || []).map((row) => ({ ...row, topics: JSON.parse(row.topics_json || '[]'), topics_json: undefined }));
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
async function apiExportJson(env) {
  const reports = await exportRows(env);
  return new Response(JSON.stringify({ exported_at: now(), reports }, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="consultant-reports.json"'
    }
  });
}
async function apiExportCsv(env) {
  const reports = await exportRows(env);
  const fields = ['id','company','title','date','url','description','topics','source_name','discovered_at','last_seen_at','last_checked_at','active'];
  const lines = [fields.join(',')];
  for (const report of reports) {
    const row = { ...report, topics: (report.topics || []).join('|') };
    lines.push(fields.map((field) => csvEscape(row[field])).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="consultant-reports.csv"'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      await syncSources(env);
      await bootstrapIfEmpty(env);
      if (url.pathname === '/api/health') {
        const version = await env.DB.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").first();
        const crawl = await env.DB.prepare('SELECT finished_at,status FROM crawl_runs ORDER BY id DESC LIMIT 1').first();
        return json({ ok: true, database: 'D1', worker: 'consultant-system', schema_version: version?.value || null, last_crawl: crawl || null, time: now() });
      }
      if (url.pathname === '/api/reports' && request.method === 'GET') return apiReports(request, env);
      if (url.pathname === '/api/stats' && request.method === 'GET') return apiStats(env);
      if (url.pathname === '/api/filters' && request.method === 'GET') return apiFilters(env);
      if (url.pathname === '/api/coverage' && request.method === 'GET') return json(await computeCoverage(env, false));
      if (url.pathname === '/api/export.json' && request.method === 'GET') return apiExportJson(env);
      if (url.pathname === '/api/export.csv' && request.method === 'GET') return apiExportCsv(env);
      if (url.pathname === '/api/refresh' && request.method === 'POST') {
        const token = request.headers.get('x-admin-token');
        if (!env.ADMIN_TOKEN) return json({ error: 'manual_refresh_not_configured' }, 503);
        if (token !== env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
        return json(await refreshAll(env));
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'internal_error', message: String(error?.message || error) }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshAll(env));
  }
};
