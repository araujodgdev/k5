'use strict'

$(document).ready(function(){

	var REGISTROS_POR_PAGINA = 10

	var focoInicio = function(){$('#pesquisaLivre').focus()}

	var limparFormulario = function() {
		document.getElementById("formConsulta").reset()
		$('#relator')[0].selectize.clear()
		$('#orgaoJulgador')[0].selectize.clear()
		return false
	}

	$('.op-limpar').click(function(){
		limparFormulario()
		focoInicio()
	})

	var atualizaOrigem = function(origem) {
		let cargos = origem == 'G1'? cargosG1: cargosG2

		$('.campo-relator').text(cargos[0])

		populateSelect({
			url: base + 'api/relatores/' + origemSelecionada(),
			id: '#relator',
			minLength: 3,
			defaultMessage: 'Selecione o(a) ' + cargos[0].toLowerCase(), 
			emptyMessage: 'Nehum registro localizado'
		})

		populateSelect({
			url: base + 'api/orgaos-julgadores/' + origemSelecionada(), 
			id: '#orgaoJulgador',
			minLength: 1,
			defaultMessage: 'Selecione o órgão julgador ', 
			emptyMessage: 'Nehum registro localizado'
		})
	}

	var origemSelecionada = function() {
		let origem = $('input[name=origem]:checked').val()
		if (origem == 'TR') origem += '_' + $('input[name=secaoJudiciaria]:checked').val()
		return origem
	}

	var populateTable = function(url, parametros) {
		let tabela = $('table#listagem').DataTable({
			searching: false,
			destroy: true,
			lengthChange: false,
			pageLength: REGISTROS_POR_PAGINA,
			paging: true,
			info: true,
			ordering: false,
			serverSide: true,
			ajax: {
				url: url,
				type: 'GET',
				data: parametros,
				error: function(_xhr, _error, _code) {
					toast('Ocorreu um erro ao efetuar a pesquisa', 'times')
				}
			},
			language: {url: base + 'js/datatables-pt-BR.js'},
			columns: [
				{
					data: 'codigoDocumento',
					render: function(d, t, r, m) {
						if (t == 'display') {
							return docToHtml(r, m)
						}
						return d
					}
				}
			],
			createdRow: function(r, _d, _di) {
				$(r).addClass('imprime');
			},
			drawCallback: function() {
				$('.op-proximo, .op-anterior').unbind().bind('click', function() {
					let id = $(this).data('id')
					let elemento =  (id > 1 && ((id - 1) % REGISTROS_POR_PAGINA == 0))? 
						'fimTabela' :
						'documento' + id;
					document.getElementById(elemento).scrollIntoView();
				})
				$('.op-copiar-texto').click(function() {
					var target = $(this).data('target');
					if (target) {
						var e = document.getElementById(target.substring(1));
						copyText(e.innerText)
					}
					return false
				})
			},
			initComplete: function() {
				self.location = '#resultado'
			}
		});

		tabela.on( 'xhr', function () {
			let json = tabela.ajax.json()
			let criterios = json && json.criteria? json.criteria: '-'
			let total = "nenhum documento localizado"

			if (json.recordsTotal == 1) {
				total = "1 documento localizado"
			} else if (json.recordsTotal > 1) {
				total = json.recordsTotal + " documentos localizados"
			}

			$('#cabecalhoPesquisa .criterios').html(criterios)
			$('#cabecalhoPesquisa .total').html(total)
		});

	}

	$('#formConsulta').submit(function(){

		let url = base + 'api/v1/documento:dt/' + origemSelecionada()

		let parametros = {
			pesquisaLivre: $('#pesquisaLivre').val(),
			numeroProcesso: $('#numeroProcesso').val(),
			orgaoJulgador: $('#orgaoJulgador').val(),
			relator: $('#relator').val(),
			dataIni: $('#dataIni').val(),
			dataFim: $('#dataFim').val()
		}

		populateTable(url, parametros)

		return false;
	})

	$('.op-nova-pesquisa').click(function() {
		self.location = '#consulta';
	})

	$(window).on('scroll', function() {
		$('.opcao-scroll').css('display', 
			self.location.hash == '#resultado' && window.scrollY > 100 ? 
				'block': 'none')
	})

	$('.operador').click(function() {
		let op = $(this).data('operador');
		$('#pesquisaLivre').val($('#pesquisaLivre').val() + op)
		$('#pesquisaLivre').focus()
	})

	$('input[name=origem],input[name=secaoJudiciaria]').click(function() {
		let instancia = $('input[name=origem]:checked').val()
		$('.secoes-judiciarias').css('display', instancia == 'TR'? 'flex': 'none')
		let origem = origemSelecionada()
		atualizaOrigem(origem)
	})

	self.location = '#consulta'

	atualizaOrigem('G2')

	focoInicio()
})