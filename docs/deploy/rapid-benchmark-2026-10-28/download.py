"""Download only completed volume artifacts; preserves the directory hierarchy."""
import concurrent.futures,pathlib
import modal
here=pathlib.Path(__file__).resolve().parent
destination=here.parents[2]/'output/benchmarks/rapid-3047de1'
run='run-20261028-083751-755837dd'
volume=modal.Volume.from_name('moss-bench',environment_name='main')
entries=list(volume.iterdir('/'+run,recursive=True))
files=[e for e in entries if e.type.name=='FILE']
def get(entry):
    dest=destination/entry.path.lstrip('/')
    if dest.exists() and dest.stat().st_size==entry.size and dest.suffix not in ('.jsonl','.md'):return False
    dest.parent.mkdir(parents=True,exist_ok=True)
    tmp=dest.with_name(dest.name+'.download')
    with tmp.open('wb') as out:
        for chunk in volume.read_file(entry.path):out.write(chunk)
    tmp.replace(dest)
    return True
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    print({'files':len(files),'downloaded':sum(pool.map(get,files))},flush=True)
