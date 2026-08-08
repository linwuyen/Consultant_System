const state = { reports: [], filtered: [], updatedAt: null };
const $ = (id) => document.getElementById(id);

function esc(s='') { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(s) { if (!s) return '日期未標示'; const d = new Date(`${s}T00:00:00Z`); return Number.isNaN(d) ? s : d.toLocaleDateString('zh-TW'); }
function fmtUpdated(s) { if (!s) return ''; const d = new Date(s); return `資料更新：${d.toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })}`; }

function populateFilters() {
  const companies = [...new Set(state.reports.map(r=>r.company).filter(Boolean))].sort();
  const topics = [...new Set(state.reports.flatMap(r=>r.topics||[]))].sort();
  const years = [...new Set(state.reports.map(r=>(r.date||'').slice(0,4)).filter(Boolean))].sort().reverse();
  for (const x of companies) $('company').insertAdjacentHTML('beforeend', `<option>${esc(x)}</option>`);
  for (const x of topics) $('topic').insertAdjacentHTML('beforeend', `<option>${esc(x)}</option>`);
  for (const x of years) $('year').insertAdjacentHTML('beforeend', `<option>${esc(x)}</option>`);
}

function renderStats() {
  const byCompany = Object.groupBy ? Object.groupBy(state.reports, r=>r.company) : state.reports.reduce((a,r)=>((a[r.company]??=[]).push(r),a),{});
  const bits = [`<span class="stat">共 ${state.reports.length.toLocaleString()} 篇</span>`];
  for (const name of ['McKinsey','BCG','Deloitte','PwC']) bits.push(`<span class="stat">${name} ${(byCompany[name]||[]).length}</span>`);
  $('stats').innerHTML = bits.join('');
}

function apply() {
  const q = $('q').value.trim().toLowerCase();
  const company = $('company').value;
  const topic = $('topic').value;
  const year = $('year').value;
  const sort = $('sort').value;
  let rows = state.reports.filter(r => {
    const hay = `${r.company} ${r.title} ${r.description||''} ${(r.topics||[]).join(' ')}`.toLowerCase();
    return (!q || hay.includes(q)) && (!company || r.company===company) && (!topic || (r.topics||[]).includes(topic)) && (!year || (r.date||'').startsWith(year));
  });
  rows.sort((a,b)=> sort==='date-asc' ? (a.date||'9999').localeCompare(b.date||'9999') : sort==='company' ? a.company.localeCompare(b.company)|| (b.date||'').localeCompare(a.date||'') : (b.date||'').localeCompare(a.date||''));
  state.filtered = rows;
  render();
}

function render() {
  $('resultCount').textContent = `顯示 ${state.filtered.length.toLocaleString()} / ${state.reports.length.toLocaleString()} 篇`;
  $('updatedAt').textContent = fmtUpdated(state.updatedAt);
  $('empty').hidden = state.filtered.length !== 0;
  $('results').innerHTML = state.filtered.map(r => `
    <article class="card">
      <div class="meta"><span class="company">${esc(r.company)}</span><span>·</span><span>${esc(fmtDate(r.date))}</span><span>·</span><span>${esc(r.source_name||'')}</span></div>
      <h2><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h2>
      ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
      <div class="topics">${(r.topics||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
    </article>`).join('');
}

async function init() {
  try {
    const resp = await fetch('./data/reports.json', { cache:'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    state.reports = Array.isArray(payload.reports) ? payload.reports : [];
    state.updatedAt = payload.updated_at;
    populateFilters(); renderStats(); apply();
    for (const id of ['q','company','topic','year','sort']) $(id).addEventListener(id==='q'?'input':'change', apply);
  } catch (err) {
    $('resultCount').textContent = `資料載入失敗：${err.message}`;
  }
}
init();
