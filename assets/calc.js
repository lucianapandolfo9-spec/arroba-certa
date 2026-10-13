// assets/calc.js: logica da calculadora da landing (e da regra de frescor da cotacao).
// Fonte unica das contas: skill pecuaria-calculos (formulas 1, 2, 4, 5, 6 e 7).
// Cliente-side puro: nao grava nada, nao envia nada. Funciona no navegador
// (window.CertoCalc) e no Node (require), para o teste tests/calc.test.js.
// Arredondar so na exibicao: o calculo intermediario nunca arredonda.
(function (root) {
  'use strict';

  var ARROBA_KG = 15;            // 1 @ = 15 kg de CARCACA
  var RENDIMENTO_MIN = 0.40;
  var RENDIMENTO_MAX = 0.60;
  var GMD_PLAUSIVEL_MAX = 3.0;   // acima disso e provavel erro de digitacao

  var MSG = {
    vazio: 'Falta preencher este número.',
    zero: 'Digite um valor maior que zero.',
    saidaMenor: 'O peso de saída está menor que o de entrada. Confira.',
    gmdAlto: 'Ganho acima de 3 kg por dia é raro. Confira os pesos e os dias.',
    rendimento: 'Rendimento entre 0,40 e 0,60. Confira.'
  };

  // Aceita "540", "540,5", "1.234,56", "1234.56" e "0.53". Ponto seguido de
  // exatamente 3 digitos (1.500, 15.000) e lido como milhar, que e como o
  // produtor brasileiro escreve. Devolve NaN se nao for numero, null se vazio.
  function parseNumero(texto) {
    if (texto === null || texto === undefined) return null;
    var t = String(texto).trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (t === '') return null;
    if (t.indexOf(',') !== -1) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.replace(/\./g, '');
    }
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // entradas: objeto com os 7 campos em texto ou numero:
  // pesoEntrada, pesoSaida, dias, custoDia, custoCompra, precoArroba, rendimento
  // saida: { ok:false, erros:{campo:mensagem} } ou { ok:true, ...resultado }
  function calcular(entradas) {
    var campos = ['pesoEntrada', 'pesoSaida', 'dias', 'custoDia', 'custoCompra', 'precoArroba', 'rendimento'];
    var v = {};
    var erros = {};
    campos.forEach(function (c) {
      var n = parseNumero(entradas[c]);
      if (n === null) { erros[c] = MSG.vazio; return; }
      if (isNaN(n)) { erros[c] = MSG.vazio; return; }
      v[c] = n;
    });

    // Pesos, dias e preco da @: maiores que zero. Custo diario: maior que zero.
    // Custo de compra do magro pode ser zero (animal nascido na fazenda).
    ['pesoEntrada', 'pesoSaida', 'dias', 'custoDia', 'precoArroba'].forEach(function (c) {
      if (!erros[c] && !(v[c] > 0)) erros[c] = MSG.zero;
    });
    if (!erros.custoCompra && v.custoCompra < 0) erros.custoCompra = MSG.zero;
    if (!erros.rendimento && (v.rendimento < RENDIMENTO_MIN || v.rendimento > RENDIMENTO_MAX)) {
      erros.rendimento = MSG.rendimento;
    }
    if (!erros.pesoSaida && !erros.pesoEntrada && v.pesoSaida < v.pesoEntrada) {
      erros.pesoSaida = MSG.saidaMenor;
    }
    if (!erros.pesoSaida && !erros.pesoEntrada && !erros.dias) {
      var gmdTeste = (v.pesoSaida - v.pesoEntrada) / v.dias;
      if (gmdTeste > GMD_PLAUSIVEL_MAX) erros.dias = MSG.gmdAlto;
    }
    if (Object.keys(erros).length) return { ok: false, erros: erros };

    // #2 GMD
    var gmd = (v.pesoSaida - v.pesoEntrada) / v.dias;
    // #1 arrobas do boi pronto
    var arrobas = (v.pesoSaida * v.rendimento) / ARROBA_KG;
    // #4 custo total por cabeca
    var custoPeriodo = v.custoDia * v.dias;
    var custoCabeca = v.custoCompra + custoPeriodo;
    // #5 custo da @ produzida (so o custo do ganho, sem a compra do magro)
    var arrobasGanhas = ((v.pesoSaida - v.pesoEntrada) * v.rendimento) / ARROBA_KG;
    var custoArrobaProduzida = arrobasGanhas > 0 ? custoPeriodo / arrobasGanhas : null;
    // #7 preco minimo da @ (breakeven)
    var precoMinimo = custoCabeca / arrobas;
    // #6 receita e margem
    var receita = arrobas * v.precoArroba;
    var margem = receita - custoCabeca;
    var margemPct = custoCabeca > 0 ? margem / custoCabeca : null;

    return {
      ok: true,
      gmd: gmd,
      arrobas: arrobas,
      custoArrobaProduzida: custoArrobaProduzida,
      custoCabeca: custoCabeca,
      precoMinimo: precoMinimo,
      receita: receita,
      margem: margem,
      margemPct: margemPct
    };
  }

  // Dias uteis (segunda a sexta) entre a data da cotacao (AAAA-MM-DD) e hoje.
  // Conta hoje, nao conta a data da cotacao. Feriados nao entram (conservador:
  // so deixa a faixa aparecer um pouco mais). Datas em UTC para nao depender do fuso.
  function diasUteisEntre(dataISO, hoje) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataISO || ''));
    if (!m) return Infinity;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    var fim = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
    if (d.getTime() > fim.getTime()) return 0;
    var n = 0;
    while (d.getTime() < fim.getTime()) {
      d = new Date(d.getTime() + 86400000);
      var dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) n++;
    }
    return n;
  }

  var LIMITE_DIAS_UTEIS = 3;
  // Regra de frescor: dado com mais de 3 dias uteis nao e mostrado.
  function cotacaoFresca(dataISO, hoje) {
    return diasUteisEntre(dataISO, hoje) <= LIMITE_DIAS_UTEIS;
  }

  var api = {
    ARROBA_KG: ARROBA_KG,
    MENSAGENS: MSG,
    parseNumero: parseNumero,
    calcular: calcular,
    diasUteisEntre: diasUteisEntre,
    cotacaoFresca: cotacaoFresca
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CertoCalc = api;
})(typeof window !== 'undefined' ? window : this);
