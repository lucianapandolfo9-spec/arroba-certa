// assets/track.js: medicao com consentimento (LGPD), UTMs e cookies do Certo Agro.
// Usado pela landing (/lp/) e pelo app (raiz). Unico lugar com os IDs.
//
// REGRAS
// 1. Nada de pixel ou GA4 carrega (nem o script) antes do "Aceitar".
// 2. Recusou: nenhum evento sai. Nada e enfileirado para depois.
// 3. Todo evento leva um event_id unico (preparado para deduplicar com a API de
//    Conversoes, que o servidor vai mandar depois com o mesmo event_id).
// 4. A faixa de cookies so aparece na landing (init com banner:true). No app,
//    so rastreia quem ja aceitou na landing; quem entra direto no app nao e
//    rastreado.
(function (root) {
  'use strict';

  // ---- configuracao (unico arquivo com estes valores) ----
  var META_PIXEL_ID = '2628063940971695';
  var GA4_ID = '';                        // 'G-XXXXXXXXXX' quando a Luciana fornecer. Vazio = GA4 desligado.

  var CHAVE_CONSENTIMENTO = 'ca:consent:v1';   // 'aceito' | 'recusado'
  var CHAVE_UTM = 'ca:utm:v1';
  var CAMPOS_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

  // Evento do Meta -> nome no GA4. custom=true usa trackCustom no Meta.
  var EVENTOS = {
    PageView:             { ga4: 'page_view' },
    ViewContent:          { ga4: 'calc_concluida' },
    Lead:                 { ga4: 'clique_whatsapp' },
    CliqueTesteGratis:    { ga4: 'clique_teste_gratis', custom: true },
    CompleteRegistration: { ga4: 'sign_up' },
    StartTrial:           { ga4: 'inicio_trial' },
    InitiateCheckout:     { ga4: 'begin_checkout' }
  };

  var carregado = false;

  // ---------- armazenamento defensivo (Safari privado, cota cheia) ----------
  function ler(chave) { try { return root.localStorage.getItem(chave); } catch (e) { return null; } }
  function gravar(chave, valor) { try { root.localStorage.setItem(chave, valor); } catch (e) {} }

  // ---------- consentimento ----------
  function consentimento() { return ler(CHAVE_CONSENTIMENTO); }       // null | 'aceito' | 'recusado'
  function aceito() { return consentimento() === 'aceito'; }

  // ---------- UTMs ----------
  // Guarda os parametros da URL (com data). Ultimo toque vence; so sobrescreve
  // se a URL atual trouxe algum parametro de campanha.
  function capturarUtms() {
    var dados = {}, achou = false;
    try {
      var p = new URLSearchParams(root.location.search);
      CAMPOS_UTM.forEach(function (c) {
        var v = p.get(c);
        if (v) { dados[c] = String(v).slice(0, 200); achou = true; }
      });
    } catch (e) {}
    if (achou) {
      dados.capturado_em = new Date().toISOString();
      gravar(CHAVE_UTM, JSON.stringify(dados));
    }
    return utms();
  }
  function utms() {
    var bruto = ler(CHAVE_UTM);
    if (!bruto) return {};
    try {
      var o = JSON.parse(bruto);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  // Query string com os UTMs guardados (sem a data), para repassar ao app (raiz).
  function utmsQuery(extras) {
    var u = utms(), p = new URLSearchParams();
    CAMPOS_UTM.forEach(function (c) { if (u[c]) p.set(c, u[c]); });
    if (extras) Object.keys(extras).forEach(function (k) { p.set(k, extras[k]); });
    var q = p.toString();
    return q ? '?' + q : '';
  }
  // Objeto para options.data do signUp (user_metadata do Supabase Auth).
  function utmsCadastro() {
    var u = utms(), o = {};
    CAMPOS_UTM.forEach(function (c) { if (u[c]) o[c] = u[c]; });
    if (u.capturado_em) o.utm_capturado_em = u.capturado_em;
    return o;
  }

  // ---------- event_id ----------
  function novoEventId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  // ---------- carregamento das bibliotecas (so depois do aceite) ----------
  function carregarMeta() {
    if (!META_PIXEL_ID || root.fbq) return;
    (function (f, b, e, v) {
      var n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      var t = b.createElement(e); t.async = true; t.src = v;
      var s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(root, root.document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    root.fbq('init', META_PIXEL_ID);
  }
  function carregarGa4() {
    if (!GA4_ID || root.gtag) return;
    root.dataLayer = root.dataLayer || [];
    root.gtag = function () { root.dataLayer.push(arguments); };
    var s = root.document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    root.document.head.appendChild(s);
    root.gtag('js', new Date());
    root.gtag('config', GA4_ID, { send_page_view: false });
  }
  function carregarBibliotecas() {
    if (carregado || !aceito()) return;
    carregado = true;
    carregarMeta();
    carregarGa4();
  }

  // ---------- disparo ----------
  // track('PageView') etc. Devolve o event_id usado, ou null se nada saiu.
  function track(nome, dados) {
    var def = EVENTOS[nome];
    if (!def || !aceito()) return null;
    carregarBibliotecas();
    var id = novoEventId();
    var params = dados || {};
    try {
      if (root.fbq) {
        root.fbq(def.custom ? 'trackCustom' : 'track', nome, params, { eventID: id });
      }
    } catch (e) {}
    try {
      if (root.gtag && GA4_ID) {
        var g = { event_id: id };
        Object.keys(params).forEach(function (k) { g[k] = params[k]; });
        root.gtag('event', def.ga4, g);
      }
    } catch (e) {}
    return id;
  }

  // ---------- faixa de cookies ----------
  var faixa = null;
  function fecharFaixa() {
    if (faixa && faixa.parentNode) faixa.parentNode.removeChild(faixa);
    faixa = null;
    root.document.documentElement.classList.remove('com-faixa-cookies');
  }
  function mostrarFaixa(aoAceitar) {
    if (faixa) return;
    var d = root.document;
    faixa = d.createElement('div');
    faixa.className = 'faixa-cookies';
    faixa.setAttribute('role', 'region');
    faixa.setAttribute('aria-label', 'Aviso de cookies');
    var p = d.createElement('p');
    p.appendChild(d.createTextNode('Usamos cookies para medir quantas pessoas visitam o site e melhorar os anúncios. Você escolhe. '));
    var a = d.createElement('a');
    a.href = '/privacidade.html#medicao';
    a.textContent = 'Política de Privacidade';
    p.appendChild(a);
    var botoes = d.createElement('div');
    botoes.className = 'faixa-cookies__botoes';
    var bOk = d.createElement('button'); bOk.type = 'button'; bOk.className = 'btn btn--cookie'; bOk.textContent = 'Aceitar';
    var bNo = d.createElement('button'); bNo.type = 'button'; bNo.className = 'btn btn--cookie'; bNo.textContent = 'Recusar';
    bOk.addEventListener('click', function () {
      gravar(CHAVE_CONSENTIMENTO, 'aceito');
      fecharFaixa();
      if (aoAceitar) aoAceitar();
    });
    bNo.addEventListener('click', function () {
      gravar(CHAVE_CONSENTIMENTO, 'recusado');
      fecharFaixa();
    });
    botoes.appendChild(bOk); botoes.appendChild(bNo);
    faixa.appendChild(p); faixa.appendChild(botoes);
    d.body.appendChild(faixa);
    d.documentElement.classList.add('com-faixa-cookies');
  }

  // Reabre a escolha (link "Preferencias de cookies" no rodape). Se a pessoa ja
  // tinha aceitado, o pixel ja esta na pagina: recarrega para o novo "Recusar"
  // valer de verdade (a pagina volta sem pixel).
  function reabrirEscolha() {
    var tinhaAceito = aceito();
    try { root.localStorage.removeItem(CHAVE_CONSENTIMENTO); } catch (e) {}
    if (tinhaAceito) { root.location.reload(); return; }
    mostrarFaixa(function () { carregarBibliotecas(); track('PageView'); });
  }

  // ---------- inicio ----------
  // opcoes.banner: mostra a faixa se ainda nao houve escolha (so a landing).
  // opcoes.pageView: dispara PageView ao iniciar (so a landing).
  function init(opcoes) {
    opcoes = opcoes || {};
    capturarUtms();
    if (aceito()) {
      carregarBibliotecas();
      if (opcoes.pageView) track('PageView');
    } else if (opcoes.banner && consentimento() === null) {
      var aoAceitar = function () { carregarBibliotecas(); if (opcoes.pageView) track('PageView'); };
      if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', function () { mostrarFaixa(aoAceitar); });
      } else { mostrarFaixa(aoAceitar); }
    }
  }

  root.CertoTrack = {
    init: init,
    track: track,
    aceito: aceito,
    consentimento: consentimento,
    reabrirEscolha: reabrirEscolha,
    utms: utms,
    utmsQuery: utmsQuery,
    utmsCadastro: utmsCadastro
  };
})(window);
