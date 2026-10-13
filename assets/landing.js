// assets/landing.js: comportamento da landing (links para o app, WhatsApp por
// criativo, calculadora, cotacao ao vivo, cookies). Depende de calc.js e track.js.
(function () {
  'use strict';
  var T = window.CertoTrack, C = window.CertoCalc;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- medicao ----------
  // Faixa de cookies + PageView so depois do aceite. Captura UTMs sempre.
  T.init({ banner: true, pageView: true });

  // ---------- links para o app, com UTMs ----------
  function appUrl(extras) { return '/' + T.utmsQuery(extras); }
  Array.prototype.forEach.call(document.querySelectorAll('a[data-app]'), function (a) {
    a.setAttribute('href', appUrl());
  });
  Array.prototype.forEach.call(document.querySelectorAll('a[data-teste]'), function (a) {
    a.addEventListener('click', function () {
      T.track('CliqueTesteGratis', { plano: a.getAttribute('data-teste') });
    });
  });

  // ---------- WhatsApp pre-preenchido por criativo (?utm_content=dor|numero|prova) ----------
  var WA = 'https://wa.me/5581991923030?text=';
  var TEXTOS = {
    dor: 'Oi, vim pelo anúncio "Boi bonito não é lucro certo". Quero saber se o meu lote dá lucro.',
    numero: 'Oi, vim pelo anúncio "Quanto custa a sua arroba?". Quero saber quanto custa a minha.',
    prova: 'Oi, vim pelo anúncio "Isto é o Certo Agro funcionando". Quero ver como funciona.',
    neutro: 'Oi, vim pelo site do Certo Agro. Quero saber como funciona.'
  };
  var conteudo = (T.utms().utm_content || '').toLowerCase();
  var texto = TEXTOS[conteudo] || TEXTOS.neutro;
  Array.prototype.forEach.call(document.querySelectorAll('a[data-wa]'), function (a) {
    a.setAttribute('href', WA + encodeURIComponent(texto));
    a.addEventListener('click', function () { T.track('Lead'); });
  });

  // ---------- preferencias de cookies ----------
  var prefs = $('prefs-cookies');
  if (prefs) prefs.addEventListener('click', function () { T.reabrirEscolha(); });

  // ---------- formatacao ----------
  function brl(n) { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dec(n, c) { return n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function paraCampo(n) { return n.toFixed(2).replace('.', ','); }

  // ---------- calculadora ----------
  var CAMPOS = ['pesoEntrada', 'pesoSaida', 'dias', 'custoDia', 'custoCompra', 'precoArroba', 'rendimento'];
  var form = $('calc-form');
  var jaMediu = false;

  function limparErros() {
    CAMPOS.forEach(function (c) {
      $('e-' + c).textContent = '';
      $('c-' + c).removeAttribute('aria-invalid');
    });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparErros();
    var entrada = {};
    CAMPOS.forEach(function (c) { entrada[c] = $('c-' + c).value; });
    var r = C.calcular(entrada);
    var res = $('resultado');
    if (!r.ok) {
      res.hidden = true;
      var primeiro = null;
      CAMPOS.forEach(function (c) {
        if (r.erros[c]) {
          $('e-' + c).textContent = r.erros[c];
          $('c-' + c).setAttribute('aria-invalid', 'true');
          if (!primeiro) primeiro = $('c-' + c);
        }
      });
      if (primeiro) primeiro.focus();
      return;
    }

    $('r-gmd').textContent = dec(r.gmd, 2) + ' kg/dia';
    $('r-arrobas').textContent = dec(r.arrobas, 2) + ' @';
    $('r-custoArroba').textContent = r.custoArrobaProduzida === null ? 'Sem ganho no período' : brl(r.custoArrobaProduzida);
    $('r-custoCabeca').textContent = brl(r.custoCabeca);
    $('r-precoMinimo').textContent = brl(r.precoMinimo);
    var m = $('r-margem');
    m.textContent = brl(r.margem);
    if (r.margemPct !== null) {
      var small = document.createElement('small');
      small.textContent = ' (' + dec(r.margemPct * 100, 1) + '%)';
      m.appendChild(small);
    }
    m.className = r.margem < 0 ? 'neg' : '';

    // Botao "Salvar esse lote no meu app": numeros como parametros da URL do app.
    // O app ainda ignora estes parametros (ver README da entrega).
    var v = function (c) { return String(C.parseNumero(entrada[c])); };
    $('salvar-lote').setAttribute('href', appUrl({
      origem: 'calculadora',
      calc_pesoEntrada: v('pesoEntrada'), calc_pesoSaida: v('pesoSaida'), calc_dias: v('dias'),
      calc_custoDia: v('custoDia'), calc_custoCompra: v('custoCompra'),
      calc_precoArroba: v('precoArroba'), calc_rendimento: v('rendimento')
    }));

    res.hidden = false;
    res.focus({ preventScroll: true });
    if (typeof res.scrollIntoView === 'function') res.scrollIntoView({ block: 'nearest' });
    if (!jaMediu) { jaMediu = true; T.track('ViewContent', { content_name: 'calculadora' }); }
  });

  // ---------- cotacao ao vivo (RPC publica cotacao_publica, so leitura, chave anon) ----------
  var COT_URL = 'https://zctczffncbtgpmnyxfup.supabase.co/rest/v1/rpc/cotacao_publica';
  var COT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjdGN6ZmZuY2J0Z3Btbnl4ZnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MjcwMzgsImV4cCI6MjEwNjMwMzAzOH0.83Cg-lkjP3o7uPpcazf9M1BfzkyqOu7pUVAZOyRsO6Y';
  var COT_CACHE = 'ca:cot:v1', COT_TTL_MS = 5 * 60 * 1000;
  var ORDEM = ['MG', 'GO', 'MS', 'SP'];

  function buscarCotacao() {
    try {
      var c = JSON.parse(sessionStorage.getItem(COT_CACHE) || 'null');
      if (c && Date.now() - c.t < COT_TTL_MS && Array.isArray(c.rows)) return Promise.resolve(c.rows);
    } catch (e) {}
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 7000) : null;
    return fetch(COT_URL, {
      method: 'POST',
      headers: { apikey: COT_ANON, Authorization: 'Bearer ' + COT_ANON, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (timer) clearTimeout(timer);
        if (Array.isArray(rows) && rows.length) {
          try { sessionStorage.setItem(COT_CACHE, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) {}
        }
        return rows;
      })
      .catch(function () { if (timer) clearTimeout(timer); return []; });
  }

  function chaveOrdem(praca) {
    var p = String(praca || '').toUpperCase();
    for (var i = 0; i < ORDEM.length; i++) { if (p.indexOf(ORDEM[i]) !== -1) return i; }
    return 99;
  }

  buscarCotacao().then(function (rows) {
    // Dado velho (mais de 3 dias uteis), vazio ou invalido: a faixa some e fica
    // a linha alternativa que ja esta no HTML. O campo da @ fica vazio.
    if (!Array.isArray(rows) || rows.length < 2) return;
    var data = rows[0] && rows[0].data;
    if (!C.cotacaoFresca(data, new Date())) return;
    var validas = rows.filter(function (r) { return r && isFinite(Number(r.valor_rs)) && Number(r.valor_rs) > 0; });
    if (validas.length < 2) return;
    validas.sort(function (a, b) { return chaveOrdem(a.praca) - chaveOrdem(b.praca); });

    var ul = $('cot-lista');
    ul.textContent = '';
    validas.forEach(function (r) {
      var li = document.createElement('li');
      var b = document.createElement('b'); b.textContent = r.praca;
      var s = document.createElement('span'); s.textContent = brl(Number(r.valor_rs));
      li.appendChild(b); li.appendChild(s); ul.appendChild(li);
    });
    ul.hidden = false;
    var d = String(data).slice(0, 10).split('-');
    var dataBr = d[2] + '/' + d[1] + '/' + d[0];
    $('cot-fonte').textContent = 'Cotação de ' + dataBr + ' · ' + (validas[0].fonte || 'Scot Consultoria') + '. MG · GO · MS · SP.';

    // Pre-preenche a @ do calculo: media das praças, com atalho para cada uma.
    var soma = 0;
    validas.forEach(function (r) { soma += Number(r.valor_rs); });
    var campo = $('c-precoArroba');
    var dica = $('dica-praca'), chips = $('chips-praca');
    function usar(valor, rotulo, botao) {
      campo.value = paraCampo(valor);
      dica.textContent = rotulo + ' · cotação de ' + dataBr;
      dica.hidden = false;
      Array.prototype.forEach.call(chips.children, function (x) { x.setAttribute('aria-pressed', x === botao ? 'true' : 'false'); });
    }
    if (!campo.value) usar(soma / validas.length, 'Média das ' + validas.length + ' praças', null);
    validas.forEach(function (r) {
      var bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'chip'; bt.setAttribute('aria-pressed', 'false');
      bt.textContent = 'Usar ' + r.praca;
      bt.addEventListener('click', function () { usar(Number(r.valor_rs), 'Praça ' + r.praca, bt); });
      chips.appendChild(bt);
    });
    chips.hidden = false;
  });
})();
