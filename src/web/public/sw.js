/* 深渊挂机 · 极简 Service Worker(cache-first,内容哈希资源天然安全)
 *
 * 所有路径用相对写法:自动适配部署根(GitHub Pages 的 /Everdown/ 子路径
 * 或自定义域名根路径),SHELL 相对路径按 SW 脚本所在 URL 解析。
 * 改动任何资源后 sw.js 字节变化即触发更新(bump VERSION 强制全刷)。
 */
const VERSION = "v22";
const CACHE = `abyss-idle-${VERSION}`;
const SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/abyss-mono.woff2",
  "./bgm/loop.wav",
  "./sfx/attack-hit.wav",
  "./sfx/skill-heavy.wav",
  "./sfx/skill-magic.wav",
  "./sfx/skill-arrow.wav",
  "./sfx/skill-burst.wav",
  "./sfx/skill-buff.wav",
  "./sfx/skill-shield.wav",
  "./sfx/skill-execute.wav",
  "./sfx/skill-fire.wav",
  "./sfx/skill-ice.wav",
  "./sfx/skill-zap.wav",
  "./sfx/skill-roar.wav",
  "./sfx/skill-ult.wav",
  "./sfx/skill-drain.wav",
  "./sfx/skill-mark.wav",
  "./sfx/skill-dash.wav",
  "./hero/warrior.png",
  "./hero/mage.png",
  "./hero/ranger.png",
  "./mon/slime.png", "./mon/slime-boss.png",
  "./mon/wolf.png", "./mon/wolf-boss.png",
  "./mon/goblin.png", "./mon/goblin-boss.png",
  "./mon/bat.png", "./mon/bat-boss.png",
  "./mon/skeleton.png", "./mon/skeleton-boss.png",
  "./mon/golem.png", "./mon/golem-boss.png",
  "./mon/imp.png", "./mon/imp-boss.png",
  "./mon/hound.png", "./mon/hound-boss.png",
  "./mon/elemental.png", "./mon/elemental-boss.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 仅同源

  // 入口页与 SW 自身:网络优先(保证发版能生效),失败回退缓存
  const scopeBase = new URL(self.registration.scope).pathname;
  const isEntry = url.pathname === scopeBase || url.pathname === scopeBase + "index.html";
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isEntry) {
      try {
        // no-store:绕过 HTTP/CDN 缓存取入口页,否则发版后最长 10 分钟仍开旧版
        const fresh = await fetch(req, { cache: "no-store" });
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(req);
        return hit || Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  })());
});
