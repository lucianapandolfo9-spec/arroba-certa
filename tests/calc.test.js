// Teste da calculadora da landing. Rodar: node tests/calc.test.js
// Sem dependencia. Os exemplos vem da skill pecuaria-calculos (fonte da verdade).
'use strict';
var assert = require('assert');
var C = require('../assets/calc.js');

var falhas = 0, total = 0;
function t(nome, fn) {
  total++;
  try { fn(); console.log('ok   ' + nome); }
  catch (e) { falhas++; console.log('FALHOU ' + nome + '\n     ' + e.message); }
}
function perto(a, b, tol) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), a + ' != ' + b); }

// Lote base: 450 kg -> 540 kg em 90 dias, R$ 6/dia, magro R$ 2.500, @ a R$ 300, rendimento 0,53
var base = { pesoEntrada: '450', pesoSaida: '540', dias: '90', custoDia: '6', custoCompra: '2500', precoArroba: '300', rendimento: '0,53' };
function com(o) { var r = {}; Object.keys(base).forEach(function (k) { r[k] = base[k]; }); Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }

t('skill #1: 540 kg x 0,53 = 286,2 kg = 19,08 @', function () {
  var r = C.calcular(base);
  assert.ok(r.ok);
  perto(540 * 0.53, 286.2, 1e-9);
  perto(r.arrobas, 19.08, 1e-9);
});
t('skill #2: GMD de 450 a 540 em 90 dias = 1,0', function () {
  perto(C.calcular(base).gmd, 1.0);
});
t('skill #4: custo por cabeca = 2500 + 6 x 90 = 3040', function () {
  perto(C.calcular(base).custoCabeca, 3040);
});
t('skill #5: custo da @ produzida = 540 / (90 x 0,53 / 15) = 169,81', function () {
  var r = C.calcular(base);
  perto(r.custoArrobaProduzida, 540 / 3.18, 1e-9);
  perto(Math.round(r.custoArrobaProduzida * 100) / 100, 169.81);
});
t('skill #7: preco minimo da @ = 3040 / 19,08 = 159,33', function () {
  var r = C.calcular(base);
  perto(r.precoMinimo, 3040 / 19.08, 1e-9);
  perto(Math.round(r.precoMinimo * 100) / 100, 159.33);
});
t('skill #6: receita 5724, margem 2684, 88,3% sobre o custo', function () {
  var r = C.calcular(base);
  perto(r.receita, 5724, 1e-6);
  perto(r.margem, 2684, 1e-6);
  perto(Math.round(r.margemPct * 1000) / 10, 88.3);
});
t('margem negativa quando a @ esta abaixo do preco minimo', function () {
  var r = C.calcular(com({ precoArroba: '150' }));
  assert.ok(r.ok && r.margem < 0 && r.margemPct < 0);
});
t('custo de compra zero e aceito (animal nascido na fazenda)', function () {
  var r = C.calcular(com({ custoCompra: '0' }));
  assert.ok(r.ok);
  perto(r.custoCabeca, 540);
});
t('sem ganho (saida = entrada): calcula e custo da @ produzida e null', function () {
  var r = C.calcular(com({ pesoSaida: '450' }));
  assert.ok(r.ok);
  assert.strictEqual(r.custoArrobaProduzida, null);
  perto(r.gmd, 0);
});

t('vazio: "Falta preencher este número."', function () {
  var r = C.calcular(com({ dias: '' }));
  assert.ok(!r.ok);
  assert.strictEqual(r.erros.dias, 'Falta preencher este número.');
});
t('texto que nao e numero conta como vazio', function () {
  var r = C.calcular(com({ custoDia: 'abc' }));
  assert.strictEqual(r.erros.custoDia, 'Falta preencher este número.');
});
t('zero em peso, dias, custo/dia e preco da @', function () {
  ['pesoEntrada', 'pesoSaida', 'dias', 'custoDia', 'precoArroba'].forEach(function (c) {
    var o = {}; o[c] = '0';
    var r = C.calcular(com(o));
    assert.ok(!r.ok && r.erros[c] === 'Digite um valor maior que zero.', c);
  });
});
t('saida menor que entrada', function () {
  var r = C.calcular(com({ pesoSaida: '400' }));
  assert.strictEqual(r.erros.pesoSaida, 'O peso de saída está menor que o de entrada. Confira.');
});
t('GMD acima de 3 kg/dia', function () {
  var r = C.calcular(com({ dias: '20' })); // 90 kg em 20 dias = 4,5
  assert.strictEqual(r.erros.dias, 'Ganho acima de 3 kg por dia é raro. Confira os pesos e os dias.');
});
t('GMD exatamente 3 e aceito', function () {
  assert.ok(C.calcular(com({ dias: '30' })).ok);
});
t('rendimento fora de 0,40 a 0,60 (e limites aceitos)', function () {
  ['0,39', '0,61', '53'].forEach(function (x) {
    assert.strictEqual(C.calcular(com({ rendimento: x })).erros.rendimento, 'Rendimento entre 0,40 e 0,60. Confira.', x);
  });
  assert.ok(C.calcular(com({ rendimento: '0,40' })).ok);
  assert.ok(C.calcular(com({ rendimento: '0,60' })).ok);
});

t('parseNumero: formatos brasileiros', function () {
  assert.strictEqual(C.parseNumero('540'), 540);
  assert.strictEqual(C.parseNumero('540,5'), 540.5);
  assert.strictEqual(C.parseNumero('1.234,56'), 1234.56);
  assert.strictEqual(C.parseNumero('2.500'), 2500);
  assert.strictEqual(C.parseNumero('0.53'), 0.53);
  assert.strictEqual(C.parseNumero('R$ 300,00'), 300);
  assert.strictEqual(C.parseNumero(''), null);
  assert.ok(isNaN(C.parseNumero('12abc')));
});

t('frescor: dia util entre a cotacao e hoje', function () {
  var qua = new Date(2026, 9, 14);                 // quarta, 14/10/2026
  assert.strictEqual(C.diasUteisEntre('2026-10-14', qua), 0);
  assert.strictEqual(C.diasUteisEntre('2026-10-09', qua), 3);  // sexta -> seg, ter, qua
  assert.ok(C.cotacaoFresca('2026-10-09', qua));
  assert.ok(!C.cotacaoFresca('2026-10-08', qua));              // quinta -> 4 dias uteis
  assert.ok(!C.cotacaoFresca('', qua));
  assert.ok(!C.cotacaoFresca('lixo', qua));
});
t('frescor: fim de semana nao conta', function () {
  var seg = new Date(2026, 9, 12);                 // segunda, 12/10/2026
  assert.strictEqual(C.diasUteisEntre('2026-10-09', seg), 1);  // sexta -> segunda
});

// Exemplo do painel vazio (Fazenda Santa Helena): conferido a mao pela skill.
// 402 x 0,53 / 15 = 14,204 @/cab; compra 3.700/cab; custos 4.840 no lote = 121/cab.
t('exemplo Santa Helena: gastou, vale hoje e sobra batem com a formula', function () {
  var x = C.exemploSantaHelena();
  assert.ok(x);
  perto(x.custosLancados, 4840);
  perto(x.arrobasCab, 402 * 0.53 / 15, 1e-9);
  perto(x.gastou, 148000 + 4840, 1e-6);                       // #4 x 40
  perto(x.valeHoje, 40 * (402 * 0.53 / 15) * 320, 1e-6);     // 181.811,20
  perto(Math.round(x.valeHoje * 100) / 100, 181811.2);
  perto(x.sobra, x.valeHoje - x.gastou, 1e-6);                 // 28.971,20
  perto(x.gmd, 0.7, 1e-9);                                     // #2 (402-360)/60
  perto(x.custoArrobaProduzida, 121 / (42 * 0.53 / 15), 1e-9); // #5 = 81,54
  perto(x.precoMinimo, 3821 / (402 * 0.53 / 15), 1e-9);        // #7 = 269,01
});

console.log('\n' + (total - falhas) + '/' + total + ' testes passaram');
process.exit(falhas ? 1 : 0);
