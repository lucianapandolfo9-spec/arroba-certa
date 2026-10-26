// sw.js — Service Worker do Certo Agro
// ============================================================================
// O QUE ISTO FAZ HOJE (atualizado 11/10/2026): cacheia só o CASCO do app — o HTML, as
// páginas legais e os assets estáticos — pra abrir rápido e instalar como PWA.
// NÃO cacheia nenhum dado que vem do banco. Isso é regra do projeto, não
// preferência técnica: "preço da @ é ao vivo, com data e fonte — nunca de
// cabeça." Mostrar uma cotação ou um lucro calculado com dado requentado,
// disfarçado de atual, é pior do que não mostrar nada.
//
// O QUE AINDA FALTA PRA OFFLINE DE VERDADE (pedido explícito da Luciana:
// "já deixe salvo pra gente evoluir pra ele funcionar até offline") — e por
// que não foi feito agora:
//
//   1. FILA DE AÇÕES EM INDEXEDDB. Hoje, sem rede, toda escrita (lançar
//      pesagem, custo, sanitário, criar fazenda) falha na hora porque vai
//      direto pro Supabase. Offline de verdade exige guardar essas ações
//      localmente (IndexedDB, não localStorage — volume e tipo de dado não
//      cabem bem em string) e tentar de novo quando a rede voltar.
//   2. BACKGROUND SYNC (`self.registration.sync.register(...)` +
//      `addEventListener('sync', ...)`). É o mecanismo do browser pra
//      disparar essa fila sozinho quando a conexão retorna, mesmo com o app
//      fechado. Sem isso, a fila só esvazia se o produtor abrir o app nessa
//      hora — já ajuda, mas não é a experiência completa.
//   3. RESOLUÇÃO DE CONFLITO. O cenário que mais preocupa: a mesma fazenda
//      editada em dois lugares (celular no curral sem sinal + computador em
//      casa) antes de sincronizar. Hoje não existe estratégia nenhuma pra
//      isso — nem "o último que chegou ganha", nem checagem de versão. Isso
//      tem que ser decidido ANTES de construir a fila (é decisão de produto,
//      não só técnica): perder o dado do produtor é pior que ele não poder
//      editar offline.
//
// Nenhuma dessas três peças está aqui. O que está pronto é o que elas vão
// precisar por baixo: cache versionado, separação clara entre "casco" (pode
// cachear) e "dado" (nunca cacheia), e o service worker já registrado e
// funcionando. Quem continuar isso não precisa reconstruir o alicerce.
// ============================================================================

// ONDE O APP MORA. Nada de caminho fixo aqui: a base vem do escopo em que este
// service worker foi registrado (index.html registra em APP_BASE). Hoje o app
// está na raiz ('/'). Se a Luciana puser o app em outro caminho (ex.: '/app/'),
// o único lugar que muda é a constante APP_BASE no index.html; este arquivo
// precisa ser publicado junto, na mesma pasta do index.html.
const BASE = new URL(self.registration.scope).pathname; // sempre termina com '/'

// A landing NÃO é do app. O service worker nunca intercepta nem cacheia estes
// caminhos (início do pathname): a requisição vai direto pra rede, como se este
// arquivo não existisse. Se a landing mudar de pasta, acrescentar aqui.
const CAMINHOS_FORA_DO_APP = ['/pecuaria/', '/lp/', '/landing/', '/pecuaria-de-lucro/'];

// Versiona o cache. Subir uma versão nova aqui é o gatilho pra `activate`
// limpar o cache velho.
const CACHE_VERSION = 'certo-agro-v9'; // v8: onboarding PR 1 (tour, lote mínimo, exemplo, checklist, lucro honesto; calc.js no casco) · v7: equipe por convite de e-mail (multi-fazenda entrega 2) · v6: várias fazendas por conta + seletor (multi-fazenda entrega 1) · v5: trial de 15 dias (12/10/2026) · v4: convite PWA, atualização por clique, base derivada do escopo

// O casco: só isto entra no cache. Nada daqui fala com Supabase/n8n.
const CASCO = [
  '',
  'index.html',
  'manifest.json',
  'assets/calc.js',
  'privacidade.html',
  'termos.html',
  'cancelamento.html',
  'assets/favicon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-192.png',
  'assets/icon-maskable-512.png',
  'assets/apple-touch-icon.png',
  'assets/logo-simbolo.png',
  'assets/logo-horizontal.png',
  'assets/logo-horizontal-branco.png'
].map((p) => BASE + p);

// 🔴 A LINHA QUE PROTEGE O PRODUTO DE MENTIR. Qualquer request pra estes
// hosts passa DIRETO — sem cache, sem fallback, sem este service worker
// nem encostar nela. São os lugares de onde vem dado que muda:
// Supabase (banco, auth, cotação, lote, assinatura, CRM), o n8n (webhooks:
// chat de suporte, pagamento, cancelamento) e o Evolution (WhatsApp).
// Mercado Pago é outra origem e já cai na regra "fora da origem" abaixo.
// Cachear qualquer resposta dessas é a mesma classe de bug que o projeto já
// pagou caro: número velho parecendo atual.
const NUNCA_INTERCEPTAR = [
  '.supabase.co',
  'mcp.luhpanda.com.br',
  'n8n.luhpanda.com.br',
  'evo.luhpanda.com.br',
  'mercadopago.com',
  'mercadopago.com.br',
  'mercadolibre.com'
];

function ehProibido(url) {
  return NUNCA_INTERCEPTAR.some((host) => url.hostname === host.replace(/^\./, '') || url.hostname.endsWith(host));
}
function foraDoApp(url) {
  if (!url.pathname.startsWith(BASE)) return true; // outra pasta do mesmo domínio
  return CAMINHOS_FORA_DO_APP.some((c) => url.pathname.startsWith(c));
}
// Só recurso estático e versionado do casco é guardado. Nunca resposta com
// query (token, ?code= do login, retorno de pagamento) nem rota desconhecida.
function ehCasco(url) {
  return !url.search && CASCO.includes(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CASCO))
  );
  // SEM skipWaiting automático (mudou na v4). Versão nova espera: o app mostra
  // o botão "Atualizar aplicativo" num momento seguro (sem formulário nem
  // pagamento) e só então manda SKIP_WAITING. Trocar de versão no meio de um
  // pagamento ou de um lançamento seria pior que ficar uns minutos na antiga.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_VERSION)
          .map((nome) => caches.delete(nome))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Só GET entra no raciocínio de cache. POST/PUT/PATCH/DELETE (toda escrita
  // no banco, todo webhook) nunca é cacheado — segunda camada de proteção.
  if (req.method !== 'GET') return;

  // 🔴 Ver comentário de NUNCA_INTERCEPTAR acima. `return` sem chamar
  // `respondWith()` = o browser lida com a requisição direto na rede.
  if (ehProibido(url)) return;

  // Fora da origem do próprio app (fontes, CDN do supabase-js, SDK do Mercado
  // Pago): não intercepta. Biblioteca de terceiro gerencia o cache dela.
  if (url.origin !== self.location.origin) return;

  // Landing e qualquer rota fora da base do app: direto pra rede.
  if (foraDoApp(url)) return;

  // Network-first com fallback pro cache: tenta a rede sempre primeiro, e
  // só usa o que está guardado se a rede falhar de verdade (sem sinal).
  //
  // HTML (navegação) vai com cache:'no-cache': o GitHub Pages manda
  // max-age=600, e sem isso o cache HTTP do navegador serviria um HTML de até
  // 10 min atrás. 'no-cache' = sempre revalida (304 barato quando não mudou).
  const ehHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  event.respondWith(
    fetch(ehHTML ? req.url : req, ehHTML ? { cache: 'no-cache', credentials: 'same-origin' } : undefined)
      .then((resposta) => {
        // Só guarda resposta válida (200) de recurso do casco, e só uma CÓPIA.
        if (resposta && resposta.status === 200 && ehCasco(url)) {
          const copia = resposta.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(url.pathname, copia));
        }
        return resposta;
      })
      .catch(async () => {
        const guardado = await caches.match(url.pathname);
        if (guardado) return guardado;
        // Sem rede e a URL tem query (?utm_...) ou é a raiz: serve o casco.
        if (ehHTML) return (await caches.match(BASE)) || (await caches.match(BASE + 'index.html'));
        return Response.error();
      })
  );
});
