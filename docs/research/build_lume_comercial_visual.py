from pathlib import Path
from io import BytesIO
from html import unescape
import json
import os
import re
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'tmp/lume-comercial-visual'
ASSETS = ROOT / 'output/lume-comercial-assets'
OUT = ROOT / 'output/pdf'
BUILD.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
for name, filename in [('Geist','Geist-400.ttf'), ('Display','Geist-450.ttf'), ('Geist-Bold','Geist-600.ttf'), ('Mono','GeistMono.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(ROOT / 'tmp/lume-comercial/assets' / filename)))
pdfmetrics.registerFontFamily('Geist', normal='Geist', bold='Geist-Bold', italic='Geist', boldItalic='Geist-Bold')
pdfmetrics.registerFontFamily('Display', normal='Display', bold='Geist-Bold', italic='Display', boldItalic='Geist-Bold')

W, H = 720, 404.88
INK, PAPER, ORANGE, LIGHT_ORANGE = '#232323', '#FFFFFF', '#D97757', '#EBA184'
GRAY, SOFT, TERRACOTTA = '#5C5C5C', '#B8B8B8', '#B0502F'
DEST = BUILD / 'layout-preview.pdf' if os.environ.get('LUME_LAYOUT_PREVIEW') else OUT / 'lume-apresentacao-comercial-visual.pdf'
C = canvas.Canvas(str(DEST), pagesize=(W,H), pageCompression=1)
C.setTitle('Lume | Apresentação comercial com demonstrações')
C.setAuthor('Lume')
C.setSubject('Documentos, IA, pesquisa, rotina do escritório e honorários')
WA = 'https://wa.me/5581994045493'
LOGO = (ROOT / 'apps/web/public/lume.svg').read_text(encoding='utf-8')
slides, positions, images = [], [], []
current, dark = 0, False

def txt(s, x, y, w, size=12, leading=None, color=None, font='Geist', maxh=None):
    col = color or (PAPER if dark else INK)
    style = ParagraphStyle('text', fontName=font, fontSize=size, leading=leading or size*1.28,
                           textColor=HexColor(col), splitLongWords=False)
    obj = Paragraph(s, style)
    _, height = obj.wrap(w, 1000)
    if maxh and height > maxh:
        raise ValueError(f'Slide {current}: text height {height} > {maxh}: {s}')
    if x < 0 or x+w > W or y+height > (H-6 if y >= 374 else H-34):
        raise ValueError(f'Slide {current}: text outside safe area: {s}')
    obj.drawOn(C, x, H-y-height)
    plain = re.sub('<[^>]*>', '', re.sub(r'<br\s*/?>', '\n', s))
    positions.append(dict(slide=current, x=x, y=y, width=w, height=height, text=unescape(plain)))
    return height

def rule(x, y, w, color=None):
    C.setStrokeColor(HexColor(color or ('#565656' if dark else '#D9D9D9')))
    C.setLineWidth(.5)
    C.line(x, H-y, x+w, H-y)

def logo():
    col = PAPER if dark else INK
    drawing = svg2rlg(BytesIO(LOGO.replace('currentColor', col).encode()))
    drawing.scale(18/24, 18/24)
    renderPDF.draw(drawing, C, 32, H-35)
    txt('Lume', 56, 16, 105, 17, 19, font='Display')

def start(section, is_dark=False, orange=False):
    global current, dark
    current += 1
    dark = is_dark
    C.setFillColor(HexColor(ORANGE if orange else INK if dark else PAPER))
    C.rect(0, 0, W, H, stroke=0, fill=1)
    logo()
    muted = INK if orange else SOFT if dark else GRAY
    txt('APRESENTAÇÃO COMERCIAL', 476, 23, 170, 6.8, 9, color=muted, font='Mono')
    txt(f'{current:02d} / 17', 652, 23, 40, 6.8, 9, color=muted, font='Mono')
    rule(36, 374, 648, INK if orange else None)
    txt('LUME', 36, 383, 70, 6, 8, color=muted, font='Mono')
    txt(section.upper(), 360, 383, 324, 6, 8, color=muted, font='Mono')
    C.bookmarkPage(f's{current}')
    C.addOutlineEntry(section, f's{current}', 0, False)
    slides.append(dict(slide=current, title=section))

def end():
    C.showPage()

def label(s, x=36, y=65, w=648, color=None):
    return txt(s, x, y, w, 7.2, 10, color=color or (LIGHT_ORANGE if dark else TERRACOTTA), font='Mono')

def title(s, x=36, y=88, w=648, size=29):
    return txt(s, x, y, w, size, size*1.07, font='Display')

def note(s, x=36, y=350, w=648):
    return txt(s, x, y, w, 7.5, 10, color=SOFT if dark else GRAY)

def picture(file, x, y, w, h, crop=None, base=None, cover=False, border=False):
    path = file if isinstance(file, Path) else ASSETS / file
    if not path.exists() and os.environ.get('LUME_LAYOUT_PREVIEW'):
        return
    reader = ImageReader(str(path))
    iw, ih = reader.getSize()
    cx, cy, cw, ch = crop or (0, 0, iw, ih)
    if base:
        cx, cw = cx*iw/base[0], cw*iw/base[0]
        cy, ch = cy*ih/base[1], ch*ih/base[1]
    scale = (max if cover else min)(w/cw, h/ch)
    dx, dy = (w-cw*scale)/2, (h-ch*scale)/2
    C.saveState()
    p = C.beginPath()
    p.rect(x+max(dx,0), H-y-max(dy,0)-min(ch*scale,h), min(cw*scale,w), min(ch*scale,h))
    C.clipPath(p, stroke=0)
    C.drawImage(reader, x+dx-cx*scale, H-y-dy-(ih-cy)*scale,
                width=iw*scale, height=ih*scale, mask='auto')
    C.restoreState()
    if border:
        C.setStrokeColor(HexColor('#D9D9D9'))
        C.setLineWidth(.5)
        C.rect(x+max(dx,0), H-y-max(dy,0)-min(ch*scale,h), min(cw*scale,w), min(ch*scale,h), stroke=1, fill=0)
    images.append(dict(slide=current, path=str(path.relative_to(ROOT)), x=x, y=y, width=w, height=h, crop=crop))

def screen(file, x, y, w, h, crop=None, base=(1440,960)):
    picture(file, x, y, w, h, crop=crop, base=base if crop else None, border=True)

def detail(head, body, x, y, w, height=65):
    rule(x, y-10, w)
    txt(head, x, y, w, 13, 16, font='Geist-Bold')
    txt(body, x, y+24, w, 11, 15, color=SOFT if dark else GRAY, maxh=height-21)

# 01. Actual product view with demonstration data.
start('Um espaço de trabalho para a advocacia', True)
label('PARA ADVOGADOS E PEQUENOS ESCRITÓRIOS', y=74, w=330)
title('Os documentos<br/>do caso.<br/><font color="'+LIGHT_ORANGE+'">A rotina do<br/>escritório.</font>', y=103, w=322, size=34)
txt('O Lume reúne documentos, IA e gestão para apoiar o trabalho jurídico.',36,266,300,13,18,color='#D9D9D9')
picture('modulo-clientes.png',367,100,317,230,crop=(0,0,1440,710),base=(1440,960))
note('Interface do Lume com dados demonstrativos.',x=367,y=343,w=317)
end()

# 02. Specific customer, concrete problems, no invented traction.
start('Para quem é o Lume')
label('O ESCRITÓRIO QUE QUEREMOS ATENDER')
title('Para quem advoga<br/>e também cuida<br/><font color="'+TERRACOTTA+'">do escritório.</font>',w=325,size=31)
txt('Advogados individuais e equipes de 2 a 5 advogados.',36,219,292,15,20)
txt('Documentos, clientes e compromissos exigem atenção junto com o trabalho jurídico.',36,284,291,11.8,16,color=GRAY)
detail('Encontrar os documentos','Saber onde estão os arquivos necessários para continuar um caso.',378,100,306,73)
detail('Retomar o trabalho','Recuperar os fatos e preparar a próxima entrega.',378,188,306,73)
detail('Acompanhar o escritório','Consultar tarefas, compromissos e valores a receber.',378,276,306,73)
end()

# 03. This scenario is illustrative, not an anonymized customer case study.
start('Exemplo de uso: revisão de contrato',True)
label('EXEMPLO DEMONSTRATIVO')
title('Uma cliente pede<br/>a revisão de um<br/><font color="'+LIGHT_ORANGE+'">contrato comercial.</font>',w=330,size=30)
txt('O escritório precisa reunir os arquivos, conferir os fatos e acompanhar a entrega.',36,221,294,13,18,color=SOFT)
note('Personagens, documentos e valores fictícios.',y=344,w=310)
steps=[('Cofre','Contrato e anotações organizados por caso.'),('Lume e Pesquisa','Cronologia, questões para revisão e fontes.'),('Escritório','Cliente, tarefas e reunião de revisão.'),('Honorários','Parcelas e registro dos recebimentos.')]
for i,(head,body) in enumerate(steps):
    y=97+i*65
    rule(377,y-8,307)
    txt(f'0{i+1}',377,y+2,26,9,12,font='Mono',color=LIGHT_ORANGE)
    txt(head,410,y,272,14,18,font='Geist-Bold')
    txt(body,410,y+23,272,10.7,14,color=SOFT)
end()

# 04. Actual app component, rendered with fictional API data.
start('Cofre: documentos do caso')
label('01 / DOCUMENTOS')
title('Os arquivos ficam organizados por caso.',size=27)
txt('Contrato, anotações e cronologia disponíveis para consulta.',36,130,648,12,16,color=GRAY)
screen('modulo-cofre.png',36,162,648,180,crop=(290,249,1112,222))
note('Interface do Lume com dados demonstrativos. Recorte da área de documentos.')
end()

# 05. Real composer and sources. No generated response is fabricated.
start('Assistente: fatos e rascunhos',True)
label('02 / ASSISTENTE LUME')
title('Uma conversa com<br/><font color="'+LIGHT_ORANGE+'">os documentos<br/>do caso.</font>',w=331,size=30)
label('EXEMPLO DE SOLICITAÇÃO',y=224,w=320)
txt('Organize uma cronologia dos fatos e liste os pontos que preciso conferir antes de revisar o contrato.',36,245,298,12.3,17,color=SOFT)
screen('modulo-assistente.png',365,98,319,231,crop=(1067,175,356,348))
note('Seleção de fontes com dados demonstrativos.',x=365,w=319,y=342)
end()

# 06. The current interface performs open-web search, not a guaranteed legal database search.
start('Pesquisa: uma pergunta concreta')
label('03 / PESQUISA')
title('A pesquisa começa com uma pergunta.',size=29)
txt('Descreva o tema, escolha o tipo de busca e confira as fontes encontradas.',36,129,648,12,16,color=GRAY)
screen('modulo-pesquisa.png',36,169,648,166,crop=(290,160,1112,191))
note('Tela real preenchida para demonstração. Pesquisa na web aberta.')
end()

# 07. The contact profile connects the client with the next activity.
start('Clientes: contexto e atividades')
label('04 / CLIENTES')
title('O cadastro também mostra o próximo passo.',size=27)
txt('Contatos, observações, casos relacionados e atividades do cliente.',36,128,648,12,16,color=GRAY)
screen('cliente-e-atividades.png',36,159,648,182,crop=(289,280,1112,291))
note('Interface do Lume com dados demonstrativos. Marina Costa é uma personagem fictícia.')
end()

# 08. Large crop of the task area, without fabricating outcomes.
start('Tarefas: acompanhamento da entrega',True)
label('05 / TAREFAS')
title('A revisão tem uma tarefa e uma data.',size=29)
txt('Registre a atividade, defina o responsável e acompanhe o que ainda falta fazer.',36,129,648,12,16,color=SOFT)
screen('modulo-tarefas.png',36,162,648,179,crop=(290,212,1112,278))
note('Interface do Lume com dados demonstrativos. Datas e atividades do exemplo são fictícias.')
end()

# 09. Agenda with the demonstration meeting.
start('Agenda: reuniões e atividades')
label('06 / AGENDA')
title('A reunião de revisão entra no calendário.',size=28)
txt('No exemplo, a conversa com a cliente está agendada para 30 de setembro.',36,129,648,12,16,color=GRAY)
screen('modulo-agenda.png',36,158,648,184,crop=(290,269,1112,390))
note('Interface do Lume com dados demonstrativos.')
end()

# 10. Before payment, the tested finance UI shows three installments.
start('Honorários: programação das parcelas',True)
label('07 / FINANCEIRO DE HONORÁRIOS')
title('O honorário fica organizado em parcelas.',size=28)
txt('Exemplo: um honorário de R$ 3.000 em 3 parcelas de R$ 1.000.',36,129,648,12,16,color=SOFT)
screen('honorarios-parcelas.png',36,157,648,189,crop=(289,493,1118,349),base=(1440,1000))
note('Interface do módulo em ambiente de demonstração. Valores fictícios.')
end()

# 11. The amounts match the tested UI: 1,000 + 400 received; 600 + 1,000 outstanding.
start('Honorários: recebimentos e saldo')
label('EXEMPLO DEMONSTRATIVO / CONTROLE MANUAL')
title('Um pagamento parcial atualiza o saldo.',size=28)
txt('A primeira parcela foi recebida. Na segunda, entraram R$ 400.',36,130,648,12,16,color=GRAY)
screen('honorarios-recebimentos.png',36,155,451,189,crop=(398,268,641,327),base=(1440,1000))
txt('R$ 1.400',519,173,165,25,30,font='Display',color=TERRACOTTA)
txt('recebidos',519,205,165,11,15,color=GRAY)
rule(519,237,165)
txt('R$ 1.600',519,252,165,25,30,font='Display')
txt('a receber',519,285,165,11,15,color=GRAY)
note('Simulação. O módulo registra pagamentos manualmente e não movimenta dinheiro.')
end()

# 12. Actual mobile view; generation of the requested illustrative people did not complete.
start('Trabalho compartilhado',True)
label('PARA A EQUIPE')
title('O trabalho continua<br/>quando outro<br/><font color="'+LIGHT_ORANGE+'">advogado assume.</font>',w=324,size=30)
txt('Documentos e atividades organizados ajudam quem vai retomar o caso.',36,229,299,13,18,color=SOFT)
txt('A equipe acessa o Lume pelo navegador, no computador ou no celular.',36,298,299,11.5,16,color=SOFT)
picture('tarefas-mobile.png',419,62,205,291)
note('Tela do celular com dados demonstrativos.',x=376,y=357,w=308)
end()

# 13. Clear responsibility and capabilities, without unsupported certifications.
start('Revisão e controle')
label('NO TRABALHO JURÍDICO')
title('A IA ajuda a preparar.<br/><font color="'+TERRACOTTA+'">O advogado revisa e decide.</font>',size=32)
detail('Documentos e fontes','Confira os fatos nos documentos e abra as referências antes de citar.',36,208,302,99)
detail('Minutas e análises','Revise os fundamentos, os pedidos e o texto antes de usar a entrega.',382,208,302,99)
note('A demonstração permite avaliar a qualidade do resultado para a rotina do escritório.',y=344)
end()

# 14. Assisted onboarding from the approved canvas.
start('Implantação acompanhada',True)
label('COMO VOCÊ COMEÇA')
title('O primeiro uso<br/>tem acompanhamento<br/><font color="'+LIGHT_ORANGE+'">dos fundadores.</font>',w=347,size=29)
txt('Escolhemos uma tarefa do escritório e orientamos o começo do trabalho no Lume.',36,229,299,13,18,color=SOFT)
items=[('Escolha da tarefa','Um caso e uma entrega para experimentar.'),('Organização inicial','Acesso da equipe e documentos necessários.'),('Primeiro uso','Orientação para executar o fluxo e tirar dúvidas.'),('Acompanhamento','Conversas sobre o uso nas primeiras semanas.')]
for i,(head,body) in enumerate(items):
    y=94+i*65
    rule(384,y-8,300)
    txt(head,384,y,300,12.5,16,font='Geist-Bold')
    txt(body,384,y+23,300,10.5,14,color=SOFT)
end()

# 15. No invented pricing or usage allowances.
start('Como funciona a contratação')
label('CONTRATAÇÃO')
title('Uma assinatura<br/><font color="'+TERRACOTTA+'">para o escritório.</font>',w=323,size=31)
txt('A proposta define o plano, os usuários incluídos e os limites de uso.',36,201,284,13,18,color=GRAY)
txt('As condições são combinadas conforme o tamanho da equipe e a rotina de trabalho.',36,280,284,11.5,16,color=GRAY)
detail('Mensalidade por escritório','Plano com usuários e uso incluídos na proposta.',377,102,307,72)
detail('Implantação assistida','Orientação inicial para colocar a equipe em uso.',377,191,307,72)
detail('Serviços adicionais','Migração extensa e treinamentos extras têm escopo combinado.',377,280,307,72)
end()

# 16. A concrete demonstration agenda rather than unverified ROI promises.
start('O que vamos fazer na demonstração',True)
label('DEMONSTRAÇÃO')
title('Uma tarefa da sua rotina<br/><font color="'+LIGHT_ORANGE+'">ajuda a avaliar o Lume.</font>',size=31)
txt('Podemos percorrer o exemplo desta apresentação ou escolher uma atividade do escritório.',36,183,585,13,18,color=SOFT)
detail('Documentos e entrega','Organização do caso, consulta aos fatos e preparação de um rascunho.',36,266,302,78)
detail('Rotina e honorários','Cadastro do cliente, atividades e controle dos valores a receber.',382,266,302,78)
end()

# 17. Functional CTA using the contact supplied by the user.
start('Agende uma demonstração',False,True)
label('PRÓXIMO PASSO',y=78,color=INK)
title('O Lume na rotina<br/>do seu escritório.',y=110,w=412,size=37)
txt('Converse com a equipe e escolha<br/>uma tarefa para a demonstração.',36,244,352,14,19)
rule(451,111,233,INK)
txt('AGENDE PELO WHATSAPP',451,137,233,8.4,12,font='Mono')
txt(f'<link href="{WA}" color="{INK}">(81) 99404-5493</link>',451,173,233,24,30,font='Display')
txt(f'<link href="{WA}" color="{INK}"><u>Abrir conversa no WhatsApp</u></link>',451,224,233,11.5,16)
txt('Implantação assistida.<br/>Contato direto com os fundadores.',451,292,233,11.5,16)
end()

assert current == 17
C.save()
(BUILD/'layout.json').write_text(json.dumps(positions,ensure_ascii=False,indent=2),encoding='utf-8')
(BUILD/'slides.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2),encoding='utf-8')
(BUILD/'images.json').write_text(json.dumps(images,ensure_ascii=False,indent=2),encoding='utf-8')
copy = ['# Lume: apresentação comercial visual', 'Versão com telas do produto e exemplos demonstrativos. Contato: (81) 99404-5493.']
for slide in slides:
    copy.append(f'## {slide["slide"]:02d}. {slide["title"]}')
    copy.extend(p['text'] for p in positions if p['slide']==slide['slide'] and p['text'] not in ['Lume','LUME','APRESENTAÇÃO COMERCIAL'] and not re.match(r'^\d+ / 17$',p['text']))
(ROOT/'docs/research/lume-apresentacao-comercial-visual.md').write_text('\n\n'.join(copy)+'\n',encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':current,'images':len(images),'bytes':DEST.stat().st_size},ensure_ascii=False))
