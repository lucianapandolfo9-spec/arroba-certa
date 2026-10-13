// sw.js da RAIZ: aposentado em 13/10/2026.
// O app mudou para /app/ e o service worker de verdade agora e /app/sw.js
// (escopo /app/). Este arquivo existe so para quem instalou o app ANTES da
// mudanca: o navegador dessa pessoa ainda tem um service worker registrado em
// '/sw.js' com escopo '/'. Ao atualizar para esta versao ele apaga os caches
// antigos v1 a v7 (que guardavam o app velho na raiz) e se desregistra. Nao intercepta
// nenhuma requisicao. Pode ser apagado do repositorio meses depois do merge.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => /^certo-agro-v[1-7]$/.test(n)).map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
  );
});
