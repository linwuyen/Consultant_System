const state = { db: null, rows: [], total: 0, page: 1, pageSize: 50, view: 'table', stats: null };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' });
};
const pct = (n, d) => d ? `${Math.round(n / d * 100)}%` : '0%';
const ageDays = (value) => {
  if (!value) return Infinity;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isNaN(time) ? Infinity : Math.max(0, Math.floor((Date.now() - time) / 86400000));
};
const fmtUpdated = (value) => value ? new Date(value).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false }) : '—';
const likeEscape = (value) => String(value).replace(/[\\%_]/g, (m) => `\\${m}`);

function query(sql, params = []) {
  const stmt = state.db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}
function scalar(sql, params = [], fallback = null) {
  const rows = query(sql, params);
  if (!rows.length) return fallback;
  const first = rows[0];
  const key = Object.keys(first)[0];
  return first[key] ?? fallback;
}
function metaValue(key) {
  return scalar('SELECT value FROM meta WHERE key = ?', [key], '');
}
function addOptions(id, items) {
  for (const item of items) $(id).insertAdjacentHTML('beforeend', `<option value="${esc(item)}">${esc(item)}</option>`);
}
function setupFilters() {
  addOptions('company', query('SELECT DISTINCT company FROM reports ORDER BY company').map((r) => r.company));
  addOptions('topic', query('SELECT name FROM topics ORDER BY name').map((r) => r.name));
  addOptions('year', query("SELECT DISTINCT substr(published_at,1,4) AS year FROM reports WHERE published_at IS NOT NULL ORDER BY year DESC").map((r) => r.year));
}
function loadStats() {
  const companies = query(`
    SELECT company, COUNT(*) AS records,
      SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS dated,
      MAX(published_at) AS latest
    FROM reports GROUP BY company ORDER BY company
  `);
  return {
    updated_at: metaValue('updated_at'),
    total: Number(scalar('SELECT COUNT(*) FROM reports', [], 0)),
    dated: Number(scalar('SELECT COUNT(*) FROM reports WHERE published_at IS NOT NULL', [], 0)),
    latest: scalar('SELECT MAX(published_at) FROM reports', [], null),
    companies
  };
}
function renderDashboard() {
  const stats = state.stats || {};
  const total = Number(stats.total || 0);
  const dated = Number(stats.dated || 0);
  const latest = stats.latest || '';
  const topicCount = Number(scalar('SELECT COUNT(*) FROM topics', [], 0));
  $('kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total records</div><div class="kpi-value">${total.toLocaleString()}</div><div class="kpi-sub">SQLite research records</div></div>
    <div class="kpi"><div class="kpi-label">Dated records</div><div class="kpi-value">${pct(dated,total)}</div><div class="kpi-sub">${dated.toLocaleString()} 筆有發布日期</div></div>
    <div class="kpi"><div class="kpi-label">Latest publication</div><div class="kpi-value">${fmtDate(latest)}</div><div class="kpi-sub">${Number.isFinite(ageDays(latest)) ? `${ageDays(latest)} 天前` : '尚無日期'}</div></div>
    <div class="kpi"><div class="kpi-label">Topic dimension</div><div class="kpi-value">${topicCount}</div><div class="kpi-sub">normalized topic rows</div></div>`;
  $('updatedAt').textContent = `SQLite 更新 ${fmtUpdated(stats.updated_at)}`;
  const hours = stats.updated_at ? (Date.now() - new Date(stats.updated_at).getTime()) / 3600000 : Infinity;
  $('freshness').className = `freshness ${hours <= 36 ? 'good' : hours <= 72 ? '' : 'bad'}`;
  $('freshness').innerHTML = `<span class="dot"></span><span>SQLite / WASM · ${hours <= 36 ? '資料新鮮' : hours <= 72 ? '資料需留意' : '資料可能過期'}</span>`;
  const map = Object.fromEntries((stats.companies || []).map((row) => [row.company, row]));
  $('coverage').innerHTML = ['McKinsey','BCG','Deloitte','PwC'].map((name) => {
    const company = map[name] || { records:0, dated:0, latest:null };
    const records = Number(company.records || 0);
    const companyDated = Number(company.dated || 0);
    const age = ageDays(company.latest);
    let level = 'bad', label = 'FAIL';
    if (records >= 3 && companyDated === records && age <= 60) { level = 'good'; label = 'PASS'; }
    else if (records > 0 && companyDated > 0 && age <= 120) { level = 'warn'; label = 'PARTIAL'; }
    return `<div class="coverage-card"><div class="coverage-top"><span class="coverage-name">${name}</span><span class="badge ${level}">${label}</span></div><div class="coverage-numbers"><div class="metric-mini"><strong>${records}</strong><span>Records</span></div><div class="metric-mini"><strong>${pct(companyDated,records)}</strong><span>Dated</span></div><div class="metric-mini"><strong>${fmtDate(company.latest)}</strong><span>Latest</span></div><div class="metric-mini"><strong>${records-companyDated}</strong><span>Undated</span></div></div></div>`;
  }).join('');
}
function buildWhere() {
  const clauses = [];
  const params = [];
  const q = $('q').value.trim().toLowerCase();
  const company = $('company').value;
  const topic = $('topic').value;
  const year = $('year').value;
  if (q) {
    clauses.push("r.search_text LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(q)}%`);
  }
  if (company) { clauses.push('r.company = ?'); params.push(company); }
  if (topic) {
    clauses.push('EXISTS (SELECT 1 FROM report_topics rt0 WHERE rt0.report_id = r.id AND rt0.topic = ?)');
    params.push(topic);
  }
  if (year) { clauses.push("substr(r.published_at,1,4) = ?"); params.push(year); }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
function orderSql() {
  return ({
    'date-asc': 'ORDER BY r.published_at IS NULL, r.published_at ASC, r.title ASC',
    company: 'ORDER BY r.company ASC, r.published_at DESC, r.title ASC',
    title: 'ORDER BY r.title COLLATE NOCASE ASC',
    'date-desc': 'ORDER BY r.published_at IS NULL, r.published_at DESC, r.title ASC'
  })[$('sort').value] || 'ORDER BY r.published_at DESC';
}
function loadRecords(reset = true) {
  if (reset) state.page = 1;
  state.pageSize = Number($('pageSize').value) || 50;
  $('resultCount').textContent = '查詢中…';
  const where = buildWhere();
  state.total = Number(scalar(`SELECT COUNT(*) FROM reports r ${where.sql}`, where.params, 0));
  const offset = (state.page - 1) * state.pageSize;
  state.rows = query(`
    SELECT r.id, r.company, r.title, r.published_at AS date, r.url, r.description, r.source_name,
      COALESCE((SELECT GROUP_CONCAT(topic, '|||') FROM report_topics rt WHERE rt.report_id = r.id), '') AS topics_blob
    FROM reports r
    ${where.sql}
    ${orderSql()}
    LIMIT ? OFFSET ?
  `, [...where.params, state.pageSize, offset]).map((row) => ({ ...row, topics: row.topics_blob ? row.topics_blob.split('|||') : [] }));
  renderRecords();
}
function renderTable(rows) {
  $('tableBody').innerHTML = rows.map((row) => `<tr><td class="date-cell">${fmtDate(row.date)}</td><td class="company-cell">${esc(row.company)}</td><td><a class="title-link" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.title)} ↗</a>${row.description ? `<div class="row-desc">${esc(row.description)}</div>` : ''}</td><td><div class="tags">${(row.topics || []).map((topic) => `<span class="tag">${esc(topic)}</span>`).join('') || '<span class="tag">未分類</span>'}</div></td><td><a class="source-link" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.source_name || '官方來源')}</a></td></tr>`).join('');
}
function renderCards(rows) {
  $('cardView').innerHTML = rows.map((row) => `<article class="research-card"><div class="card-meta"><strong>${esc(row.company)}</strong><span>·</span><span>${fmtDate(row.date)}</span></div><h3><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.title)} ↗</a></h3>${row.description ? `<p>${esc(row.description)}</p>` : ''}<div class="tags">${(row.topics || []).map((topic) => `<span class="tag">${esc(topic)}</span>`).join('')}</div></article>`).join('');
}
function renderRecords() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  renderTable(state.rows);
  renderCards(state.rows);
  $('resultCount').textContent = `${state.total.toLocaleString()} 筆符合條件`;
  $('activeFilters').textContent = ' · SQLite query';
  $('qualityInline').innerHTML = '<span class="quality-chip">SQLite / WASM SQL</span>';
  $('empty').hidden = state.total !== 0;
  $('tableView').hidden = state.view !== 'table' || state.total === 0;
  $('cardView').hidden = state.view !== 'card' || state.total === 0;
  const start = state.total ? (state.page - 1) * state.pageSize + 1 : 0;
  const end = Math.min(state.page * state.pageSize, state.total);
  $('pageInfo').textContent = `${start.toLocaleString()}–${end.toLocaleString()} / ${state.total.toLocaleString()} · 第 ${state.page}/${pages} 頁`;
  $('prevPage').disabled = state.page <= 1;
  $('nextPage').disabled = state.page >= pages;
}
function setView(view) {
  state.view = view;
  $('tableViewBtn').classList.toggle('active', view === 'table');
  $('cardViewBtn').classList.toggle('active', view === 'card');
  renderRecords();
}
function clearFilters() {
  $('q').value = '';
  $('company').value = '';
  $('topic').value = '';
  $('year').value = '';
  $('sort').value = 'date-desc';
  $('pageSize').value = '50';
  loadRecords(true);
}
function renderSqlResult(result) {
  if (!result.length) {
    $('sqlResult').innerHTML = '<div class="sql-empty">Query completed · 0 rows</div>';
    return;
  }
  const columns = Object.keys(result[0]);
  $('sqlResult').innerHTML = `<div class="sql-scroll"><table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${result.slice(0, 500).map((row) => `<tr>${columns.map((c) => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${result.length > 500 ? `<div class="sql-limit">顯示前 500 / ${result.length} rows</div>` : ''}`;
}
function runSql() {
  const sql = $('sqlInput').value.trim();
  if (!/^(select|with|pragma)\b/i.test(sql)) {
    $('sqlStatus').textContent = '唯讀模式只允許 SELECT / WITH / PRAGMA';
    return;
  }
  const started = performance.now();
  try {
    const result = query(sql);
    renderSqlResult(result);
    $('sqlStatus').textContent = `${result.length} rows · ${(performance.now() - started).toFixed(1)} ms`;
  } catch (error) {
    $('sqlResult').innerHTML = `<div class="sql-error">${esc(error.message)}</div>`;
    $('sqlStatus').textContent = 'SQL error';
  }
}
async function init() {
  if (typeof initSqlJs !== 'function') throw new Error('sql.js loader not found');
  const [SQL, dbResponse] = await Promise.all([
    initSqlJs({ locateFile: (file) => `./vendor/${file}` }),
    fetch('./data/consultant.db', { cache:'no-store' })
  ]);
  if (!dbResponse.ok) throw new Error(`SQLite ${dbResponse.status} ${dbResponse.statusText}`);
  const buffer = await dbResponse.arrayBuffer();
  state.db = new SQL.Database(new Uint8Array(buffer));
  const integrity = scalar('PRAGMA integrity_check', [], 'error');
  if (integrity !== 'ok') throw new Error(`SQLite integrity_check: ${integrity}`);

  setupFilters();
  state.stats = loadStats();
  renderDashboard();
  loadRecords(true);
  $('sqlStatus').textContent = `consultant.db loaded · ${(buffer.byteLength / 1024).toFixed(0)} KB`;

  for (const id of ['company','topic','year','sort','pageSize']) $(id).addEventListener('change', () => loadRecords(true));
  let timer;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadRecords(true), 180); });
  $('clearFilters').addEventListener('click', clearFilters);
  $('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; loadRecords(false); } });
  $('nextPage').addEventListener('click', () => { const pages = Math.ceil(state.total / state.pageSize); if (state.page < pages) { state.page++; loadRecords(false); } });
  $('tableViewBtn').addEventListener('click', () => setView('table'));
  $('cardViewBtn').addEventListener('click', () => setView('card'));
  $('runSql').addEventListener('click', runSql);
  $('sqlInput').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runSql(); });
}

init().catch((error) => {
  $('freshness').className = 'freshness bad';
  $('freshness').innerHTML = '<span class="dot"></span><span>SQLite 載入失敗</span>';
  $('resultCount').textContent = `錯誤：${error.message}`;
  $('sqlStatus').textContent = error.message;
});
