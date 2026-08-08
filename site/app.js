const state={reports:[],filtered:[],updatedAt:null,page:1,pageSize:50,view:'table'};
const $=id=>document.getElementById(id);

function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtDate(value){if(!value)return '—';const d=new Date(`${value}T00:00:00Z`);return Number.isNaN(d.getTime())?value:d.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});}
function fmtUpdated(value){if(!value)return '尚無更新時間';const d=new Date(value);return `資料更新 ${d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}`;}
function dateAgeDays(value){if(!value)return Infinity;const t=new Date(`${value}T00:00:00Z`).getTime();return Number.isNaN(t)?Infinity:Math.max(0,Math.floor((Date.now()-t)/86400000));}
function latestDate(rows){return rows.map(r=>r.date).filter(Boolean).sort().reverse()[0]||'';}
function pct(n,d){return d?`${Math.round(n/d*100)}%`:'0%';}
function groupByCompany(rows){return rows.reduce((acc,r)=>{(acc[r.company]??=[]).push(r);return acc;},{});}

function populateFilters(){
  const companies=[...new Set(state.reports.map(r=>r.company).filter(Boolean))].sort();
  const topics=[...new Set(state.reports.flatMap(r=>r.topics||[]))].sort();
  const years=[...new Set(state.reports.map(r=>(r.date||'').slice(0,4)).filter(Boolean))].sort().reverse();
  for(const x of companies)$('company').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
  for(const x of topics)$('topic').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
  for(const x of years)$('year').insertAdjacentHTML('beforeend',`<option value="${esc(x)}">${esc(x)}</option>`);
}

function renderDashboard(){
  const rows=state.reports;
  const dated=rows.filter(r=>r.date).length;
  const topics=new Set(rows.flatMap(r=>r.topics||[])).size;
  const latest=latestDate(rows);
  const latestAge=dateAgeDays(latest);
  $('kpis').innerHTML=`
    <div class="kpi"><div class="kpi-label">Total records</div><div class="kpi-value">${rows.length.toLocaleString()}</div><div class="kpi-sub">目前索引研究紀錄</div></div>
    <div class="kpi"><div class="kpi-label">Dated records</div><div class="kpi-value">${pct(dated,rows.length)}</div><div class="kpi-sub">${dated.toLocaleString()} 筆有發布日期</div></div>
    <div class="kpi"><div class="kpi-label">Latest publication</div><div class="kpi-value">${latest?esc(fmtDate(latest)):'—'}</div><div class="kpi-sub">${Number.isFinite(latestAge)?`${latestAge} 天前`:'尚無有效日期'}</div></div>
    <div class="kpi"><div class="kpi-label">Topic tags</div><div class="kpi-value">${topics}</div><div class="kpi-sub">可供主題篩選</div></div>`;

  $('updatedAt').textContent=fmtUpdated(state.updatedAt);
  const fresh=$('freshness');
  if(state.updatedAt){
    const hours=(Date.now()-new Date(state.updatedAt).getTime())/3600000;
    fresh.className=`freshness ${hours<=36?'good':hours<=72?'':'bad'}`;
    fresh.innerHTML=`<span class="dot"></span><span>${hours<=36?'資料新鮮':hours<=72?'資料需留意':'資料可能過期'} · ${esc(fmtUpdated(state.updatedAt))}</span>`;
  }else{
    fresh.className='freshness bad';
    fresh.innerHTML='<span class="dot"></span><span>尚無資料更新紀錄</span>';
  }

  const grouped=groupByCompany(rows);
  const cards=['McKinsey','BCG','Deloitte','PwC'].map(name=>{
    const companyRows=grouped[name]||[];
    const companyDated=companyRows.filter(r=>r.date).length;
    const companyLatest=latestDate(companyRows);
    const age=dateAgeDays(companyLatest);
    const undated=companyRows.length-companyDated;
    let level='bad',label='FAIL';
    if(companyRows.length>=3&&undated===0&&age<=60){level='good';label='PASS';}
    else if(companyRows.length>0&&companyDated>0){level='warn';label='PARTIAL';}
    return `<div class="coverage-card">
      <div class="coverage-top"><span class="coverage-name">${name}</span><span class="badge ${level}">${label}</span></div>
      <div class="coverage-numbers">
        <div class="metric-mini"><strong>${companyRows.length}</strong><span>Records</span></div>
        <div class="metric-mini"><strong>${pct(companyDated,companyRows.length)}</strong><span>Dated</span></div>
        <div class="metric-mini"><strong>${companyLatest?esc(fmtDate(companyLatest)):'—'}</strong><span>Latest</span></div>
        <div class="metric-mini"><strong>${undated}</strong><span>Undated</span></div>
      </div>
    </div>`;
  });
  $('coverage').innerHTML=cards.join('');
}

function filterSummary(){
  const parts=[];
  if($('q').value.trim())parts.push(`搜尋「${$('q').value.trim()}」`);
  if($('company').value)parts.push($('company').value);
  if($('topic').value)parts.push($('topic').value);
  if($('year').value)parts.push($('year').value);
  return parts.length?` · ${parts.join(' · ')}`:'';
}

function apply(resetPage=true){
  const q=$('q').value.trim().toLowerCase();
  const company=$('company').value;
  const topic=$('topic').value;
  const year=$('year').value;
  const sort=$('sort').value;
  state.pageSize=Number($('pageSize').value)||50;
  let rows=state.reports.filter(r=>{
    const hay=`${r.company||''} ${r.title||''} ${r.description||''} ${(r.topics||[]).join(' ')} ${r.source_name||''}`.toLowerCase();
    return(!q||hay.includes(q))&&(!company||r.company===company)&&(!topic||(r.topics||[]).includes(topic))&&(!year||(r.date||'').startsWith(year));
  });
  rows.sort((a,b)=>{
    if(sort==='date-asc')return(a.date||'9999-99-99').localeCompare(b.date||'9999-99-99');
    if(sort==='company')return(a.company||'').localeCompare(b.company||'')||(b.date||'').localeCompare(a.date||'');
    if(sort==='title')return(a.title||'').localeCompare(b.title||'');
    return(b.date||'').localeCompare(a.date||'');
  });
  state.filtered=rows;
  if(resetPage)state.page=1;
  renderRecords();
}

function currentPageRows(){
  const start=(state.page-1)*state.pageSize;
  return state.filtered.slice(start,start+state.pageSize);
}

function renderTable(rows){
  $('tableBody').innerHTML=rows.map(r=>`<tr>
    <td class="date-cell">${esc(fmtDate(r.date))}</td>
    <td class="company-cell">${esc(r.company||'—')}</td>
    <td><a class="title-link" href="${esc(r.url||'#')}" target="_blank" rel="noopener noreferrer">${esc(r.title||'Untitled')} ↗</a>${r.description?`<div class="row-desc">${esc(r.description)}</div>`:''}</td>
    <td><div class="tags">${(r.topics||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')||'<span class="tag">未分類</span>'}</div></td>
    <td><a class="source-link" href="${esc(r.url||'#')}" target="_blank" rel="noopener noreferrer">${esc(r.source_name||'官方來源')}</a></td>
  </tr>`).join('');
}

function renderCards(rows){
  $('cardView').innerHTML=rows.map(r=>`<article class="research-card">
    <div class="card-meta"><strong>${esc(r.company||'—')}</strong><span>·</span><span>${esc(fmtDate(r.date))}</span></div>
    <h3><a href="${esc(r.url||'#')}" target="_blank" rel="noopener noreferrer">${esc(r.title||'Untitled')} ↗</a></h3>
    ${r.description?`<p>${esc(r.description)}</p>`:''}
    <div class="tags">${(r.topics||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')||'<span class="tag">未分類</span>'}</div>
  </article>`).join('');
}

function renderRecords(){
  const total=state.filtered.length;
  const totalPages=Math.max(1,Math.ceil(total/state.pageSize));
  if(state.page>totalPages)state.page=totalPages;
  const rows=currentPageRows();
  $('resultCount').textContent=`${total.toLocaleString()} 筆符合條件`;
  $('activeFilters').textContent=filterSummary();
  $('empty').hidden=total!==0;
  $('tableView').hidden=state.view!=='table'||total===0;
  $('cardView').hidden=state.view!=='card'||total===0;
  renderTable(rows);
  renderCards(rows);

  const undated=state.filtered.filter(r=>!r.date).length;
  $('qualityInline').innerHTML=undated?`<span class="quality-chip warn">${undated} 筆無日期</span>`:'<span class="quality-chip">日期完整</span>';
  const start=total?((state.page-1)*state.pageSize)+1:0;
  const end=Math.min(state.page*state.pageSize,total);
  $('pageInfo').textContent=`${start.toLocaleString()}–${end.toLocaleString()} / ${total.toLocaleString()} · 第 ${state.page}/${totalPages} 頁`;
  $('prevPage').disabled=state.page<=1;
  $('nextPage').disabled=state.page>=totalPages;
}

function setView(view){
  state.view=view;
  $('tableViewBtn').classList.toggle('active',view==='table');
  $('cardViewBtn').classList.toggle('active',view==='card');
  renderRecords();
}

function clearFilters(){
  $('q').value='';$('company').value='';$('topic').value='';$('year').value='';$('sort').value='date-desc';$('pageSize').value='50';
  apply(true);
}

async function init(){
  try{
    const resp=await fetch('./data/reports.json',{cache:'no-store'});
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
    const payload=await resp.json();
    state.reports=Array.isArray(payload.reports)?payload.reports:[];
    state.updatedAt=payload.updated_at||null;
    populateFilters();
    renderDashboard();
    apply(true);
    for(const id of ['q','company','topic','year','sort','pageSize'])$(id).addEventListener(id==='q'?'input':'change',()=>apply(true));
    $('clearFilters').addEventListener('click',clearFilters);
    $('prevPage').addEventListener('click',()=>{if(state.page>1){state.page--;renderRecords();window.scrollTo({top:$('database-title').offsetTop-20,behavior:'smooth'});}});
    $('nextPage').addEventListener('click',()=>{const pages=Math.ceil(state.filtered.length/state.pageSize);if(state.page<pages){state.page++;renderRecords();window.scrollTo({top:$('database-title').offsetTop-20,behavior:'smooth'});}});
    $('tableViewBtn').addEventListener('click',()=>setView('table'));
    $('cardViewBtn').addEventListener('click',()=>setView('card'));
  }catch(err){
    $('freshness').className='freshness bad';
    $('freshness').innerHTML='<span class="dot"></span><span>資料載入失敗</span>';
    $('resultCount').textContent=`資料載入失敗：${err.message}`;
    $('kpis').innerHTML='<div class="kpi"><div class="kpi-label">Database error</div><div class="kpi-value">—</div><div class="kpi-sub">請檢查 reports.json 或 deployment</div></div>';
  }
}

init();
