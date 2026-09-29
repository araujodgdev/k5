from pathlib import Path
import json
import pymupdf as fitz
from PIL import Image, ImageOps, ImageDraw

root=Path(__file__).resolve().parents[2]
pdf=root/'output/pdf/zima-jud-pesquisa-negocio.pdf'
dest=root/'tmp/pdfs/zima-jud'
doc=fitz.open(pdf)
issues=[]
links=0
texts=[]
thumbs=[]
for i,page in enumerate(doc,1):
    text=page.get_text()
    texts.append(text)
    if len(text)<100: issues.append(f'Page {i}: missing text')
    if '\ufffd' in text: issues.append(f'Page {i}: replacement glyph')
    for block in page.get_text('dict')['blocks']:
        if 'lines' not in block: continue
        for line in block['lines']:
            for s in line['spans']:
                x0,y0,x1,y1=s['bbox']
                if x0<0 or y0<0 or x1>page.rect.width+.5 or y1>page.rect.height+.5:
                    issues.append(f'Page {i}: text outside bounds {s["text"]}')
    links+=len(page.get_links())
    pix=page.get_pixmap(matrix=fitz.Matrix(1.3,1.3),alpha=False)
    img=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    img.save(dest/f'page-{i:02d}.png')
    thumb=ImageOps.contain(img,(290,390))
    tile=Image.new('RGB',(310,420),'#e4e8e5')
    tile.paste(thumb,((310-thumb.width)//2,10))
    ImageDraw.Draw(tile).text((12,401),f'{i:02d}',fill='#192c31')
    thumbs.append(tile)
for offset in range(0,len(thumbs),8):
    sheet=Image.new('RGB',(1240,840),'white')
    for j,t in enumerate(thumbs[offset:offset+8]):sheet.paste(t,((j%4)*310,(j//4)*420))
    sheet.save(dest/f'contact-{offset//8+1}.png')
combined='\n'.join(texts)
for required in ['Business Model Canvas','R$199','R$349','47.071','1.509.797','R$6.225','Vitória de Santo Antão']:
    if required not in combined: issues.append('Missing expected text: '+required)
if doc.page_count!=24:issues.append('Unexpected page count')
if doc[18].rect.width<doc[18].rect.height:issues.append('Canvas not landscape')
(dest/'extracted-text.txt').write_text(combined,encoding='utf-8')
result={'pages':doc.page_count,'bytes':pdf.stat().st_size,'links':links,'issues':issues}
(dest/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
if issues: raise SystemExit(1)
