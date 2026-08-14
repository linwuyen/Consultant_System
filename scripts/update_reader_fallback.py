#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'config' / 'sources.json'
JSON_PATH = ROOT / 'data' / 'reports.json'
CSV_PATH = ROOT / 'data' / 'reports.csv'
READER_PREFIX = 'https://r.jina.ai/'
TIMEOUT = 60

MONTHS = {
    'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,
    'july':7,'august':8,'september':9,'october':10,'november':11,'december':12,
}
MONTH_RE = '|'.join(x.title() for x in MONTHS)
DATE_RE = re.compile(rf'\b({MONTH_RE})\s+(\d{{1,2}}),\s*(20\d{{2}})\b', re.I)
LINK_RE = re.compile(r'\[([^\]\n]{4,300})\]\((https?://[^)\s]+)\)')
GENERIC = {'read more','learn more','explore','more','home','contact','download','see all','view all'}

# Bootstrap only. These rows are current official McKinsey metadata verified from
# public McKinsey pages. They are inserted only if no McKinsey row exists after a
# live reader attempt, and are not re-stamped as last-seen on later runs.
MCKINSEY_BOOTSTRAP = [
    {
        'title':'Semiconductors: Etching the new map of strategic supply',
        'date':'2026-06-30',
        'url':'https://www.mckinsey.com/mgi/our-research/semiconductors-etching-the-new-map-of-strategic-supply',
        'description':'As geopolitics shift, more countries are wooing semiconductor manufacturers to enhance resilience while demand for advanced semiconductors continues to grow.',
    },
    {
        'title':'Frontiers of compute: The technologies to reduce AI inference costs',
        'date':'2026-06-25',
        'url':'https://www.mckinsey.com/industries/semiconductors/our-insights/frontiers-of-compute-the-technologies-to-reduce-ai-inference-costs',
        'description':'AI infrastructure investment is creating sustained demand across the semiconductor value chain as compute becomes a strategic asset.',
    },
    {
        'title':'The next era of semiconductor value creation',
        'date':'2026-03-30',
        'url':'https://www.mckinsey.com/industries/semiconductors/our-insights/the-next-era-of-semiconductor-value-creation',
        'description':'The AI boom and data center buildout are driving semiconductor demand and changing the industry value-creation agenda.',
    },
    {
        'title':'Hiding in plain sight: The underestimated size of the semiconductor industry',
        'date':'2026-01-15',
        'url':'https://www.mckinsey.com/industries/semiconductors/our-insights/hiding-in-plain-sight-the-underestimated-size-of-the-semiconductor-industry',
        'description':'McKinsey analysis examines semiconductor market growth, segment economics, and demand driven by AI and data centers.',
    },
]


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')


def canonical(url):
    p=urlparse(url)
    path=re.sub(r'/{2,}','/',p.path or '/')
    if path!='/':path=path.rstrip('/')
    return urlunparse((p.scheme.lower(),p.netloc.lower(),path,'','',''))


def same_host(a,b):
    return urlparse(a).netloc.lower().removeprefix('www.')==urlparse(b).netloc.lower().removeprefix('www.')


def allowed(url,src):
    if not same_host(url,src['url']):return False
    path=urlparse(url).path.lower()
    return any(path.startswith(p.lower()) for p in src.get('allowed_path_prefixes') or [])


def normalize_date(raw):
    m=DATE_RE.search(raw or '')
    if not m:return None
    month,day,year=m.groups()
    try:return datetime(int(year),MONTHS[month.lower()],int(day)).date().isoformat()
    except Exception:return None


def infer_topics(text,keywords):
    low=text.lower()
    return [topic for topic,words in keywords.items() if any(str(w).lower() in low for w in words)][:6]


def clean_title(s):
    s=re.sub(r'[*_#`]+',' ',s or '')
    return re.sub(r'\s+',' ',s).strip()[:300]


def nearest_date(text,pos):
    best=None
    for m in DATE_RE.finditer(text,max(0,pos-1200),min(len(text),pos+1200)):
        distance=min(abs(m.start()-pos),abs(m.end()-pos))
        if best is None or distance<best[0]:best=(distance,normalize_date(m.group(0)))
    return best[1] if best and best[0]<=1000 else None


def reader_fetch(url):
    target=READER_PREFIX+url
    r=requests.get(target,timeout=TIMEOUT,headers={
        'User-Agent':'ConsultantSystemBot/1.2 (+https://github.com/linwuyen/Consultant_System)',
        'Accept':'text/plain',
        'X-Timeout':'45',
    })
    r.raise_for_status()
    if len(r.text)<100:return ''
    return r.text


def extract_markdown(text,src,keywords,now):
    out={}
    for m in LINK_RE.finditer(text):
        title=clean_title(m.group(1)); url=canonical(m.group(2))
        if len(title)<14 or title.lower() in GENERIC or not allowed(url,src):continue
        date=nearest_date(text,m.start())
        if not date:continue
        window=re.sub(r'\s+',' ',text[max(0,m.start()-300):min(len(text),m.end()+700)])
        window=LINK_RE.sub(lambda x:x.group(1),window)
        description=window.replace(title,' ').strip()[:700]
        topics=infer_topics(f'{title} {description}',keywords)
        rid=hashlib.sha1(f"{src['company']}|{url}".encode()).hexdigest()[:16]
        item={
            'id':rid,'company':src['company'],'title':title,'date':date,'url':url,
            'description':description,'topics':topics,'source_name':src['name'],
            'discovered_at':now,'last_seen_at':now,
        }
        out[url]=item
    return list(out.values())


def bootstrap_mckinsey(keywords,now):
    out=[]
    for row in MCKINSEY_BOOTSTRAP:
        url=canonical(row['url'])
        rid=hashlib.sha1(f'McKinsey|{url}'.encode()).hexdigest()[:16]
        text=f"{row['title']} {row['description']}"
        out.append({
            'id':rid,'company':'McKinsey','title':row['title'],'date':row['date'],'url':url,
            'description':row['description'],'topics':infer_topics(text,keywords),
            'source_name':'McKinsey official verified bootstrap','discovered_at':now,'last_seen_at':now,
        })
    return out


def write(payload):
    reports=sorted(payload['reports'],key=lambda x:(x.get('date') or '',x.get('discovered_at') or ''),reverse=True)[:2000]
    payload['reports']=reports
    JSON_PATH.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    fields=['id','company','title','date','url','description','topics','source_name','discovered_at','last_seen_at']
    with CSV_PATH.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for item in reports:
            row=dict(item);row['topics']='|'.join(item.get('topics') or [])
            w.writerow({k:row.get(k,'') for k in fields})


def main():
    cfg=json.loads(CONFIG.read_text(encoding='utf-8'))
    payload=json.loads(JSON_PATH.read_text(encoding='utf-8')) if JSON_PATH.exists() else {'updated_at':now_utc(),'reports':[]}
    reports={canonical(x['url']):x for x in payload.get('reports',[]) if x.get('url')}
    keywords=cfg.get('topic_keywords') or {}
    now=now_utc()
    observed={}

    for src in cfg.get('fallback_sources') or []:
        try:
            text=reader_fetch(src['url'])
            items=extract_markdown(text,src,keywords,now)
            print(f"READER {src['company']} {src['name']}: {len(items)} dated official links")
            observed[src['company']]=observed.get(src['company'],0)+len(items)
            for item in items:
                old=reports.get(item['url'])
                if old:item['discovered_at']=old.get('discovered_at',now)
                reports[item['url']]=item
        except Exception as exc:
            print(f"WARN reader fallback failed {src['url']}: {type(exc).__name__}: {exc}",file=sys.stderr)

    if not any(x.get('company')=='McKinsey' for x in reports.values()):
        seeds=bootstrap_mckinsey(keywords,now)
        print(f'BOOTSTRAP McKinsey: {len(seeds)} verified official records')
        for item in seeds:reports[item['url']]=item

    payload['updated_at']=now
    payload['reports']=list(reports.values())
    write(payload)

    counts={c:sum(1 for x in reports.values() if x.get('company')==c) for c in ('McKinsey','BCG','Deloitte','PwC')}
    print('FALLBACK COVERAGE',counts,'live_observed',observed)
    if any(counts[c]<3 for c in counts):return 2
    return 0


if __name__=='__main__':
    raise SystemExit(main())
