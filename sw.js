/* RCM Mastery service worker: makes the app open and work offline. */
const V = 'rcm-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const MODS = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];

self.addEventListener('install', function(e){
  e.waitUntil((async function(){
    const c = await caches.open(V);
    await Promise.all(SHELL.map(function(u){ return c.add(u).catch(function(){}); }));
    const seen = new Set();
    for(const m of MODS){ await pre(c, m, seen, 0); }
    self.skipWaiting();
  })());
});

// cache a Firebase module and the modules it imports
async function pre(c, url, seen, depth){
  if(seen.has(url) || depth > 4) return;
  seen.add(url);
  try{
    const r = await fetch(url, {mode:'cors'});
    if(!r.ok) return;
    await c.put(url, r.clone());
    const t = await r.text();
    const re = /(?:from|import)\s*["']([^"']+)["']/g; let m;
    while((m = re.exec(t))){
      const s = m[1];
      if(s.charAt(0) === '.' || s.indexOf('https://www.gstatic.com/') === 0){
        await pre(c, new URL(s, url).href, seen, depth + 1);
      }
    }
  }catch(err){}
}

self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== V; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(req.mode === 'navigate' && url.origin === location.origin){ e.respondWith(nav(req)); return; }
  if(url.origin === location.origin ||
     url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(swr(req));
  }
  // everything else (Firebase Auth / Firestore network calls) goes straight to the network
});

// pages: network first (so updates arrive), fall back to the saved copy when offline
async function nav(req){
  const c = await caches.open(V);
  try{
    const r = await Promise.race([fetch(req), new Promise(function(_, j){ setTimeout(function(){ j(new Error('slow')); }, 4000); })]);
    if(r && r.ok){ c.put('./index.html', r.clone()); }
    return r;
  }catch(err){
    return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
  }
}

// static files and libraries: serve saved copy instantly, refresh in the background
async function swr(req){
  const c = await caches.open(V);
  const hit = await c.match(req, {ignoreVary:true});
  const net = fetch(req).then(function(r){
    if(r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
    return r;
  }).catch(function(){ return null; });
  return hit || (await net) || Response.error();
}
