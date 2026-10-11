// Finds a 30-second preview for a song. Uses the public iTunes Search API
// first and Deezer as a fallback. Both are called through JSONP so the game
// works when index.html is opened straight from disk (no server needed).
(function () {
  const CACHE_KEY = "hitster.previewCache.v1";
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) {}
  const saveCache = () => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  };

  let seq = 0;
  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const name = "__hitster_cb" + ++seq;
      const s = document.createElement("script");
      const done = (fn, v) => {
        clearTimeout(t);
        delete window[name];
        s.remove();
        fn(v);
      };
      const t = setTimeout(() => done(reject, new Error("timeout")), timeoutMs);
      window[name] = (data) => done(resolve, data);
      s.onerror = () => done(reject, new Error("network"));
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + name;
      document.head.appendChild(s);
    });
  }

  const norm = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\b(feat|ft|featuring)\b.*$/, " ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const BAD = /karaoke|tribute|cover|instrumental|made famous|in the style|lullaby|piano version|8.bit|workout|re-?recorded/i;

  function score(song, artist, title, extra) {
    const wantA = norm(song.artist), wantT = norm(song.title);
    const a = norm(artist), t = norm(title);
    const firstArtist = norm(song.artist.split(/,|&| and | x /i)[0]);
    let s = 0;
    if (t === wantT) s += 50;
    else if (t.startsWith(wantT) || wantT.startsWith(t)) s += 30;
    else if (t.includes(wantT) || wantT.includes(t)) s += 15;
    else return -1;
    if (a === wantA) s += 50;
    else if (firstArtist && (a.includes(firstArtist) || firstArtist.includes(a))) s += 35;
    else return -1;
    if (BAD.test(title + " " + artist + " " + (extra || ""))) s -= 60;
    if (/\b(live|remix|mix|edit|acoustic|demo)\b/i.test(title) && !/\b(live|remix|mix|edit|acoustic|demo)\b/i.test(song.title)) s -= 10;
    return s;
  }

  async function fromItunes(song) {
    const term = encodeURIComponent(`${song.artist} ${song.title}`.replace(/[()]/g, " "));
    const data = await jsonp(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=25`);
    let best = null, bestScore = 0;
    for (const r of data.results || []) {
      if (!r.previewUrl) continue;
      const sc = score(song, r.artistName, r.trackName, r.collectionName);
      if (sc > bestScore) { best = r.previewUrl; bestScore = sc; }
    }
    return best;
  }

  async function fromDeezer(song) {
    const q = encodeURIComponent(`artist:"${song.artist.split(/,|&/)[0].trim()}" track:"${song.title.replace(/"/g, "")}"`);
    const data = await jsonp(`https://api.deezer.com/search?q=${q}&limit=25&output=jsonp`);
    let best = null, bestScore = 0;
    for (const r of data.data || []) {
      if (!r.preview) continue;
      const sc = score(song, r.artist && r.artist.name, r.title, r.album && r.album.title);
      if (sc > bestScore) { best = r.preview; bestScore = sc; }
    }
    return best;
  }

  const inflight = {};
  // Resolves to a preview URL, or null when no source has the song.
  function findPreview(song) {
    const key = `${song.artist}|${song.title}`;
    if (key in cache) return Promise.resolve(cache[key]);
    if (inflight[key]) return inflight[key];
    inflight[key] = (async () => {
      let url = null, reachedAny = false;
      for (const source of [fromItunes, fromDeezer]) {
        try {
          url = await source(song);
          reachedAny = true;
          if (url) break;
        } catch (e) { /* try the next source */ }
      }
      // Only remember the answer if a service actually responded,
      // so a flaky connection doesn't blacklist songs.
      if (reachedAny) { cache[key] = url; saveCache(); }
      delete inflight[key];
      if (!reachedAny) throw new Error("offline");
      return url;
    })();
    return inflight[key];
  }

  window.Music = { findPreview };
})();
