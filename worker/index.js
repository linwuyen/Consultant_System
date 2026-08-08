const SOURCES = [
  { company: 'McKinsey', name: 'McKinsey Insights', url: 'https://www.mckinsey.com/insights/en', allow: ['/capabilities/','/industries/','/mgi/','/featured-insights/'] },
  { company: 'McKinsey', name: 'McKinsey Global Institute', url: 'https://www.mckinsey.com/mgi/overview', allow: ['/mgi/'] },
  { company: 'BCG', name: 'BCG Publications', url: 'https://www.bcg.com/publications', allow: ['/publications/'] },
  { company: 'Deloitte', name: 'Deloitte Insights', url: 'https://www.deloitte.com/us/en/insights.html?site=global-en', allow: ['/us/en/insights/','/global/en/our-thinking/'] },
  { company: 'PwC', name: "PwC Today's Issues", url: 'https://www.pwc.com/gx/en/issues.html', allow: ['/gx/en/issues/','/gx/en/research-insights/'] }
];

const TOPICS = {
  AI: ['artificial intelligence','generative ai','gen ai','agentic','ai agent','machine learning'],
  Semiconductor: ['semiconductor','chip','wafer','foundry'],
  Energy: ['energy','power','electricity','grid','renewable','battery'],
  Manufacturing: ['manufacturing','factory','industrial','automation'],
  'Supply Chain': ['supply chain','logistics','procurement','resilience'],
  'Data Center': ['data center','data centre','datacenter','cloud infrastructure'],
  Economics: ['economy','economic','inflation','productivity','gdp','investment'],
  Strategy: ['strategy','growth','portfolio','transformation','value creation'],
  Workforce: ['workforce','talent','jobs','skills','human capital']
};

const EXCLUDES = ['/careers','/about','/contact','/locations','/people','/privacy','/terms','/cookies','/events','/search','/login','/subscribe','/newsletter','/sitemap','/services/'];
const MAX_PER_SOURCE = 10;
const UA = 'ConsultantSystemBot/2.0 (+https://github.com/linwuyen/Consultant_System; metadata-only research index)';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, published_at TEXT, url TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', topics_json TEXT NOT NULL DEFAULT '[]', source_name TEXT NOT NULL, discovered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_reports_company_date ON reports(company, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_published_at ON reports(published_at DESC);
CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, last_success_at TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS crawl_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, discovered INTEGER NOT NULL DEFAULT 0, upserted INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, detail_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR REPLACE INTO schema_meta(key,value) VALUES ('schema_version','1');`;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers } });
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const escLike = s => String(s).replace(/[\\%_]/g, m => '\\' + m);
const shaId = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);

async function ensureSchema(env) {
  await env.DB.exec(SCHEMA);
  for (const s of SOURCES) await env.DB.prepare('INSERT OR IGNORE INTO sources(company,name,url) VALUES(?,?,?)').bind(s.company,s.name,s.url).run();
}

async function bootstrapIfEmpty(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports').first();
  if (Number(row?.n || 0) > 0) return;
  try {
    const r = await fetch('https://raw.githubusercontent.com/linwuyen/Consultant_System/main/data/reports.json', { headers: { 'user-agent': UA } });
    if (!r.ok) return;
    const payload = await r.json();
    const items = (payload.reports || []).filter(x => x.url && x.title && x.company).slice(0,1000);
    for (let i=0;i<items.length;i+=50) {
      const batch = items.slice(i,i+50).map(x => env.DB.prepare(`INSERT OR IGNORE INTO reports(id,company,title,published_at,url,description,topics_json,source_name,discovered_at,last_seen_at,active) VALUES(?,?,?,?,?,?,?,?,?,?,1)`).bind(
        x.id || crypto.randomUUID(), x.company, x.title, x.date || null, x.url, x.description || '', JSON.stringify(x.topics || []), x.source_name || x.company, x.discovered_at || now(), x.last_seen_at || now()
      ));
      if (batch.length) await env.DB.batch(batch);
    }
  } catch (e) { console.log('bootstrap failed', e?.message || e); }
}

function stripTags(s='') { return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function attr(html, key, val) {
  const re = new RegExp(`<meta[^>]+${key}=["']${val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["'][^>]*>`, 'i');
  const m=html.match(re); return stripTags(m?.[1]||m?.[2]||'');
}
function canonical(base, href) { try { const u=new URL(href,base); u.hash=''; u.search=''; u.pathname=u.pathname.replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/'; return u.toString(); } catch { return ''; } }
function sameHost(a,b){ try{return new URL(a).hostname.replace(/^www\./,'')===new URL(b).hostname.replace(/^www\./,'');}catch{return false;} }
function validCandidate(url, source){ const p=new URL(url).pathname.toLowerCase(); return sameHost(url,source.url) && source.allow.some(x=>p.startsWith(x)) && !EXCLUDES.some(x=>p.includes(x)) && p.split('/').filter(Boolean).length>=2; }
function linksFrom(html, source){
  const out=[]; const seen=new Set(); const re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html))){ const u=canonical(source.url,m[1]); if(!u||seen.has(u)||!validCandidate(u,source))continue; seen.add(u); const text=stripTags(m[2]); let score=0; const path=new URL(u).pathname; if(/\/20\d{2}\//.test(path))score+=8; if(/article|report|survey|insight|research|publication|outlook|trend|future|ai|economic/i.test(path+' '+text))score+=3; if(/overview|index|center|centre|topics?$/i.test(path))score-=5; out.push({u,score}); }
  return out.sort((a,b)=>b.score-a.score).slice(0,MAX_PER_SOURCE).map(x=>x.u);
}
function normalizeDate(raw=''){
  raw=stripTags(raw).trim(); if(!raw)return null;
  let d=new Date(raw); if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10);
  const m=raw.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/); if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}
function inferTopics(text=''){ const s=text.toLowerCase(); return Object.entries(TOPICS).filter(([,words])=>words.some(w=>s.includes(w))).map(([k])=>k).slice(0,6); }
function extract(html,url,source){
  let title=attr(html,'property','og:title')||attr(html,'name','twitter:title');
  if(!title){ const h=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i); title=stripTags(h?.[1]||''); }
  if(!title){ const t=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i); title=stripTags(t?.[1]||''); }
  title=title.replace(/\s+[|–-]\s+(McKinsey.*|BCG|Deloitte.*|PwC.*)$/i,'').trim().slice(0,300);
  const description=(attr(html,'property','og:description')||attr(html,'name','description')||'').slice(0,700);
  let date=attr(html,'property','article:published_time')||attr(html,'name','date')||attr(html,'name','publish-date')||attr(html,'name','publication_date');
  if(!date){ const j=html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i); date=j?.[1]||''; }
  if(!date){ const tm=html.match(/<time\b[^>]*(?:datetime=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/time>/i); date=tm?.[1]||stripTags(tm?.[2]||''); }
  date=normalizeDate(date);
  if(!title || title.length<5 || !date) return null;
  return {title,description,date,topics:inferTopics(`${title} ${description}`),url,company:source.company,source_name:source.name};
}

async function fetchText(url){ const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'en-US,en;q=0.8'},redirect:'follow'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const ct=r.headers.get('content-type')||''; if(!ct.includes('text/html'))throw new Error('not html'); return r.text(); }
async function refreshAll(env){
  await ensureSchema(env); const started=now(); const run=await env.DB.prepare("INSERT INTO crawl_runs(started_at,status) VALUES(?,'running') RETURNING id").bind(started).first(); let discovered=0,upserted=0,errors=0; const detail={};
  for(const source of SOURCES){ let sourceCount=0; try{ const listing=await fetchText(source.url); const links=linksFrom(listing,source); discovered+=links.length; for(const url of links){ try{ const item=extract(await fetchText(url),url,source); if(!item)continue; const id=await shaId(`${item.company}|${item.url}`); const ts=now(); await env.DB.prepare(`INSERT INTO reports(id,company,title,published_at,url,description,topics_json,source_name,discovered_at,last_seen_at,active) VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(url) DO UPDATE SET company=excluded.company,title=excluded.title,published_at=excluded.published_at,description=excluded.description,topics_json=excluded.topics_json,source_name=excluded.source_name,last_seen_at=excluded.last_seen_at,active=1`).bind(id,item.company,item.title,item.date,item.url,item.description,JSON.stringify(item.topics),item.source_name,ts,ts).run(); upserted++; sourceCount++; }catch(e){errors++;} }
    await env.DB.prepare('UPDATE sources SET last_success_at=?,last_error=NULL WHERE url=?').bind(now(),source.url).run(); detail[source.name]={status:'ok',records:sourceCount,candidates:links.length};
  }catch(e){errors++; detail[source.name]={status:'error',error:String(e?.message||e)}; await env.DB.prepare('UPDATE sources SET last_error=? WHERE url=?').bind(String(e?.message||e).slice(0,500),source.url).run();} }
  await env.DB.prepare("UPDATE crawl_runs SET finished_at=?,status=?,discovered=?,upserted=?,error_count=?,detail_json=? WHERE id=?").bind(now(),errors?'partial':'success',discovered,upserted,errors,JSON.stringify(detail),run?.id).run();
  return {started_at:started,finished_at:now(),discovered,upserted,errors,detail};
}

async function apiReports(request,env){
  const u=new URL(request.url), p=u.searchParams; const page=Math.max(1,Number(p.get('page')||1)); const pageSize=Math.min(100,Math.max(1,Number(p.get('page_size')||50))); const where=['active=1']; const binds=[];
  const q=p.get('q')?.trim(); if(q){ const x=`%${escLike(q)}%`; where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR topics_json LIKE ? ESCAPE '\\')"); binds.push(x,x,x); }
  if(p.get('company')){where.push('company=?');binds.push(p.get('company'));}
  if(p.get('topic')){where.push("topics_json LIKE ? ESCAPE '\\'");binds.push(`%${escLike('"'+p.get('topic')+'"')}%`);}
  if(p.get('year')){where.push('published_at LIKE ?');binds.push(`${p.get('year')}%`);}
  const sort={ 'date-asc':'published_at ASC','company':'company ASC, published_at DESC','title':'title ASC','date-desc':'published_at DESC' }[p.get('sort')||'date-desc']||'published_at DESC';
  const w=where.join(' AND '); const count=await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE ${w}`).bind(...binds).first();
  const rs=await env.DB.prepare(`SELECT id,company,title,published_at AS date,url,description,topics_json,source_name,discovered_at,last_seen_at FROM reports WHERE ${w} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...binds,pageSize,(page-1)*pageSize).all();
  return json({reports:(rs.results||[]).map(r=>({...r,topics:JSON.parse(r.topics_json||'[]'),topics_json:undefined})),total:Number(count?.n||0),page,page_size:pageSize});
}
async function apiStats(env){
  const totals=await env.DB.prepare('SELECT COUNT(*) total, SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) dated, MAX(published_at) latest FROM reports WHERE active=1').first();
  const companies=await env.DB.prepare('SELECT company,COUNT(*) records,SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) dated,MAX(published_at) latest FROM reports WHERE active=1 GROUP BY company ORDER BY company').all();
  const crawl=await env.DB.prepare('SELECT * FROM crawl_runs ORDER BY id DESC LIMIT 1').first();
  return json({updated_at:crawl?.finished_at||null,total:Number(totals?.total||0),dated:Number(totals?.dated||0),latest:totals?.latest||null,companies:companies.results||[],last_crawl:crawl||null});
}
async function apiFilters(env){
  const companies=await env.DB.prepare('SELECT DISTINCT company FROM reports WHERE active=1 ORDER BY company').all();
  const years=await env.DB.prepare("SELECT DISTINCT substr(published_at,1,4) year FROM reports WHERE active=1 AND published_at IS NOT NULL ORDER BY year DESC").all();
  const topicRows=await env.DB.prepare('SELECT topics_json FROM reports WHERE active=1').all(); const topics=[...new Set((topicRows.results||[]).flatMap(r=>{try{return JSON.parse(r.topics_json||'[]')}catch{return[]}}))].sort();
  return json({companies:(companies.results||[]).map(x=>x.company),years:(years.results||[]).map(x=>x.year),topics});
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try{
      await ensureSchema(env); await bootstrapIfEmpty(env);
      if(u.pathname==='/api/health') return json({ok:true,database:'D1',worker:'consultant-system',time:now()});
      if(u.pathname==='/api/reports' && request.method==='GET') return apiReports(request,env);
      if(u.pathname==='/api/stats' && request.method==='GET') return apiStats(env);
      if(u.pathname==='/api/filters' && request.method==='GET') return apiFilters(env);
      if(u.pathname==='/api/refresh' && request.method==='POST'){
        const token=request.headers.get('x-admin-token'); if(!env.ADMIN_TOKEN || token!==env.ADMIN_TOKEN) return json({error:'unauthorized'},401);
        return json(await refreshAll(env));
      }
      return json({error:'not found'},404);
    }catch(e){ console.error(e); return json({error:'internal_error',message:String(e?.message||e)},500); }
  },
  async scheduled(controller,env,ctx){ ctx.waitUntil(refreshAll(env)); }
};
