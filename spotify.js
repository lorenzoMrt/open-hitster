// Spotify integration: login (OAuth PKCE, no server needed), track search,
// playlist import and playback, either in this browser through the Web
// Playback SDK or on any Spotify Connect device (phone, TV, smart speaker).
// Requires Spotify Premium and a free Spotify developer app (Client ID).
(function () {
  const API = "https://api.spotify.com/v1";
  const AUTH = "https://accounts.spotify.com";
  const SCOPES = [
    "streaming", "user-read-email", "user-read-private",
    "user-read-playback-state", "user-modify-playback-state",
    "playlist-read-private", "playlist-read-collaborative",
  ].join(" ");
  const K = { client: "hitster.spotify.clientId", tok: "hitster.spotify.token", ver: "hitster.spotify.verifier", cache: "hitster.spotify.trackCache.v1", user: "hitster.spotify.user" };

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const getJson = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };

  let token = getJson(K.tok, null); // {access, refresh, expires}
  let cache = getJson(K.cache, {});

  const canLogin = () => location.protocol === "https:" || /^(127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // Spotify needs the exact same URI registered in the developer dashboard.
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

  // ---------- auth ----------
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function login() {
    const clientId = get(K.client);
    if (!clientId) throw new Error("Enter your Spotify Client ID first.");
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    set(K.ver, verifier);
    const q = new URLSearchParams({
      response_type: "code", client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(),
      code_challenge_method: "S256", code_challenge: challenge,
    });
    location.assign(`${AUTH}/authorize?${q}`);
  }

  async function tokenRequest(params) {
    const res = await fetch(`${AUTH}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: get(K.client), ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.error || `Spotify login failed (${res.status})`);
    token = {
      access: data.access_token,
      refresh: data.refresh_token || (token && token.refresh),
      expires: Date.now() + (data.expires_in - 60) * 1000,
    };
    set(K.tok, JSON.stringify(token));
  }

  // Call once on page load: finishes a login if Spotify just redirected back here.
  // Returns "connected", an error message, or null when there was nothing to do.
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return null;
    history.replaceState(null, "", redirectUri());
    if (q.has("error")) return `Spotify login cancelled (${q.get("error")}).`;
    try {
      await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: get(K.ver) || "" });
      set(K.ver, null);
      const me = await api("/me");
      set(K.user, (me && (me.display_name || me.id)) || "Spotify user");
      return "connected";
    } catch (e) {
      return e.message;
    }
  }

  async function getToken() {
    if (!token) throw new Error("Not connected to Spotify.");
    if (Date.now() > token.expires) {
      try {
        await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh });
      } catch (e) {
        logout();
        throw new Error("Your Spotify login expired. Connect again on the setup screen.");
      }
    }
    return token.access;
  }

  function logout() {
    token = null;
    set(K.tok, null);
    set(K.user, null);
    if (sdkPlayer) { sdkPlayer.disconnect(); sdkPlayer = null; sdkDevice = null; sdkReady = null; }
  }

  async function api(path, opts = {}, retried) {
    const res = await fetch(path.startsWith("http") ? path : API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401 && !retried) { token.expires = 0; return api(path, opts, true); }
    if (res.status === 429 && !retried) {
      await new Promise((r) => setTimeout(r, (+res.headers.get("Retry-After") || 2) * 1000));
      return api(path, opts, true);
    }
    if (res.status === 204 || res.status === 202) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || res.statusText;
      const err = new Error(friendly(res.status, msg));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function friendly(status, msg) {
    if (/premium/i.test(msg)) return "Spotify Premium is needed to play songs.";
    if (/no active device|device not found/i.test(msg)) return "That Spotify device isn't available. Open Spotify on it, or pick another device.";
    if (status === 403) return `Spotify refused the request: ${msg}. If you're not the app's owner, ask them to add you under “User Management” in the developer dashboard.`;
    return `Spotify: ${msg}`;
  }

  // ---------- search ----------
  const clean = (s) => s.replace(/["():]/g, " ").replace(/\s+/g, " ").trim();

  async function findTrack(song) {
    if (song.uri) return song.uri;
    const key = `${song.artist}|${song.title}`;
    if (key in cache) return cache[key];
    const first = song.artist.split(/,|&| and | x /i)[0].trim();
    const queries = [`track:${clean(song.title)} artist:${clean(first)}`, `${clean(first)} ${clean(song.title)}`];
    let best = null, bestScore = 0;
    for (const q of queries) {
      // Development-mode apps get at most 10 search results.
      const data = await api(`/search?type=track&limit=10&market=from_token&q=${encodeURIComponent(q)}`);
      for (const t of (data && data.tracks && data.tracks.items) || []) {
        if (!t || t.is_playable === false) continue;
        const sc = Music.score(song, t.artists.map((a) => a.name).join(" & "), t.name, t.album && t.album.name);
        if (sc > bestScore) { best = t.uri; bestScore = sc; }
      }
      if (best) break;
    }
    cache[key] = best;
    set(K.cache, JSON.stringify(cache));
    return best;
  }

  // ---------- playlists ----------
  function playlistId(input) {
    const m = String(input).match(/playlist[/:]([A-Za-z0-9]{10,})/) || String(input).match(/^([A-Za-z0-9]{16,})$/);
    return m && m[1];
  }

  const VERSION_SUFFIX = /\s+-\s+.*\b(remaster(ed)?|version|edit|mono|stereo|mix|live|single|anniversary|deluxe)\b.*$/i;

  // Returns {name, songs: [{year, artist, title, uri}], suspicious}
  async function importPlaylist(input) {
    const id = playlistId(input);
    if (!id) throw new Error("That doesn't look like a Spotify playlist link.");
    const meta = await api(`/playlists/${id}?fields=name`);
    const songs = [];
    let suspicious = 0;
    // The items endpoint replaced /tracks in 2026; fall back for older behaviour.
    let next = `/playlists/${id}/items?limit=50`;
    try { await api(next.replace("50", "1")); } catch (e) { if (e.status === 404) next = `/playlists/${id}/tracks?limit=50`; else throw e; }
    while (next) {
      const page = await api(next);
      for (const it of page.items || []) {
        const t = it.item || it.track;
        if (!t || t.type !== "track" || t.is_local || !t.album) continue;
        const year = parseInt(t.album.release_date, 10);
        if (!year) continue;
        const title = t.name.replace(VERSION_SUFFIX, "");
        // Remasters and compilations carry their own date, not the song's.
        if (title !== t.name || /compilation/.test(t.album.album_type) || /greatest|best of|hits|collection|anthology/i.test(t.album.name)) suspicious++;
        songs.push({ year, artist: t.artists.map((a) => a.name).join(" & "), title, uri: t.uri });
      }
      next = page.next;
    }
    return { name: meta.name, songs, suspicious };
  }

  // ---------- playback ----------
  let sdkPlayer = null, sdkDevice = null, sdkReady = null, sdkPaused = true;
  const listeners = [];
  const emit = (st) => listeners.forEach((fn) => fn(st));

  // Loads the Web Playback SDK and registers this browser as a Spotify device.
  function initSdk() {
    if (sdkReady) return sdkReady;
    sdkReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("This browser couldn't start the Spotify player. Try Chrome/Edge/Firefox on a computer, or play on another device.")), 20000);
      window.onSpotifyWebPlaybackSDKReady = () => {
        sdkPlayer = new window.Spotify.Player({
          name: "Open Hitster",
          getOAuthToken: (cb) => getToken().then(cb, () => {}),
          volume: 0.9,
        });
        sdkPlayer.addListener("ready", ({ device_id }) => { clearTimeout(timer); sdkDevice = device_id; resolve(device_id); });
        sdkPlayer.addListener("not_ready", () => { sdkDevice = null; });
        sdkPlayer.addListener("player_state_changed", (st) => {
          if (!st) return;
          sdkPaused = st.paused;
          emit({ paused: st.paused });
        });
        const fail = ({ message }) => { clearTimeout(timer); emit({ error: friendly(0, message) }); reject(new Error(friendly(0, message))); };
        sdkPlayer.addListener("initialization_error", fail);
        sdkPlayer.addListener("authentication_error", fail);
        sdkPlayer.addListener("account_error", () => fail({ message: "Spotify Premium is needed to play songs." }));
        sdkPlayer.addListener("playback_error", ({ message }) => emit({ error: friendly(0, message) }));
        sdkPlayer.connect();
      };
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.onerror = () => { clearTimeout(timer); reject(new Error("Couldn't load the Spotify player. Check the internet connection.")); };
      document.head.appendChild(s);
    });
    sdkReady.catch(() => { sdkReady = null; });
    return sdkReady;
  }

  // Must run inside a click handler so browsers allow sound later on.
  function unlockAudio() {
    if (sdkPlayer && sdkPlayer.activateElement) sdkPlayer.activateElement();
  }

  async function deviceId(target) {
    return target === "browser" ? await initSdk() : target;
  }

  async function devices() {
    const data = await api("/me/player/devices");
    return ((data && data.devices) || []).filter((d) => !d.is_restricted && d.name !== "Open Hitster");
  }

  async function play(uri, target) {
    const id = await deviceId(target);
    await api(`/me/player/play?device_id=${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ uris: [uri], position_ms: 0 }) });
  }

  async function pause(target) {
    if (target === "browser") return sdkPlayer && sdkPlayer.pause();
    await api(`/me/player/pause?device_id=${encodeURIComponent(target)}`, { method: "PUT" }).catch(() => {});
  }

  async function resume(target) {
    if (target === "browser") return sdkPlayer && sdkPlayer.resume();
    await api(`/me/player/play?device_id=${encodeURIComponent(target)}`, { method: "PUT" });
  }

  async function seekBy(ms, target) {
    let pos = 0;
    if (ms !== null) {
      if (target === "browser" && sdkPlayer) {
        const st = await sdkPlayer.getCurrentState();
        pos = st ? st.position + ms : 0;
      } else {
        const st = await api("/me/player");
        pos = st ? st.progress_ms + ms : 0;
      }
    }
    if (target === "browser" && sdkPlayer) return sdkPlayer.seek(Math.max(0, pos));
    await api(`/me/player/seek?position_ms=${Math.max(0, pos)}&device_id=${encodeURIComponent(target)}`, { method: "PUT" });
  }

  window.SpotifyApi = {
    canLogin, redirectUri, login, logout, handleRedirect,
    isConnected: () => !!token,
    userName: () => get(K.user),
    clientId: () => get(K.client) || "",
    setClientId: (v) => set(K.client, v.trim() || null),
    findTrack, importPlaylist, devices, initSdk, unlockAudio,
    play, pause, resume,
    restart: (target) => seekBy(null, target),
    forward: (target) => seekBy(10000, target),
    onState: (fn) => listeners.push(fn),
    isPaused: () => sdkPaused,
  };
})();
