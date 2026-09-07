const CACHE = 'kaikai-search-v4-20260907-filter-edge';
const ASSETS = ['./','./index.html','./app.css?v=20260907-filter-edge','./app.js?v=20260907-autorefresh','./search.js','./question-bank.json','./manifest.json','./icons/icon.svg','./icons/developer-logo.webp'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('kaikai-search-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}
  catch{return await cache.match(event.request)||(event.request.mode==='navigate'?await cache.match('./index.html'):null)||new Response('离线资源不可用',{status:503});}
 })());
});
