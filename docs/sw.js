const CACHE = 'kaikai-search-v15-20261111-home-search-guide';
const ASSETS = ['./','./index.html','./app.css?v=20261111-home-search-guide','./app.js?v=20261111-home-search-guide','./search.js?v=20261111-standard-search','./question-bank.json','./road-skills-bank.json','./manifest.json','./icons/icon.svg','./icons/developer-logo.webp'];
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
