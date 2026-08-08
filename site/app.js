const state = { rows: [], staticRows: [], total: 0, page: 1, pageSize: 50, view: 'table', stats: null, mode: 'api' };
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

async function getJSON(url) {
  const response = await fetch(url, { cache:'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
function addOptions(id, items) {
  for (const item of items) $(id).insertAdjacentHTML('beforeend', `<option value="${esc(item)}">${esc(item)}</option>`);
}
function setExportLinks() {
  $('jsonExport').href = state.mode === 'api' ? './api/export.json' : './data/reports.json';
  $('csvExport').href = state.mode === 'api' ? './api/export.csv' : './data/reports.csv';
}
function staticStats(rows, updatedAt) {
  const companies = ['McKinsey','BCG','Deloitte','PwC'].map((company) => {
    const companyRows = rows.filter((row) => row.company === company);
    const dated = companyRows.filter((row) => row.date).length;
    const latest = companyRows.map((row) => row.date).filter(Boolean).sort().reverse()[0] || null;
    return { company, records: companyRows.length, dated, latest };
  });
  return {
    updated_at: updatedAt,
    total: rows.length,
    dated: rows.filter((row) => row.date).length,
    latest: rows.map((row) => row.date).filter(Boolean).sort().reverse()[0] || null,
    companies
  };
}
async function setupFilters() {
  if (state.mode === 'api') {
    const filters = await getJSON('./api/filters');
    addOptions('company', filters.companies || []);
    addOptions('topic', filters.topics || []);
    addOptions('year', filters.years || []);
  } else {
    addOptions('company', [...new Set(state.staticRows.map((row) => row.company).filter(Boolean))].sort());
    addOptions('topic', [...new Set(state.staticRows.flatMap((row) => row.topics || []))].sort());
    addOptions('year', [...new Set(state.staticRows.map((row) => (row.date || '').slice(0, 4)).filter(Boolean))].sort().reverse());
  }
}
function renderDashboard() {
  const stats = state.stats || {};
  const total = Number(stats.total || 0);
  const dated = Number(stats.dated || 0);
  const latest = stats.latest || '';
  const topicCount = $('topic').options.length - 1;
  $('kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total records</div><div class="kpi-value">${total.toLocaleString()}</div><div class="kpi-sub">${state.mode === 'api' ? 'Cloudflare D1' : 'Static fallback'} 研究紀錄</div></div>
    <div class="kpi"><div class="kpi-label">Dated records</div><div class="kpi-value">${pct(dated,total)}</div><div class="kpi-sub">${dated.toLocaleString()} 筆有發布日期</div></div>
    <div class="kpi"><div class="kpi-label">Latest publication</div><div class="kpi-value">${fmtDate(latest)}</div><div class="kpi-sub">${Number.isFinite(ageDays(latest)) ? `${ageDays(latest)} 天前` : '尚無日期'}</div></div>
    <div class="kpi"><div class="kpi-label">Topic tags</div><div class="kpi-value">${topicCount}</div><div class="kpi-sub">可查詢維度</div></div>`;
  $('updatedAt').textContent = `資料更新 ${fmtUpdated(stats.updated_at)}`;
  const hours = stats.updated_at ? (Date.now() - new Date(stats.updated_at).getTime()) / 3600000 : Infinity;
  $('freshness').className = `freshness ${hours <= 36 ? 'good' : hours <= 72 ? '' : 'bad'}`;
  $('freshness').innerHTML = `<span class="dot"></span><span>${state.mode === 'api' ? 'D1 / Worker' : 'GitHub JSON fallback'} · ${hours <= 36 ? '資料新鮮' : hours <= 72 ? '資料需留意' : '資料可能過期'}</span>`;
  const map = Object.fromEntries((stats.companies || []).map((row) => [row.company, row]));
  $('coverage').innerHTML = ['McKinsey','BCG','Deloitte','PwC'].map((name) => {
    const company = map[name] || { records:0, dated:0, latest:null };
    const records = Number(company.records || 0);
    const companyDated = Number(company.dated || 0);
    const age = ageDays(company.latest);
    let level = 'bad', label = 'FAIL';
    if (records >= 3 && companyDated === records && age <= 60) { level = 'good'; label = 'PASS'; }
    else if (records > 0 && companyDated > 0) { level = 'warn'; label = 'PARTIAL'; }
    return `<div class="coverage-card"><div class="coverage-top"><span class="coverage-name">${name}</span><span class="badge ${level}">${label}</span></div><div class="coverage-numbers"><div class="metric-mini"><strong>${records}</strong><span>Records</span></div><div class="metric-mini"><strong>${pct(companyDated,records)}</strong><span>Dated</span></div><div class="metric-mini"><strong>${fmtDate(company.latest)}</strong><span>Latest</span></div><div class="metric-mini"><strong>${records-companyDated}</strong><span>Undated</span></div></div></div>`;
  }).join('');
}
function queryParams() {
  const params = new URLSearchParams({ page:String(state.page), page_size:String(state.pageSize), sort:$('sort').value });
  for (const [id,key] of [['q','q'],['company','company'],['topic','topic'],['year','year']]) {
    const value = $(id).value.trim();
    if (value) params.set(key, value);
  }
  return params;
}
function staticQuery() {
  const q = $('q').value.trim().toLowerCase();
  const company = $('company').value;
  const topic = $('topic').value;
  const year = $('year').value;
  const sort = $('sort').value;
  let rows = state.staticRows.filter((row) => {
    const haystack = `${row.company || ''} ${row.title || ''} ${row.description || ''} ${(row.topics || []).join(' ')}`.toLowerCase();
    return (!q || haystack.includes(q)) && (!company || row.company === company) && (!topic || (row.topics || []).includes(topic)) && (!year || (row.date || '').startsWith(year));
  });
  rows.sort((a,b) => sort === 'date-asc' ? (a.date || '9999').localeCompare(b.date || '9999') : sort === 'company' ? (a.company || '').localeCompare(b.company || '') || (b.date || '').localeCompare(a.date || '') : sort === 'title' ? (a.title || '').localeCompare(b.title || '') : (b.date || '').localeCompare(a.date || ''));
  state.total = rows.length;
  state.rows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
}
async function loadRecords(reset = true) {
  if (reset) state.page = 1;
  state.pageSize = Number($('pageSize').value) || 50;
  $('resultCount').textContent = '查詢中…';
  if (state.mode === 'api') {
    const data = await getJSON(`./api/reports?${queryParams()}`);
    state.rows = data.reports || [];
    state.total = Number(data.total || 0);
    state.page = Number(data.page || state.page);
  } else {
    staticQuery();
  }
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
  $('activeFilters').textContent = state.mode === 'api' ? ' · Server-side SQL' : ' · Static fallback';
  $('qualityInline').innerHTML = `<span class="quality-chip">${state.mode === 'api' ? 'Cloudflare D1' : 'GitHub JSON'}</span>`;
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
async function init() {
  try {
    await getJSON('./api/health');
    state.mode = 'api';
    await setupFilters();
    state.stats = await getJSON('./api/stats');
  } catch {
    state.mode = 'static';
    const payload = await getJSON('./data/reports.json');
    state.staticRows = payload.reports || [];
    await setupFilters();
    state.stats = staticStats(state.staticRows, payload.updated_at);
  }
  setExportLinks();
  renderDashboard();
  await loadRecords(true);
  for (const id of ['company','topic','year','sort','pageSize']) $(id).addEventListener('change', () => loadRecords(true));
  let timer;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadRecords(true), 250); });
  $('clearFilters').addEventListener('click', clearFilters);
  $('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; loadRecords(false); } });
  $('nextPage').addEventListener('click', () => { const pages = Math.ceil(state.total / state.pageSize); if (state.page < pages) { state.page++; loadRecords(false); } });
  $('tableViewBtn').addEventListener('click', () => setView('table'));
  $('cardViewBtn').addEventListener('click', () => setView('card'));
}

init().catch((error) => {
  $('freshness').className = 'freshness bad';
  $('freshness').innerHTML = '<span class="dot"></span><span>資料載入失敗</span>';
  $('resultCount').textContent = `錯誤：${error.message}`;
});
