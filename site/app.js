const state={rows:[],total:0,page:1,pageSize:50,view:'table',stats:null};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00Z`);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});};
const pct=(n,d)=>d?`${Math.round(n/d*100)}%`:'0%';
const ageDays=v=>{if(!v)return Infinity;return Math.max(0,Math.floor((Date.now()-new Date(`${v}T00:00:00Z`).getTime())/86400000));};
const fmtUpdated=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';

async function getJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return r.json();}

async function loadFilters(){
  const f=await getJSON('./api/filters');
  for(const x of f.companies||[])$('company').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
  for(const x of f.topics||[])$('topic').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
  for(const x of f.years||[])$('year').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
}

function renderDashboard(){
  const s=state.stats||{};const total=Number(s.total||0),dated=Number(s.dated||0),latest=s.latest||'';
  const topicCount=$('topic').options.length-1;
  $('kpis').innerHTML=`<div class="kpi"><div class="kpi-label">Total records</div><div class="kpi-value">${total.toLocaleString()}</div><div class="kpi-sub">D1 研究紀錄</div></div><div class="kpi"><div class="kpi-label">Dated records</div><div class="kpi-value">${pct(dated,total)}</div><div class="kpi-sub">${dated.toLocaleString()} 筆有發布日期</div></div><div class="kpi"><div class="kpi-label">Latest publication</div><div class="kpi-value">${fmtDate(latest)}</div><div class="kpi-sub">${Number.isFinite(ageDays(latest))?`${ageDays(latest)} 天前`:'尚無日期'}</div></div><div class="kpi"><div class="kpi-label">Topic tags</div><div class="kpi-value">${topicCount}</div><div class="kpi-sub">SQL 可篩選維度</div></div>`;
  $('updatedAt').textContent=`DB 更新 ${fmtUpdated(s.updated_at)}`;
  const hours=s.updated_at?(Date.now()-new Date(s.updated_at).getTime())/3600000:Infinity;
  $('freshness').className=`freshness ${hours<=36?'good':hours<=72?'':'bad'}`;
  $('freshness').innerHTML=`<span class="dot"></span><span>${hours<=36?'資料新鮮':hours<=72?'資料需留意':'資料可能過期'} · D1</span>`;
  const map=Object.fromEntries((s.companies||[]).map(x=>[x.company,x]));
  $('coverage').innerHTML=['McKinsey','BCG','Deloitte','PwC'].map(name=>{const c=map[name]||{records:0,dated:0,latest:null};const n=Number(c.records||0),d=Number(c.dated||0),age=ageDays(c.latest);let level='bad',label='FAIL';if(n>=3&&d===n&&age<=60){level='good';label='PASS'}else if(n>0&&d>0){level='warn';label='PARTIAL'}return `<div class="coverage-card"><div class="coverage-top"><span class="coverage-name">${name}</span><span class="badge ${level}">${label}</span></div><div class="coverage-numbers"><div class="metric-mini"><strong>${n}</strong><span>Records</span></div><div class="metric-mini"><strong>${pct(d,n)}</strong><span>Dated</span></div><div class="metric-mini"><strong>${fmtDate(c.latest)}</strong><span>Latest</span></div><div class="metric-mini"><strong>${n-d}</strong><span>Undated</span></div></div></div>`;}).join('');
}

function params(){const p=new URLSearchParams({page:String(state.page),page_size:String(state.pageSize),sort:$('sort').value});for(const [id,key] of [['q','q'],['company','company'],['topic','topic'],['year','year']]){const v=$(id).value.trim();if(v)p.set(key,v)}return p;}
async function loadRecords(reset=true){
  if(reset)state.page=1;state.pageSize=Number($('pageSize').value)||50;$('resultCount').textContent='SQL 查詢中…';
  const data=await getJSON(`./api/reports?${params()}`);state.rows=data.reports||[];state.total=Number(data.total||0);state.page=Number(data.page||state.page);renderRecords();
}
function renderTable(rows){$('tableBody').innerHTML=rows.map(r=>`<tr><td class="date-cell">${fmtDate(r.date)}</td><td class="company-cell">${esc(r.company)}</td><td><a class="title-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a>${r.description?`<div class="row-desc">${esc(r.description)}</div>`:''}</td><td><div class="tags">${(r.topics||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')||'<span class="tag">未分類</span>'}</div></td><td><a class="source-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_name||'官方來源')}</a></td></tr>`).join('');}
function renderCards(rows){$('cardView').innerHTML=rows.map(r=>`<article class="research-card"><div class="card-meta"><strong>${esc(r.company)}</strong><span>·</span><span>${fmtDate(r.date)}</span></div><h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a></h3>${r.description?`<p>${esc(r.description)}</p>`:''}<div class="tags">${(r.topics||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></article>`).join('');}
function renderRecords(){const pages=Math.max(1,Math.ceil(state.total/state.pageSize));renderTable(state.rows);renderCards(state.rows);$('resultCount').textContent=`${state.total.toLocaleString()} 筆符合 SQL 條件`;$('activeFilters').textContent=' · Cloudflare D1';$('qualityInline').innerHTML='<span class="quality-chip">Server-side query</span>';$('empty').hidden=state.total!==0;$('tableView').hidden=state.view!=='table'||state.total===0;$('cardView').hidden=state.view!=='card'||state.total===0;const start=state.total?(state.page-1)*state.pageSize+1:0,end=Math.min(state.page*state.pageSize,state.total);$('pageInfo').textContent=`${start.toLocaleString()}–${end.toLocaleString()} / ${state.total.toLocaleString()} · 第 ${state.page}/${pages} 頁`;$('prevPage').disabled=state.page<=1;$('nextPage').disabled=state.page>=pages;}
function setView(v){state.view=v;$('tableViewBtn').classList.toggle('active',v==='table');$('cardViewBtn').classList.toggle('active',v==='card');renderRecords();}
function clearFilters(){$('q').value='';$('company').value='';$('topic').value='';$('year').value='';$('sort').value='date-desc';$('pageSize').value='50';loadRecords(true);}

async function init(){try{await getJSON('./api/health');await loadFilters();state.stats=await getJSON('./api/stats');renderDashboard();await loadRecords(true);for(const id of ['company','topic','year','sort','pageSize'])$(id).addEventListener('change',()=>loadRecords(true));let timer;$('q').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>loadRecords(true),250)});$('clearFilters').addEventListener('click',clearFilters);$('prevPage').addEventListener('click',()=>{if(state.page>1){state.page--;loadRecords(false)}});$('nextPage').addEventListener('click',()=>{const pages=Math.ceil(state.total/state.pageSize);if(state.page<pages){state.page++;loadRecords(false)}});$('tableViewBtn').addEventListener('click',()=>setView('table'));$('cardViewBtn').addEventListener('click',()=>setView('card'));}catch(e){$('freshness').className='freshness bad';$('freshness').innerHTML='<span class="dot"></span><span>D1 / Worker 尚未部署或 API 無法連線</span>';$('resultCount').textContent=`API 錯誤：${e.message}`;}}
init();
