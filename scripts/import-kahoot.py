"""Import user-supplied Kahoot detail PDFs. Usage: python scripts/import-kahoot.py PDF_DIRECTORY.
Requires PyMuPDF and Pillow. Generated questions need editorial review before publication.
Only PDF content and answer markers are read; documents are never executed.
"""
import argparse
import json
import re
from pathlib import Path
import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COLORS = [(0.8863, .1059, .2353), (.0745, .4078, .8078), (.8471, .6196, 0), (.1490, .5373, .0471)]

def close(a, b):
    return a and max(abs(x-y) for x,y in zip(a,b)) < .005

def center_in(box, rect):
    return rect.contains(fitz.Rect(box).tl + (fitz.Rect(box).br-fitz.Rect(box).tl)/2)

def extract(directory):
    modules, questions = [], []
    for path in sorted(directory.glob('*.pdf')):
        match = re.match(r'Quiz (\w+) - (.+) - Details', path.name)
        if not match:
            continue
        number, title = match.groups()
        module_id = 'advanced-' + number.lower()
        module_qs = []
        with fitz.open(path) as doc:
            for pi, page in enumerate(doc):
                spans = [s for b in page.get_text('dict')['blocks'] if b['type']==0 for l in b['lines'] for s in l['spans']]
                headers = [s for s in spans if re.fullmatch(r'\d+ - (Quiz|True or false|Puzzle|Slider)', s['text'])]
                drawings = page.get_drawings()
                for header in headers:
                    qn, qt = header['text'].split(' - ')
                    x, y, _, hy = header['bbox']
                    card = fitz.Rect(x, hy+1, x+254.5, hy+153)
                    inside = [s for s in spans if center_in(s['bbox'], card) and s['font'].startswith('Montserrat')]
                    prompt = ' '.join(s['text'] for s in inside if s['color']==3355443)
                    options = []
                    option_rects = [d['rect'] for d in drawings if any(close(d.get('fill'),c) for c in COLORS) and d['rect'].width>60 and d['rect'].height>8 and center_in(d['rect'],card)]
                    option_rects.sort(key=lambda r: (round(r.y0/2), r.x0))
                    correct = []
                    for oi, rect in enumerate(option_rects):
                        texts = [s['text'] for s in inside if s['color']==16777215 and center_in(s['bbox'], rect+(-1,-1,1,1))]
                        if not texts:
                            texts = [s['text'] for s in inside if s['color']==0 and center_in(s['bbox'], rect+(-1,-1,1,1))]
                        text = ' '.join(texts)
                        oid = chr(97+oi)
                        options.append({'id':oid,'text':text})
                        ticks = [d for d in drawings if close(d.get('fill'),(1,1,1)) and d['rect'].width>3 and d['rect'].width<8 and d['rect'].height>2 and d['rect'].x0>rect.x1-15 and center_in(d['rect'],rect)]
                        if ticks:
                            correct.append(oid)
                    q={'id':f'{module_id}-{int(qn):02}', 'moduleId':module_id,'moduleTitle':title,'sourceNumber':int(qn),'sourcePage':pi+1,'sourceFile':path.name,'prompt':prompt,'type':'single','options':options}
                    if qt=='Puzzle':
                        q['type']='order';q['correctOrder']=[o['id'] for o in options]
                    elif qt=='Slider':
                        vals=[s['text'] for s in inside if s['color']==16777215]
                        q['type']='slider';q['slider']={'min':0,'max':24,'step':1,'answer':12,'unit':'hours'}
                        assert vals==['12','hours'], vals
                    else:
                        q['type']='multiple' if len(correct)>1 else 'boolean' if qt=='True or false' else 'single'
                        q['correctOptionIds']=correct
                        assert correct, (q['id'], 'No answer marker')
                    assert prompt and (options or qt=='Slider'), q
                    assert all(o['text'] for o in options), q
                    for info in page.get_image_info(xrefs=True):
                        if info['width']<100 or (info['width'],info['height'])==(1800,1000) or not center_in(info['bbox'],card):
                            continue
                        dest=ROOT/'media'/(q['id']+'.webp')
                        if not dest.exists():
                            pix=fitz.Pixmap(doc,info['xref'])
                            if pix.n>4: pix=fitz.Pixmap(fitz.csRGB,pix)
                            image=Image.frombytes('RGBA' if pix.alpha else 'RGB', (pix.width,pix.height), pix.samples)
                            image.save(dest,format='WEBP',quality=92,method=6)
                        q['media']='media/'+dest.name
                    module_qs.append(q)
        module_qs.sort(key=lambda q:q['sourceNumber'])
        assert [q['sourceNumber'] for q in module_qs]==list(range(1,len(module_qs)+1))
        modules.append({'id':module_id,'title':title,'questionCount':len(module_qs),'sourceFile':path.name})
        questions.extend(module_qs)
    return {'version':1,'source':'18 Kahoot detail PDFs from drive-download-20261112T013802Z-1-001.zip','modules':modules,'questions':questions}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path)
    parser.add_argument('--output',type=Path,default=ROOT/'data'/'advanced.json')
    args=parser.parse_args()
    bank=extract(args.directory)
    target=args.output
    # Retain explicit editorial corrections only if their raw source still matches.
    canonical=ROOT/'data'/'advanced.json'
    existing=json.loads(canonical.read_text()) if canonical.exists() else {}
    reviewed={q['id']:q for q in existing.get('questions',[])}
    for q in bank['questions']:
        old=reviewed.get(q['id'],{})
        for key in ['explanation','reviewRequired','reviewNote']:
            if key in old:q[key]=old[key]
        if 'originalPrompt' in old:
            assert q['prompt']==old['originalPrompt'], f"Source prompt changed: {q['id']}. Review correction first."
            q['originalPrompt']=old['originalPrompt'];q['prompt']=old['prompt']
        for option in q.get('options',[]):
            old_option=next((o for o in old.get('options',[]) if o['id']==option['id']),{})
            if 'originalText' in old_option:
                assert option['text']==old_option['originalText'], f"Source option changed: {q['id']}. Review correction first."
                option['originalText']=old_option['originalText'];option['text']=old_option['text']
    target.write_text(json.dumps(bank,ensure_ascii=False,indent=2)+'\n')
    print(f"Imported {len(bank['questions'])} questions from {len(bank['modules'])} modules")
    for q in bank['questions']:
        answer=' → '.join(o['text'] for o in q['options']) if q['type']=='order' else str(q['slider']['answer']) if q['type']=='slider' else '; '.join(o['text'] for o in q['options'] if o['id'] in q['correctOptionIds'])
        print(f"{q['id']} [{q['type']}] {q['prompt']} => {answer}")
