from pathlib import Path
from io import BytesIO
import json, re
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

ROOT=Path(__file__).resolve().parents[2]
BUILD=ROOT/'tmp/lume-comercial'
OUT=ROOT/'output/pdf'
BUILD.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
for name,file in [('Geist','Geist-400.ttf'),('Display','Geist-450.ttf'),('Geist-Bold','Geist-600.ttf'),('Mono','GeistMono.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(BUILD/'assets'/file)))
pdfmetrics.registerFontFamily('Geist',normal='Geist',bold='Geist-Bold',italic='Geist',boldItalic='Geist-Bold')
pdfmetrics.registerFontFamily('Display',normal='Display',bold='Geist-Bold',italic='Display',boldItalic='Geist-Bold')

W,H=720,404.88
INK='#232323'; PAPER='#FFFFFF'; ORANGE='#D97757'; LIGHT_ORANGE='#EBA184'; GRAY='#5C5C5C'; SOFT='#B8B8B8'
DEST=OUT/'lume-apresentacao-comercial.pdf'
C=canvas.Canvas(str(DEST),pagesize=(W,H),pageCompression=1)
C.setTitle('Lume | Apresentação comercial')
C.setAuthor('Lume')
C.setSubject('Plataforma para advogados e pequenos escritórios')
WA='https://wa.me/5581994045493'
LOGO=(ROOT/'apps/web/public/lume.svg').read_text(encoding='utf-8')
slides=[];positions=[];current=0;dark=False

def txt(s,x,y,w,size=12,leading=None,color=None,font='Geist',maxh=None):
    color=color or (PAPER if dark else INK)
    style=ParagraphStyle('t',fontName=font,fontSize=size,leading=leading or size*1.28,textColor=HexColor(color),splitLongWords=False)
    obj=Paragraph(s,style);_,height=obj.wrap(w,1000)
    if maxh and height>maxh: raise ValueError(f'Slide {current}: block too tall ({height} > {maxh}): {s}')
    if y+height>(H-7 if y>=374 else H-35): raise ValueError(f'Slide {current}: bottom overflow: {s}')
    obj.drawOn(C,x,H-y-height)
    positions.append(dict(slide=current,x=x,y=y,width=w,height=height,text=re.sub('<[^>]*>','',s)))
    return height
def rule(x,y,w,color=None,width=.5):
    C.setStrokeColor(HexColor(color or ('#565656' if dark else '#C9C9C9')));C.setLineWidth(width);C.line(x,H-y,x+w,H-y)
def logo(x=32,y=17,color=None):
    col=color or (PAPER if dark else INK)
    draw=svg2rlg(BytesIO(LOGO.replace('currentColor',col).encode()))
    draw.width=18;draw.height=18;draw.scale(18/24,18/24)
    renderPDF.draw(draw,C,x,H-y-18)
    txt('Lume',x+24,y-1,120,17,19,color=col,font='Display')
def label(s,x=36,y=66,color=None):
    return txt(s,x,y,648,7.2,10,color=color or (LIGHT_ORANGE if dark else '#B0502F'),font='Mono')
def title(s,x=36,y=91,w=340,size=30):
    return txt(s,x,y,w,size,size*1.04,font='Display')
def start(section,is_dark=False,orange=False):
    global current,dark
    current+=1;dark=is_dark
    C.setFillColor(HexColor(ORANGE if orange else INK if dark else PAPER));C.rect(0,0,W,H,stroke=0,fill=1)
    logo();txt('APRESENTAÇÃO COMERCIAL',476,23,170,6.8,9,font='Mono',color=INK if orange else SOFT if dark else GRAY)
    txt(f'{current:02d} / 17',652,23,40,6.8,9,font='Mono',color=INK if orange else SOFT if dark else GRAY)
    rule(36,374,648,INK if orange else None)
    txt('LUME',36,383,70,6,8,color=INK if orange else SOFT if dark else GRAY,font='Mono')
    txt(section.upper(),400,383,284,6,8,color=INK if orange else SOFT if dark else GRAY,font='Mono')
    C.bookmarkPage(f's{current}');C.addOutlineEntry(section,f's{current}',0,False)
    slides.append({'slide':current,'title':section})
def end():C.showPage()
def rows(items,x=366,y=92,w=318,step=51,numbered=True):
    for i,(head,body) in enumerate(items,1):
        rule(x,y-8,w)
        offset=26 if numbered else 0
        if numbered:txt(f'{i:02d}',x,y+2,21,8,10,font='Mono',color=LIGHT_ORANGE if dark else '#B0502F')
        txt(head,x+offset,y,w-offset,12,15,font='Geist-Bold')
        if body:txt(body,x+offset,y+21,w-offset,9.5,12.3,color=SOFT if dark else GRAY,maxh=step-20)
        y+=step
def note(s,y=344,x=36,w=648):return txt(s,x,y,w,8,10.5,color=SOFT if dark else GRAY)
def big_num(s,x,y):txt(s,x,y,120,58,60,color=LIGHT_ORANGE if dark else ORANGE,font='Display')

# 01. Reference cover rhythm, with the Lume identity and concrete product language.
start('Um espaço de trabalho para a advocacia',True)
label('PARA ADVOGADOS E PEQUENOS ESCRITÓRIOS',y=80)
title('O contexto do caso.<br/>O trabalho do escritório.<br/><font color="'+LIGHT_ORANGE+'">Tudo conectado no Lume.</font>',y=111,w=650,size=36)
txt('Documentos, pesquisa jurídica, redação, agenda e honorários<br/>em um espaço de trabalho para a sua rotina.',36,249,625,14,19,color='#D9D9D9')
rule(36,312,648)
txt('DOCUMENTOS  /  IA  /  PESQUISA  /  GESTÃO  /  HONORÁRIOS',36,329,648,8.2,11,font='Mono',color=SOFT)
end()

# 02. Product introduction replaces agency credentials and unsupported metrics.
start('Para quem é o Lume')
label('O PRODUTO')
title('Feito para a rotina<br/>de quem advoga.',w=330,size=31)
txt('O Lume reúne as informações do caso e as ferramentas usadas para pesquisar, redigir e organizar o trabalho.',36,177,289,13,18,color=GRAY)
txt('Você acompanha o cliente, a próxima tarefa e os honorários sem perder de vista o caso.',36,254,289,12,17,color=GRAY)
rows([
 ('Advogados individuais','Organização para conduzir os casos e acompanhar a própria rotina.'),
 ('Escritórios de 2 a 5 advogados','Contexto compartilhado e responsabilidades visíveis para a equipe.'),
 ('Quem trabalha com muitos documentos','Arquivos, pesquisa e rascunhos ligados ao caso em que serão usados.')
],y=104,step=78)
end()

# 03. Pain diagnosis mirrors the reference dark split layout.
start('O trabalho que se repete',True)
label('O PROBLEMA')
title('Cada informação<br/>em um lugar.<br/><font color="'+LIGHT_ORANGE+'">O trabalho recomeça.</font>',w=312,size=31)
txt('Abrir arquivos, refazer buscas e explicar o caso de novo toma espaço do trabalho jurídico.',36,237,285,12,17,color=SOFT)
rows([
 ('Documentos dispersos','Procurar a versão certa entre pastas e conversas.'),
 ('Contexto que se perde','Repetir os fatos ao pesquisar ou redigir uma peça.'),
 ('Tarefas sem acompanhamento','Depender da memória para saber quem faz o quê.'),
 ('Honorários fora da rotina','Consultar outra planilha para saber o que falta receber.')
],y=104,step=59)
end()

# 04. Flat editorial columns are the reference's solution composition.
start('O caso conecta a rotina')
label('A RESPOSTA')
title('Organize o caso.<br/><font color="#B0502F">Trabalhe a partir dele.</font>',w=640,size=32)
cols=[('Documentos','Guarde os arquivos e encontre as informações que precisa.'),('Pesquisa e redação','Use o contexto do caso para pesquisar e preparar rascunhos.'),('Rotina do escritório','Relacione clientes, responsáveis, tarefas e reuniões.'),('Honorários','Acompanhe parcelas, valores recebidos e pendentes.')]
for i,(a,b) in enumerate(cols):
    x=36+i*166
    label(f'0{i+1}',x,207)
    txt(a,x,230,145,13,16,font='Geist-Bold')
    txt(b,x,269,143,10.5,14,color=GRAY)
note('Uma base de trabalho para conectar as informações que o escritório usa todos os dias.',347)
end()

# 05. A clear demonstration scenario replaces the source's customer logo slide.
start('Um fluxo para experimentar',True)
label('NA PRÁTICA')
title('Comece por<br/>um caso<br/><font color="'+LIGHT_ORANGE+'">do escritório.</font>',w=300,size=34)
txt('Na demonstração, percorremos uma tarefa que já faz parte do seu trabalho.',36,239,280,13,18,color=SOFT)
rows([
 ('Organize os documentos','Reúna os arquivos necessários ao trabalho.'),
 ('Recupere os fatos','Consulte o material e peça um resumo ou cronologia.'),
 ('Prepare e revise a peça','Trabalhe no rascunho e confira as fontes.'),
 ('Defina a próxima tarefa','Registre o responsável e a data de acompanhamento.')
],y=103,step=59)
end()

# 06. Overview, similar to the original numbered offering list.
start('O que você encontra no Lume')
label('OS MÓDULOS')
title('As ferramentas<br/>do seu trabalho,<br/><font color="#B0502F">no mesmo lugar.</font>',w=315,size=30)
txt('Cada módulo atende a uma parte da rotina e aproveita as informações organizadas pelo escritório.',36,244,284,12,17,color=GRAY)
rows([
 ('Cofre','Documentos e arquivos por caso.'),
 ('Assistente Lume','Análise, cronologias e rascunhos com IA.'),
 ('Pesquisa','Jurisprudência e fontes para conferir.'),
 ('Escritório','Clientes, equipe, tarefas e agenda.'),
 ('Honorários','Parcelas, recebidos e pendências. Em lançamento.')
],y=92,step=51)
end()

# 07. Feature detail, typographic treatment rather than invented UI.
start('Cofre')
big_num('01',36,72)
label('DOCUMENTOS E CASOS',152,79)
title('Encontre a informação<br/>dentro dos arquivos.',152,103,525,29)
txt('Organize a documentação do escritório e use o conteúdo dos arquivos no trabalho com o caso.',36,190,281,13,18,color=GRAY)
rows([
 ('Organização por caso','Biblioteca, pastas e documentos no mesmo ambiente.'),
 ('Leitura de documentos','PDFs e outros formatos, incluindo PDFs digitalizados com OCR.'),
 ('Consulta ao conteúdo','Encontre informações e selecione arquivos como fontes para o Lume.')
],x=366,y=190,step=51)
note('O documento original continua disponível para consulta e conferência.',346)
end()

# 08. A genuine screen from the current Lume validation environment.
start('Assistente Lume',True)
label('02 / ASSISTENTE LUME')
title('Peça a partir<br/><font color="'+LIGHT_ORANGE+'">do contexto.</font>',w=260,size=30)
txt('Selecione os documentos do caso e converse com o Lume para analisar fatos, organizar uma cronologia e preparar uma minuta.',36,173,245,11.7,16)
txt('Revise o conteúdo no editor e exporte a peça em DOCX.',36,264,245,11.7,16,color=SOFT)
screen=ROOT/'apps/web/playwright-report/verify/20260928T140026-b6d179/brand-shell/02-agents.png'
C.drawImage(str(screen),310,H-111-231,370,231,preserveAspectRatio=True,anchor='c',mask='auto')
note('Interface do Lume em ambiente de demonstração.',348,x=310,w=370)
end()

# 09. Research claims stick to supported functionality, with review in the workflow.
start('Pesquisa jurídica')
big_num('03',36,72)
label('PESQUISA JURÍDICA',152,79)
title('Pesquise com o caso em mente.<br/><font color="#B0502F">Confira a fonte antes de citar.</font>',152,103,525,28)
rows([
 ('Busque por uma questão concreta','Descreva o tema, os fatos relevantes e o que precisa encontrar.'),
 ('Consulte as fontes','Abra os resultados e verifique o conteúdo que sustenta o argumento.'),
 ('Aproveite a pesquisa no caso','Salve referências e retome o histórico para continuar o trabalho.')
],x=36,y=207,w=648,step=47)
end()

# 10. Office management: permissions and manually set dates, no judicial automation claims.
start('Clientes, tarefas e agenda',True)
label('04 / ESCRITÓRIO')
title('Saiba o que precisa<br/>ser feito.<br/><font color="'+LIGHT_ORANGE+'">E por quem.</font>',w=316,size=31)
txt('Conecte o cadastro do cliente aos casos e às atividades do escritório.',36,237,280,13,18,color=SOFT)
rows([
 ('Clientes','Contatos, informações e casos relacionados.'),
 ('Tarefas','Responsáveis, datas e acompanhamento do que foi concluído.'),
 ('Agenda','Reuniões e atividades organizadas no calendário.'),
 ('Equipe','Compartilhamento e acesso conforme a participação de cada pessoa.')
],y=104,step=59)
end()

# 11. Financial example is explicitly illustrative, not a screenshot or performance claim.
start('Financeiro de honorários')
big_num('05',36,72)
label('HONORÁRIOS / NOVO MÓDULO',152,79)
title('O que entrou.<br/><font color="#B0502F">O que falta receber.</font>',152,103,525,30)
txt('Cadastre os honorários, organize as parcelas e acompanhe os valores recebidos e pendentes.',36,207,251,13,18,color=GRAY)
label('EXEMPLO ILUSTRATIVO',326,204)
ps=ParagraphStyle('table',fontName='Geist',fontSize=10,leading=13,textColor=HexColor(INK))
ph=ParagraphStyle('tableh',fontName='Geist-Bold',fontSize=8.5,leading=12,textColor=HexColor(GRAY))
data=[[Paragraph(s,ph) for s in ['Parcela','Valor','Situação']]]+[[Paragraph(s,ps) for s in r] for r in [('1 de 3','R$ 1.000','Recebida'),('2 de 3','R$ 1.000','Pendente'),('3 de 3','R$ 1.000','Pendente')]]
t=Table(data,colWidths=[100,110,148]);t.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.5,HexColor('#D9D9D9'))]));_,th=t.wrap(358,200);t.drawOn(C,326,H-226-th)
note('Módulo em lançamento. Confirme a disponibilidade na demonstração.',350)
end()

# 12. Collaboration benefit, without repeating an image or inventing testimonials.
start('Trabalho compartilhado',True)
label('PARA O DIA A DIA DA EQUIPE')
title('O caso continua.<br/><font color="'+LIGHT_ORANGE+'">Mesmo quando outra<br/>pessoa assume.</font>',w=345,size=31)
txt('Documentos, referências e atividades organizados ajudam a equipe a retomar o trabalho.',36,248,288,12,17,color=SOFT)
rows([
 ('Compartilhe o material necessário','Dê acesso ao caso para quem participa do trabalho.'),
 ('Mantenha as responsabilidades visíveis','Registre quem acompanha cada atividade.'),
 ('Trabalhe pelo navegador','Acesse o Lume no computador ou no celular, com internet.')
],x=390,y=112,w=294,step=76)
end()

# 13. Human onboarding, as agreed in the canvas.
start('Implantação acompanhada')
label('COMO VOCÊ COMEÇA')
title('A primeira entrega<br/>é acompanhada<br/><font color="#B0502F">de perto.</font>',w=310,size=31)
txt('Os fundadores ajudam a configurar o ambiente e a experimentar o Lume em uma tarefa do escritório.',36,239,280,12.5,17.5,color=GRAY)
rows([
 ('Entendemos a sua rotina','Escolhemos um caso e uma tarefa para começar.'),
 ('Configuramos o ambiente','Orientamos a organização inicial e o acesso da equipe.'),
 ('Acompanhamos o primeiro uso','Você testa o fluxo e tira dúvidas durante a implantação.'),
 ('Revisamos a experiência','Nas primeiras semanas, conversamos sobre uso e dificuldades.')
],y=104,step=59)
end()

# 14. Responsibilities, not sweeping compliance or certification claims.
start('Revisão e controle',True)
label('NO TRABALHO JURÍDICO')
title('A IA apoia.<br/><font color="'+LIGHT_ORANGE+'">Você revisa e decide.</font>',w=630,size=34)
items=[('Fontes para conferência','Consulte os documentos e as referências usados no trabalho antes de aproveitar o conteúdo.'),('Revisão das peças','Confira fatos, fundamentos, pedidos e citações antes de apresentar qualquer documento.'),('Acesso por participação','Organize quem pode consultar ou colaborar nos materiais do escritório.'),('Confirmação de ações','O Lume pede confirmação antes de ações como excluir documentos ou sobrescrever uma minuta.')]
for i,(head,body) in enumerate(items):
    x=36+(i%2)*340;y=218+(i//2)*74
    rule(x,y-9,307);txt(head,x,y,300,12,15,font='Geist-Bold');txt(body,x,y+24,300,10.3,14,color=SOFT)
end()

# 15. Confirmed revenue model; test prices are intentionally not published as a promise.
start('Como funciona a contratação')
label('CONTRATAÇÃO')
title('Uma assinatura<br/><font color="#B0502F">para o escritório.</font>',w=325,size=31)
txt('Na proposta, você recebe o plano, os usuários incluídos, os limites de uso e as condições de implantação.',36,203,288,12.5,17.5,color=GRAY)
rows([
 ('Mensalidade por escritório','O plano considera o tamanho da equipe e o uso incluído.'),
 ('Expansão conforme a necessidade','O escritório pode avaliar um plano maior à medida que cresce.'),
 ('Serviços adicionais por escopo','Migração extensa e treinamentos adicionais são combinados separadamente.')
],y=115,step=76)
end()

# 16. Qualification close instead of agency case study / quantified promises.
start('O que vamos olhar na demonstração',True)
label('DEMONSTRAÇÃO')
title('Traga uma tarefa<br/><font color="'+LIGHT_ORANGE+'">da sua rotina.</font>',w=320,size=32)
txt('Podemos usar um exemplo ou documentos que você tenha autorização para compartilhar.',36,199,283,12.5,17.5,color=SOFT)
rows([
 ('Onde estão as informações?','Como você organiza os documentos e recupera o contexto hoje.'),
 ('Como a entrega é preparada?','O caminho entre a pesquisa, o rascunho e a revisão.'),
 ('O que precisa ser acompanhado?','Tarefas, responsabilidades e honorários do escritório.')
],y=115,step=76)
note('O objetivo é verificar se o Lume atende ao seu modo de trabalhar.',346)
end()

# 17. Reference-style full brand close, real supplied contact and functional link.
start('Agende uma demonstração',False,True)
label('PRÓXIMO PASSO',y=79,color=INK)
title('Veja o Lume<br/>na rotina do<br/>seu escritório.',y=108,w=397,size=39)
txt('Converse com a equipe e escolha<br/>um caso para a demonstração.',36,259,358,14,19,color=INK)
rule(449,115,231,INK)
txt('AGENDE PELO WHATSAPP',449,139,231,8.5,12,font='Mono',color=INK)
txt(f'<link href="{WA}" color="{INK}">(81) 99404-5493</link>',449,173,231,24,30,color=INK,font='Display')
txt(f'<link href="{WA}" color="{INK}"><u>Abrir conversa no WhatsApp</u></link>',449,225,231,11.5,16,color=INK)
txt('Implantação assistida.<br/>Contato direto com os fundadores.',449,292,231,11.5,16,color=INK)
end()

C.save()
if current!=17:raise ValueError('Expected 17 slides')
(BUILD/'layout.json').write_text(json.dumps(positions,ensure_ascii=False,indent=2),encoding='utf-8')
(BUILD/'slides.json').write_text(json.dumps(slides,ensure_ascii=False,indent=2),encoding='utf-8')
copy=['# Lume: apresentação comercial','\nTexto da apresentação baseada no Canvas aprovado. Contato: (81) 99404-5493.\n']
for s in slides:
    copy.append(f'\n## {s["slide"]:02d}. {s["title"]}\n')
    copy.extend(p['text'] for p in positions if p['slide']==s['slide'] and p['text'] not in ['Lume','LUME','APRESENTAÇÃO COMERCIAL'] and not re.match(r'^\d+ / 17$',p['text']))
(ROOT/'docs/research/lume-apresentacao-comercial.md').write_text('\n\n'.join(copy),encoding='utf-8')
print(json.dumps({'pdf':str(DEST),'pages':current,'bytes':DEST.stat().st_size},ensure_ascii=False))
