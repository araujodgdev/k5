'use strict'

var views = ['#consulta', '#resultado']

var cargosG2 = ['Relator(a)', 'Relator(a) do acórdão', 'Revisor(a)']

var cargosG1 = ['Magistrado(a)', '-', '-']

$(window).on('hashchange', function(){
	var hash = self.location.hash;
	if (views.indexOf(hash) == -1) hash = '#consulta';
	exibeView(hash);
})

var exibeView = function(hash) {
	$('.view:not(' + hash + 'View)').css('display', 'none');
	$(hash + 'View').css('display', 'block');
	window.scrollTo(0, 0);
}

var toast = function(mensagem, icone) {
	if (!icone) icone = 'check'
	$('#toasty .toast-header i').removeClass().addClass('fa fa-' + icone)
	$('#toasty .toast-body').html(mensagem)
	$('#toasty').toast('show')
}

$('.toast').toast({
	delay: 5000
})

var copyText = function(text) {
	if (navigator.clipboard) {
		navigator.clipboard.writeText(text).then(function(){
			toast("Texto copiado com sucesso")
		})
	} else {
		var textarea = document.createElement("textarea")
		textarea.value = text
		textarea.style.top = "0";
		textarea.style.left = "0"
		textarea.style.position = "fixed"
		document.body.appendChild(textarea)
		textarea.select()
		try {
			if (document.execCommand('copy')) toast("Texto copiado com sucesso")
		} catch (err) {
			toast("Funcionalidade não suportada pelo navegador", "times")
		}
		document.body.removeChild(textarea)
	}
}

var isoToDate = function(date) {
	return date && date.match(/^\d{4}-\d{2}-\d{2}$/)? 
		new Date(date + " 00:00").toLocaleDateString("pt-BR") : '-';
}

var populateSelect = function(options) {
	$.ajax({
		type: 'get',
		url: options.url
	}).done(function(lista) {
		$(options.id).selectize()[0].selectize.destroy()
		if (lista && lista.length) {
			let opcoes = lista.map((e) => { return {text: e}})

			$(options.id).selectize({
				labelField: 'text',
				valueField: 'text',
				searchField: 'text',
				placeholder: options.defaultMessage,
				options: opcoes
			})[0].selectize.enable()

		} else {
			$(options.id).selectize({
				labelField: 'text',
				valueField: 'value',
				searchField: 'value',
				placeholder: options.emptyMessage,
				options: []
			})[0].selectize.disable()
		}
	}).fail(function() {
		toast("Erro ao preencher lista", 'times')
	})
}

var pubToHtml = function(pub) {
	return pub.sigla + " - " + isoToDate(pub.data) + ", pág. " + pub.numeroPagina 
}

var docToHtml = function(r, m) {
	let totalLinhas = m.settings._iRecordsTotal
	let nlinha = m.settings._iDisplayStart + m.row + 1

	let orgaoJulg = (r.orgaoJulgador || '-')
	if (r.instancia == 'G1') orgaoJulg += ' / ' + r.orgao

	let dataJulg = isoToDate(r.dataJulgamento)
	let dataAut = isoToDate(r.dataAutuacao)
	let cargos = r.instancia == 'G1'? cargosG1: cargosG2

	let texto = ""
	if (r.texto) texto = r.texto.replace(/\s*[\r\n]+\s*/g, "<br><br>")
	else if (r.ementa) texto = r.ementa.replace(/\\s*[\r\n]+\s/g, "<br><br>")

	let url = r.url || 'https://www.trf5.jus.br/index.php/consulta-processual-fisico-e-eletronico'
	let html = '<div class="row" id="documento' + nlinha + '">' 
	  + '<div class="col-6 cabecalho">Documento #' + nlinha + '</div>'
	  + '<div class="col-6 text-right" style="margin-top: 15px">'
	if (nlinha > 1) {
		html += '<a class="op-anterior" data-id="' + (nlinha - 1) + '" title="Documento anterior"><i class="fa fa-arrow-up"></i></a>'
	}
	if (nlinha < totalLinhas) {
		html += '<a class="op-proximo" data-id="' + (nlinha + 1) + '" title="Próximo documento"><i class="fa fa-arrow-down"></i></a>'
	}
	html += '</div>'
	  + '</div>'
	  + '<div class="row">' 
	  + '<div class="col-2">Processo: </div><div class="col-4"><a target="_blank" href="' + url + '" title="Detalhes do processo ' 
	    + r.numeroProcesso + '"><i class="fa fa-search"></i> ' + r.numeroProcesso + '</a></div>'
	  + '<div class="col-2">Órgão Julgador: </div><div class="col-4">' + orgaoJulg + '</div>'
	  + '<div class="col-2">Classe: </div><div class="col-4">' + r.classeJudicial 
	      + (r.numeroSequencialClasse && r.numeroSequencialClasse.indexOf("null") < 0? ' - ' + r.numeroSequencialClasse: '') + '</div>'
	  + '<div class="col-2">Data Julgamento: </div><div class="col-4">' + dataJulg + '</div>'
	  + '<div class="col-2">' + cargos[0] + ': </div><div class="col-4">' + r.relator + '</div>'
	  + '<div class="col-2">Data Autuação: </div><div class="col-4">' + dataAut + '</div>'
	  + (r.relatorAcordao? '<div class="col-2">' + cargos[1] + ': </div><div class="col-10">' + r.relatorAcordao + '</div>' : '')
	  + (r.revisor? '<div class="col-2">' + cargos[2] + ': </div><div class="col-10">' + r.revisor + '</div>' : '')
	  + (r.decisao? '<div class="col-1 cabecalho">Decisão</div><div class="col-12 text-justify">' + r.decisao + '</div>': '')
	  if (texto) {
		  html += '<div class="col-sm-2 cabecalho">Texto</div>' 
			  + '<div class="col-sm-10" style="margin-top: 15px">' 
			  + '<a href="#" class="op-copiar-texto" data-target="#texto-' + nlinha + '" title="Copiar texto sem formatação"><i class="fa fa-copy"></i> Copiar texto</a>' 
			  + '</div><div class="col-12 text-justify" id="texto-' + nlinha + '">' + texto + '<br>' + r.resumo + '</div>'
	  }
	if (r.publicacoes && r.publicacoes.length) {
		html += '<div class="col-12 cabecalho">Publicações</div>'
		for (let i = 0; i < r.publicacoes.length; i++) {
			html += '<div class="col-12">' + pubToHtml(r.publicacoes[i]) + '</div>'
		}
	}
	if (r.referenciasLegislativas && r.referenciasLegislativas.length) {
		html += '<div class="col-12 cabecalho">Referências Legislativas</div>'
		for (let i = 0; i < r.referenciasLegislativas.length; i++) {
			html += '<div class="col-12">' + r.referenciasLegislativas[i] + '</div>'
		}
	}
	
	if (r.outrasReferencias) {
		html += '<div class="col-12 cabecalho">Outras Referências</div>'
		html += '<div class="col-12">' + r.outrasReferencias + '</div>'
	}
	if (r.votantes && r.votantes.length) {
		html += '<div class="col-12 cabecalho">Votantes</div>'
		for (let i = 0; i < r.votantes.length; i++) {
			html += '<div class="col-12">' + r.votantes[i] + '</div>'
		}
	}
	if (r.observacao) {
		html += '<div class="col-12 cabecalho">Observações</div>'
		html += '<div class="col-12">' + r.observacao + '</div>'
	}
	html += '</div>'
	return html		
}

$('.campo-data').mask('00/00/0000')

$('.op-voltar-topo').click(function() {
	document.getElementById('containerNav').scrollIntoView()
})

$('.op-voltar').click(function(){
	history.back()
})
