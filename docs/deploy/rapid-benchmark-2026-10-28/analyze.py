"""Offline analysis for the authorized 108-image Rapid comparison; no GPU/API calls."""
import argparse, collections, csv, hashlib, html, json, os, pathlib, statistics, sys
from PIL import Image

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sys.path.insert(0,str(ROOT/'runpod'))
import moss_benchmark as bench


def read(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def median(values):
    values=[v for v in values if v is not None]
    return round(statistics.median(values),3) if values else None


def analyze(data, partial=False):
    records=read(data/'results.jsonl')
    warmups=read(data/'warmups.jsonl') if (data/'warmups.jsonl').exists() else []
    fixtures={f['id']:f for f in bench.load_fixtures()}
    expected={(fixture,seed,preset) for fixture in fixtures for seed in (101,202,303) for preset in ('Rapid','Turbo','Fast')}
    indexed={}
    violations=[]
    for r in records:
        key=(r['fixture_id'],r['seed'],r['preset'])
        if key in indexed: violations.append(f'duplicate job {key}')
        indexed[key]=r
        g,m=r.get('generation') or {},r.get('metrics') or {}
        steps={'Rapid':4,'Turbo':8,'Fast':25}[r['preset']]
        adapter={'Rapid':'rapid4','Turbo':'dmd8','Fast':None}[r['preset']]
        for ok,label in [(r['status']=='completed','completed'),(not r.get('error'),'no error'),
                         (m.get('measurement_complete') is True,'complete timing'),
                         (len(r.get('image_files',[]))==1,'one saved image'),
                         ('7' not in m.get('cached_node_ids',[]),'positive encoding uncached'),
                         (m.get('observed_node_wall_ms',{}).get('sampler') is not None,'sampler executed'),
                         (g.get('preset_id')==r['preset'],'executed preset'),
                         (g.get('effective_steps')==steps,'executed steps'),
                         (g.get('adapter')==adapter,'adapter'),
                         (g.get('cfg')==({'Rapid':1.0,'Turbo':1.0,'Fast':2.5}[r['preset']]),'cfg'),
                         (g.get('sampler')==('er_sde' if r['preset']=='Fast' else 'euler'),'sampler recipe'),
                         (g.get('scheduler')=='simple','scheduler'),
                         (g.get('runtime_profile')=='rapid-auto-int8-cu128','profile'),
                         (r.get('seed_returned')==r['seed'],'resolved seed'),
                         ((r['width'],r['height'])==(1024,1024),'dimensions')]:
            if not ok: violations.append(f'{key}: {label}')
        for name in r.get('image_files',[]):
            image=data/'images'/pathlib.Path(name).name
            try:
                with Image.open(image) as im:
                    if im.size!=(1024,1024): violations.append(f'{key}: PNG dimensions')
                    im.verify()
            except Exception as error: violations.append(f'{key}: image integrity: {error}')
        graph=data/'workflows'/f"{r['profile']}-{r['preset']}-{r['fixture_id']}-{r['seed']}.json"
        if graph.exists():
            wf=json.loads(graph.read_text())
            sample=wf['10']['inputs']
            for field,value in {'steps':steps,'seed':r['seed'],'cfg':g.get('cfg'),'sampler_name':g.get('sampler'),'scheduler':g.get('scheduler')}.items():
                if sample.get(field)!=value: violations.append(f'{key}: graph {field}')
            adapter_names=[v['inputs'].get('lora_name') for v in wf.values() if v.get('class_type')=='LoraLoaderModelOnly']
            expected_adapter={'Rapid':'moss/control/moss_sft_4step_v2.0.safetensors','Turbo':'moss/control/moss_sft_dmd8.safetensors','Fast':None}[r['preset']]
            if adapter_names != ([] if expected_adapter is None else [expected_adapter]): violations.append(f'{key}: graph adapter')
            if (wf['9']['inputs']['width'],wf['9']['inputs']['height'])!=(1024,1024): violations.append(f'{key}: graph dimensions')
            if r['fixture_id']=='poster_zh_vertical' and '春茶上新' not in wf['7']['inputs']['text']:
                violations.append(f'{key}: raw CJK input missing')
        else: violations.append(f'{key}: graph missing')
    if not partial and len(warmups)!=36: violations.append(f'expected 36 warmups, got {len(warmups)}')
    for r in warmups:
        if r.get('status')!='completed': violations.append(f'failed warmup: {r["preset"]}/{r["fixture_id"]}')
    missing=sorted(expected-set(indexed))
    unexpected=sorted(set(indexed)-expected)
    valid=[r for r in records if bench.eligible(r) and not (r.get('generation') or {}).get('first_generation_in_worker')]
    steady=[r for r in valid if not r.get('switched')]
    def peak(r):
        return max(((r.get('memory') or {}).get('sampled_device_peak_mib') or {}).values(),default=0)/1024
    by_preset={}
    for preset in ('Rapid','Turbo','Fast'):
        rs=[r for r in steady if r['preset']==preset]
        all_rs=[r for r in records if r['preset']==preset]
        by_preset[preset]={
          'measured_n':len(all_rs),'steady_n':len(rs),'switched_n':sum(bool(r.get('switched')) for r in all_rs),
          'switched_worker_total_ms_median':median([(r.get('metrics') or {}).get('worker_total_ms') for r in all_rs if r.get('switched')]),
          'worker_total_ms_median':median([(r.get('metrics') or {}).get('worker_total_ms') for r in rs]),
          'sampler_ms_median':median([(r.get('metrics') or {}).get('observed_node_wall_ms',{}).get('sampler') for r in rs]),
          'positive_encode_ms_median':median([(r.get('metrics') or {}).get('observed_node_wall_ms',{}).get('text_encode_positive') for r in rs]),
          'sampled_device_peak_gib':round(max([peak(r) for r in all_rs],default=0),3)}
    steady_index={(r['fixture_id'],r['seed'],r['preset']):r for r in steady}
    paired={}
    for baseline in ('Turbo','Fast'):
        pairs=[]
        for fixture in fixtures:
            for seed in (101,202,303):
                rapid=steady_index.get((fixture,seed,'Rapid'))
                other=steady_index.get((fixture,seed,baseline))
                if not rapid or not other: continue
                if rapid['metrics']['worker_instance_id']!=other['metrics']['worker_instance_id']: continue
                a,b=rapid['metrics']['worker_total_ms'],other['metrics']['worker_total_ms']
                pairs.append({'fixture':fixture,'seed':seed,'Rapid_ms':a,f'{baseline}_ms':b,
                              'saved_ms':b-a,'saved_pct':100*(b-a)/b})
        paired[baseline]={'n':len(pairs),'wins':sum(p['saved_ms']>0 for p in pairs),
          'saved_ms_median':median([p['saved_ms'] for p in pairs]),
          'saved_pct_median':median([p['saved_pct'] for p in pairs]),
          'per_fixture':{f:{'n':len(ps),'saved_ms_median':median([p['saved_ms'] for p in ps]),
                            'saved_pct_median':median([p['saved_pct'] for p in ps])}
                         for f in fixtures if (ps:=[p for p in pairs if p['fixture']==f])}}
        if pairs:
            with (HERE/f'paired-Rapid-vs-{baseline}.csv').open('w') as out:
                writer=csv.DictWriter(out,fieldnames=list(pairs[0]),lineterminator='\n');writer.writeheader();writer.writerows(pairs)
    result={'data_directory':str(data),'measured_records':len(records),'warmup_records':len(warmups),
      'first_warmup_per_preset':{p:next((r for r in warmups if r['preset']==p),None) for p in ('Rapid','Turbo','Fast')},
      'statuses':dict(collections.Counter(r['status'] for r in records)),
      'worker_ids':sorted({(r.get('metrics') or {}).get('worker_instance_id','unknown') for r in records}),
      'missing_jobs':missing,'unexpected_jobs':unexpected,'violations':violations,
      'by_preset':by_preset,'paired':paired,
      'timing_note':'Steady warm worker wall time excludes HTTP polling and GPU/server startup; no p95 claim.',
      'quality_status':'Unpromoted: automated OCR/visual screening is not a completed human CER/IoU/usability acceptance.'}
    image_manifest=[]
    for r in records:
        for name in r.get('image_files',[]):
            image=data/'images'/pathlib.Path(name).name
            if image.exists(): image_manifest.append({'file':image.name,'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'bytes':image.stat().st_size})
    (HERE/'image-manifest.json').write_text(json.dumps(image_manifest,indent=2)+'\n')
    (HERE/'analysis.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    lines=['# Rapid benchmark results','',result['timing_note'],'',
      '| Preset | Measured / steady | Worker median (s) | Sampler median (s) | Sampled device peak (GiB) |',
      '| --- | --- | --- | --- | --- |']
    for preset,p in by_preset.items():
        total=p['worker_total_ms_median'];sampler=p['sampler_ms_median']
        lines.append(f"| {preset} | {p['measured_n']} / {p['steady_n']} | {total/1000 if total is not None else None} | {sampler/1000 if sampler is not None else None} | {p['sampled_device_peak_gib']} |")
    lines+=['','Paired comparisons exclude switched/cold/incomplete samples and require the same worker.','']
    for base,p in paired.items():
        lines.append(f"- Rapid vs {base}: {p['n']} pairs, {p['wins']} faster; median paired saving {p['saved_ms_median']} ms ({p['saved_pct_median']}%).")
    lines+=['',f"Records: {len(records)} measured + {len(warmups)} warmups. Integrity violations: {len(violations)}.",
            '',result['quality_status']]
    (HERE/'results.md').write_text('\n'.join(lines)+'\n')
    gallery=['<!doctype html><html lang="en"><meta charset="utf-8"><title>Rapid comparison</title>',
      '<style>body{font:16px system-ui;margin:24px;background:#f4f4f0}section{margin:36px 0}article{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}img{width:100%;height:auto}figure{margin:0}figcaption{padding:8px;background:white}h1{margin-bottom:8px}</style>',
      '<h1>Rapid / Turbo / Fast — paired image review</h1><p>1024², identical fixture and seed. Click an image for full resolution. Experimental; quality acceptance remains pending.</p>']
    for fixture,f in fixtures.items():
        for seed in (101,202,303):
            gallery.append(f'<section><h2>{html.escape(fixture)} — seed {seed}</h2><p>Expected text: {html.escape(" · ".join(f["expected_text"]))}</p><article>')
            for preset in ('Rapid','Turbo','Fast'):
                r=indexed.get((fixture,seed,preset))
                if not r or not r.get('image_files'):
                    gallery.append(f'<figure>{preset}: no image</figure>');continue
                src=f'{os.path.relpath(data,HERE)}/images/{pathlib.Path(r["image_files"][0]).name}'
                ms=(r.get('metrics') or {}).get('worker_total_ms')
                label=f'{preset} · {ms} ms worker · switched={r.get("switched",False)}'
                gallery.append(f'<figure><a href="{html.escape(src,quote=True)}"><img src="{html.escape(src,quote=True)}" loading="lazy" alt="{html.escape(label,quote=True)}"></a><figcaption>{html.escape(label)}</figcaption></figure>')
            gallery.append('</article></section>')
    gallery.append('</html>')
    (HERE/'comparison.html').write_text('\n'.join(gallery))
    print(json.dumps({k:result[k] for k in ('measured_records','warmup_records','statuses','by_preset','paired','violations')},ensure_ascii=False))
    if not partial and (missing or unexpected or violations or len(records)!=108): raise SystemExit(2)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('data',type=pathlib.Path);parser.add_argument('--partial',action='store_true')
    args=parser.parse_args();analyze(args.data,args.partial)
