// sw.js — Service Worker do Certo Agro
// ============================================================================
// O QUE ISTO FAZ HOJE (02/10/2026): cacheia só o CASCO do app — o HTML, as
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

// Versiona o cache. Subir uma versão nova aqui (v2, v3...) é o gatilho pra
// `activate` limpar o cache velho — sem isso, depois de um push no GitHub
// Pages o casco antigo convive com o novo e ela depura um fantasma.
const CACHE_VERSION = 'certo-agro-v3'; // v3: PWA (maskable, instalacao) sobre o v2 do hardening

// O casco: só isto entra no cache. Nada daqui fala com Supabase/n8n.
const CASCO = [
  '/',
  '/index.html',
  '/manifest.json',
  '/privacidade.html',
  '/termos.html',
  '/cancelamento.html',
  '/assets/favicon.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-192.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/logo-simbolo.png',
  '/assets/logo-horizontal.png',
  '/assets/logo-horizontal-branco.png'
];

// 🔴 A LINHA QUE PROTEGE O PRODUTO DE MENTIR. Qualquer request pra estes
// hosts passa DIRETO — sem cache, sem fallback, sem este service worker
// nem encostar nela. São os três lugares de onde vem dado que muda:
// Supabase (banco: cotação, lote, assinatura, o CRM de leads), o n8n
// (webhook do chat de suporte) e o Evolution (WhatsApp, caso algum dia o
// front fale direto com ele). Cachear qualquer resposta dessas é a mesma
// classe de bug que o projeto já pagou caro: número velho parecendo atual.
const NUNCA_INTERCEPTAR = [
  '.supabase.co',
  'mcp.luhpanda.com.br',
  'n8n.luhpanda.com.br',
  'evo.luhpanda.com.br'
];

function ehProibido(url) {
  return NUNCA_INTERCEPTAR.some((host) => url.hostname.endsWith(host));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CASCO))
  );
  // Não espera as abas antigas fecharem pra assumir — o casco é só leitura,
  // trocar de versão no meio da sessão não arrisca dado nenhum.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_VERSION)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Só GET entra no raciocínio de cache. POST/PUT/PATCH/DELETE (toda escrita
  // no banco, todo webhook) nunca deveria ser cacheado em hipótese nenhuma —
  // isso vale mesmo que algum dia um desses hosts caia na lista de permitidos
  // por engano. Segunda camada de proteção, de propósito.
  if (req.method !== 'GET') return;

  // 🔴 Ver comentário de NUNCA_INTERCEPTAR acima. `return` sem chamar
  // `respondWith()` = este service worker finge que não viu a requisição;
  // o browser lida com ela do jeito normal, direto na rede.
  if (ehProibido(url)) return;

  // Fora da origem do próprio app (fontes do Google, CDN do supabase-js,
  // SDK do Mercado Pago)? Mesma lógica: não intercepta. O casco é só o que
  // é NOSSO; biblioteca de terceiro gerencia o cache dela mesma.
  if (url.origin !== self.location.origin) return;

  // Network-first com fallback pro cache: tenta a rede sempre primeiro, e
  // só usa o que está guardado se a rede falhar de verdade (sem sinal). É
  // o oposto de "cache-first" de propósito — cache-first deixaria a Luciana
  // presa numa versão velha do HTML depois de um push no GitHub Pages,
  // porque o service worker nunca iria checar a rede de novo sozinho.
  event.respondWith(
    fetch(req)
      .then((resposta) => {
        // Só guarda resposta válida (200), e só guarda uma CÓPIA — o
        // original precisa voltar intacto pro browser consumir.
        if (resposta && resposta.status === 200) {
          const copia = resposta.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req))
  );
});
