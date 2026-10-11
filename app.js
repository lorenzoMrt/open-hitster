(function () {
  "use strict";

  const GAME_KEY = "hitster.game.v1";
  const SETTINGS_KEY = "hitster.settings.v1";
  const CUSTOM_KEY = "hitster.custom.v1";
  const MAX_TOKENS = 5;
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;

  const app = document.getElementById("app");
  const audio = document.getElementById("audio");

  // ---------- persistence ----------
  const load = (k, d) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
  };
  const store = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  };

  const settings = Object.assign(
    { players: ["", ""], packs: ["hits", "christmas"], target: 10, startTokens: 2, source: "online" },
    load(SETTINGS_KEY, {})
  );
  let customSongs = load(CUSTOM_KEY, []); // [{year, artist, title}]
  let customDraft = null; // unsaved textarea text
  let S = load(GAME_KEY, null); // current game state, or null on the setup screen

  // Not persisted: File objects can't survive a reload.
  let localFiles = {}; // path -> File
  let localSongs = []; // [{year, artist, title, path}]
  let localStatus = "";

  // UI-only state
  const ui = { audio: "idle", audioMsg: "", toast: "", testing: null };
  let audioToken = 0;
  let objectUrl = null;

  const saveGame = () => (S ? store(GAME_KEY, S) : localStorage.removeItem(GAME_KEY));
  const saveSettings = () => store(SETTINGS_KEY, settings);

  // ---------- helpers ----------
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const songKey = (s) => `${s.artist}|${s.title}`.toLowerCase();
  const slotCorrect = (cards, slot, year) => {
    const prev = cards[slot - 1], next = cards[slot];
    return (!prev || prev.year <= year) && (!next || year <= next.year);
  };
  const insertSorted = (cards, card) => {
    let i = cards.findIndex((c) => c.year > card.year);
    if (i < 0) i = cards.length;
    cards.splice(i, 0, card);
  };
  const cur = () => S.players[S.current];

  let toastTimer;
  function toast(msg) {
    ui.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast = ""; render(); }, 4000);
  }

  function packSongs(id) {
    if (id === "custom") return customSongs;
    const p = window.SONG_PACKS[id];
    return p ? p.songs.map(([year, artist, title]) => ({ year, artist, title })) : [];
  }

  function availableSongs() {
    if (settings.source === "local") return localSongs.slice();
    const seen = new Set(), out = [];
    for (const id of settings.packs) {
      for (const s of packSongs(id)) {
        const k = songKey(s);
        if (!seen.has(k)) { seen.add(k); out.push(s); }
      }
    }
    return out;
  }

  // ---------- game flow ----------
  function startGame() {
    const names = settings.players.map((n) => n.trim()).filter(Boolean);
    if (names.length < 1) return toast("Add at least one player.");
    const songs = availableSongs();
    const needed = names.length * 2 + 5;
    if (songs.length < needed) {
      return toast(settings.source === "local"
        ? `Only ${songs.length} songs with a year were found; you need at least ${needed}.`
        : `Pick more song packs: you need at least ${needed} songs.`);
    }
    const deck = shuffle(songs.map((s, id) => ({ ...s, id })));
    S = {
      source: settings.source,
      target: Math.max(2, +settings.target || 10),
      players: names.map((name) => ({ name, cards: [deck.pop()], tokens: +settings.startTokens || 0 })),
      deck,
      current: 0,
      turn: 0,
    };
    beginTurn();
  }

  function beginTurn() {
    S.turn++;
    Object.assign(S, { phase: "place", slot: null, challenges: [], challenger: null, named: false, result: null });
    S.song = S.deck.pop() || null;
    if (!S.song) return endGame("The deck is empty!");
    saveGame();
    render();
    loadAudio();
  }

  function endGame(reason) {
    S.phase = "over";
    S.endReason = reason || "";
    stopAudio();
    saveGame();
    render();
  }

  function replaceSong(msg) {
    S.song = S.deck.pop() || null;
    S.slot = null;
    if (!S.song) return endGame("The deck is empty!");
    if (msg) toast(msg);
    saveGame();
    render();
    loadAudio();
  }

  function lockIn() {
    if (S.slot == null) return;
    S.phase = "challenge";
    saveGame();
    render();
  }

  function reveal() {
    const song = S.song, me = cur();
    let result;
    if (slotCorrect(me.cards, S.slot, song.year)) {
      me.cards.splice(S.slot, 0, song);
      result = { winner: S.current, how: "self" };
    } else {
      const win = S.challenges.find((c) => slotCorrect(me.cards, c.slot, song.year));
      if (win) {
        insertSorted(S.players[win.player].cards, song);
        result = { winner: win.player, how: "challenge" };
      } else {
        result = { winner: null };
      }
    }
    S.result = result;
    S.challenger = null;
    S.phase = "reveal";
    saveGame();
    render();
  }

  function nextTurn() {
    const winners = S.players.filter((p) => p.cards.length >= S.target);
    if (winners.length) return endGame();
    S.current = (S.current + 1) % S.players.length;
    beginTurn();
  }

  // ---------- audio ----------
  function stopAudio() {
    audioToken++;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function setAudio(state, msg) {
    ui.audio = state;
    ui.audioMsg = msg || "";
    if (S) render();
  }

  async function loadAudio() {
    stopAudio();
    const token = audioToken;
    const song = S && S.song;
    if (!song) return;
    let url;
    if (S.source === "local") {
      const f = localFiles[song.path];
      if (!f) return setAudio("needfiles");
      url = objectUrl = URL.createObjectURL(f);
    } else {
      setAudio("loading");
      try {
        url = await Music.findPreview(song);
      } catch (e) {
        if (token === audioToken) setAudio("error", "Can't reach the music service. Check the internet connection.");
        return;
      }
      if (token !== audioToken) return;
      if (!url) return replaceSong("That song had no preview available, so here's another one.");
    }
    audio.src = url;
    // Look up the next song in the background so the next turn starts fast.
    if (S.source !== "local" && S.deck.length) Music.findPreview(S.deck[S.deck.length - 1]).catch(() => {});
    try {
      await audio.play();
    } catch (e) {
      if (token === audioToken) setAudio("paused");
    }
  }

  audio.addEventListener("playing", () => setAudio("playing"));
  audio.addEventListener("pause", () => { if (ui.audio === "playing") setAudio("paused"); });
  audio.addEventListener("ended", () => setAudio("paused"));
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    if (ui.testing) { ui.testing = null; return render(); }
    if (S && S.phase !== "over") setAudio("error", "This song failed to play.");
  });

  async function testSound() {
    if (ui.testing) { stopAudio(); ui.testing = null; return render(); }
    const songs = availableSongs();
    if (!songs.length) return toast("No songs selected.");
    const song = songs[Math.floor(Math.random() * songs.length)];
    stopAudio();
    const token = audioToken;
    ui.testing = { song, state: "loading" };
    render();
    try {
      let url;
      if (song.path) url = objectUrl = URL.createObjectURL(localFiles[song.path]);
      else url = await Music.findPreview(song);
      if (token !== audioToken) return;
      if (!url) { ui.testing.state = "missing"; return render(); }
      audio.src = url;
      await audio.play();
      ui.testing.state = "playing";
    } catch (e) {
      if (token !== audioToken) return;
      ui.testing.state = "error";
    }
    render();
  }

  // ---------- local files ----------
  async function loadFolder(fileList) {
    const files = Array.from(fileList).filter((f) => AUDIO_EXT.test(f.name));
    if (!files.length) { localStatus = "No audio files found in that selection."; return render(); }
    const songs = [];
    let skipped = 0, done = 0;
    const pathOf = (f) => f.webkitRelativePath || f.name;
    const work = files.slice();
    async function worker() {
      while (work.length) {
        const f = work.shift();
        const info = await ID3.readSongInfo(f);
        localFiles[pathOf(f)] = f;
        if (info.year && info.title) songs.push({ ...info, path: pathOf(f) });
        else skipped++;
        if (++done % 25 === 0) { localStatus = `Reading tags… ${done}/${files.length}`; render(); }
      }
    }
    localStatus = `Reading tags… 0/${files.length}`;
    render();
    await Promise.all(Array.from({ length: 8 }, worker));
    localSongs = songs;
    localStatus = `Loaded ${songs.length} songs` + (skipped ? ` (${skipped} skipped: no year in tag or file name)` : "") + ".";
    if (S && S.source === "local" && S.phase !== "over" && ui.audio === "needfiles") loadAudio();
    render();
  }

  function parseCustom(text) {
    const out = [], bad = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s*[;\t]\s*|\s*,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => p.replace(/^"|"$/g, "").trim());
      const yi = parts.findIndex((p) => /^(1[89]\d\d|20\d\d)$/.test(p));
      if (yi < 0 || parts.length < 3) { bad.push(line); continue; }
      const year = +parts.splice(yi, 1)[0];
      out.push({ year, artist: parts[0], title: parts.slice(1).join(", ") });
    }
    return { out, bad };
  }

  // ---------- rendering ----------
  function render() {
    document.getElementById("btn-new").classList.toggle("hidden", !S);
    app.innerHTML = (S ? renderGame() : renderSetup()) + (ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : "");
  }

  function renderSetup() {
    const packs = Object.entries(window.SONG_PACKS).map(([id, p]) => ({ id, name: p.name, n: p.songs.length }));
    packs.push({ id: "custom", name: "My custom songs", n: customSongs.length });
    const local = settings.source === "local";
    const t = ui.testing;
    let testLine = "";
    if (t) {
      testLine = {
        loading: "Looking up a song…",
        playing: `✅ Playing: ${esc(t.song.artist)} – ${esc(t.song.title)} (${t.song.year})`,
        missing: `⚠️ No preview found for ${esc(t.song.artist)} – ${esc(t.song.title)}. That's fine, the game skips these.`,
        error: "❌ Couldn't play anything. Check your internet connection.",
      }[t.state];
    }
    return `
      <section class="panel setup">
        <h2>Players</h2>
        <p class="muted">Play solo or in teams. Each name gets its own timeline.</p>
        <div class="players-edit">
          ${settings.players.map((n, i) => `
            <div class="row">
              <input type="text" data-input="player" data-i="${i}" value="${esc(n)}" placeholder="Player ${i + 1}" maxlength="24" />
              ${settings.players.length > 1 ? `<button class="ghost icon" data-action="removePlayer" data-i="${i}" aria-label="Remove">✕</button>` : ""}
            </div>`).join("")}
        </div>
        ${settings.players.length < 10 ? `<button class="ghost" data-action="addPlayer">+ Add player</button>` : ""}

        <h2>Music</h2>
        <div class="choices">
          <label class="choice ${!local ? "on" : ""}">
            <input type="radio" name="source" value="online" data-input="source" ${!local ? "checked" : ""} />
            <span><b>Built-in song packs</b><br><small>Plays 30-second previews from iTunes/Deezer. Needs internet.</small></span>
          </label>
          <label class="choice ${local ? "on" : ""}">
            <input type="radio" name="source" value="local" data-input="source" ${local ? "checked" : ""} />
            <span><b>My own music files</b><br><small>Works fully offline. The year comes from the MP3 tags or the file name.</small></span>
          </label>
        </div>

        ${local ? `
          <div class="local-pick">
            <label class="button">📁 Choose music folder<input type="file" data-input="folder" webkitdirectory directory multiple hidden /></label>
            <label class="button ghost">🎵 Choose files<input type="file" data-input="folder" accept="audio/*" multiple hidden /></label>
            <p class="muted">${esc(localStatus || "Name files like “Artist - Title (1984).mp3” if a tag has no year or the wrong one.")}</p>
          </div>` : `
          <div class="packs">
            ${packs.map((p) => `
              <label class="pack">
                <input type="checkbox" data-input="pack" value="${p.id}" ${settings.packs.includes(p.id) ? "checked" : ""} ${p.n ? "" : "disabled"} />
                <span>${esc(p.name)}</span><span class="count">${p.n}</span>
              </label>`).join("")}
          </div>
          <details class="custom" ${customDraft != null ? "open" : ""}>
            <summary>Add your own songs</summary>
            <p class="muted">One per line: <code>year; artist; title</code>. Good for family favourites! They are saved in this browser.</p>
            <textarea id="custom-text" data-input="custom" rows="6" placeholder="1985; Opus; Live Is Life">${esc(customDraft != null ? customDraft : customSongs.map((s) => `${s.year}; ${s.artist}; ${s.title}`).join("\n"))}</textarea>
            <button class="ghost" data-action="saveCustom">Save custom songs</button>
          </details>`}

        <div class="row test">
          <button class="ghost" data-action="testSound">${t ? "■ Stop test" : "🔊 Test sound"}</button>
          <span class="muted">${testLine}</span>
        </div>

        <h2>Rules</h2>
        <div class="row opts">
          <label>Cards to win <input type="number" min="2" max="50" data-input="target" value="${esc(settings.target)}" /></label>
          <label>Starting tokens <input type="number" min="0" max="5" data-input="startTokens" value="${esc(settings.startTokens)}" /></label>
        </div>
        <p class="muted">${availableSongs().length} songs ready.</p>
        <button class="primary big" data-action="start">Start game 🎶</button>
      </section>`;
  }

  function renderScoreboard() {
    const canBuy = S.phase === "place";
    return `<div class="scoreboard">
      ${S.players.map((p, i) => `
        <div class="score ${i === S.current && S.phase !== "over" ? "active" : ""}">
          <div class="name">${esc(p.name)}</div>
          <div class="stats">
            <span title="Cards">🃏 ${p.cards.length}/${S.target}</span>
            <span class="tokens" title="Tokens">
              <button class="mini" data-action="token" data-i="${i}" data-d="-1" aria-label="Remove token">−</button>
              🪙 ${p.tokens}
              <button class="mini" data-action="token" data-i="${i}" data-d="1" aria-label="Add token">+</button>
            </span>
          </div>
          ${canBuy && p.tokens >= 3 ? `<button class="mini wide" data-action="buy" data-i="${i}">Buy a card (3 🪙)</button>` : ""}
        </div>`).join("")}
    </div>`;
  }

  function renderMystery() {
    const revealed = S.phase === "reveal";
    const song = S.song;
    const playing = ui.audio === "playing";
    let status = "";
    if (ui.audio === "loading") status = "Finding the song…";
    else if (ui.audio === "error") status = `${esc(ui.audioMsg)} <button class="mini" data-action="retryAudio">Retry</button> <button class="mini" data-action="freeSkip">Other song</button>`;
    else if (ui.audio === "needfiles") status = `The page was reloaded, so pick your music folder again:
      <label class="button mini">📁 Folder<input type="file" data-input="folder" webkitdirectory directory multiple hidden /></label>`;
    return `
      <div class="mystery ${revealed ? "revealed" : ""}">
        <div class="disc ${playing ? "spin" : ""}" data-action="togglePlay" role="button" aria-label="Play or pause">
          <div class="label">${playing ? "❚❚" : "▶"}</div>
        </div>
        <div class="mystery-info">
          ${revealed
            ? `<div class="year">${song.year}</div><div class="title">${esc(song.title)}</div><div class="artist">${esc(song.artist)}</div>`
            : `<div class="year">????</div><div class="title">Mystery song</div><div class="artist muted">Song ${S.turn} · ${S.deck.length} left in the deck</div>`}
          <div class="audio-controls">
            <button class="mini" data-action="restart">↺ Restart</button>
            <button class="mini" data-action="forward">+10s</button>
            ${S.phase === "place" && cur().tokens >= 1 ? `<button class="mini" data-action="skip">Skip song (1 🪙)</button>` : ""}
          </div>
          ${status ? `<div class="audio-status">${status}</div>` : ""}
        </div>
      </div>`;
  }

  const cardHtml = (c, cls) =>
    `<div class="card ${cls || ""}"><div class="y">${c.year}</div><div class="t">${esc(c.title)}</div><div class="a">${esc(c.artist)}</div></div>`;

  function renderTimeline(p, opts) {
    const interactive = opts && opts.interactive;
    if (!interactive) return `<div class="timeline small">${p.cards.map((c) => cardHtml(c)).join("")}</div>`;
    // During the reveal the song may already sit in a timeline; leave it out so slots line up.
    const cards = p.cards.filter((c) => c.id !== S.song.id);
    const marks = (slot) => {
      const out = [];
      if (S.slot === slot && S.phase !== "place") out.push(`<span class="tag me">${esc(cur().name)}</span>`);
      for (const c of S.challenges) if (c.slot === slot) out.push(`<span class="tag ch">${esc(S.players[c.player].name)}</span>`);
      return out.join("");
    };
    const slotHtml = (i) => {
      if (S.phase === "reveal") {
        const good = slotCorrect(cards, i, S.song.year);
        if (i === S.slot) return `<div class="placed">${cardHtml(S.song, good ? "ok" : "bad")}</div>`;
        return `<div class="slot ${good ? "good" : ""}">${marks(i)}</div>`;
      }
      const sel = S.phase === "place" && S.slot === i;
      const taken = S.slot === i || S.challenges.some((c) => c.slot === i);
      const clickable = S.phase === "place" || (S.phase === "challenge" && S.challenger != null && !taken);
      return `<button class="slot ${sel ? "sel" : ""} ${clickable ? "can" : ""} ${taken ? "taken" : ""}"
        ${clickable ? `data-action="slot" data-i="${i}"` : "disabled"} aria-label="Place here">
        ${sel ? `<span class="ghost-card">?</span>` : marks(i) || "+"}
      </button>`;
    };
    let html = "";
    cards.forEach((c, i) => { html += slotHtml(i) + cardHtml(c); });
    html += slotHtml(cards.length);
    return `<div class="timeline main">${html}</div>`;
  }

  function renderActions() {
    const me = cur();
    if (S.phase === "place") {
      return `<p class="hint">🎧 <b>${esc(me.name)}</b>, where does this song go in your timeline? Tap a spot.</p>
        <button class="primary big" data-action="lockIn" ${S.slot == null ? "disabled" : ""}>Lock it in</button>`;
    }
    if (S.phase === "challenge") {
      const others = S.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== S.current);
      const challengerName = S.challenger != null ? S.players[S.challenger].name : null;
      return `
        ${challengerName
          ? `<p class="hint">⚡ <b>${esc(challengerName)}</b>, tap a <i>different</i> spot in ${esc(me.name)}'s timeline.
             <button class="mini" data-action="cancelChallenger">Cancel</button></p>`
          : `<p class="hint">Does anyone disagree? Shout <b>HITSTER!</b> and spend 1 🪙 to bet on another spot.</p>`}
        <div class="challengers">
          ${others.map(({ p, i }) => {
            const c = S.challenges.find((x) => x.player === i);
            if (c) return `<span class="chip">${esc(p.name)} challenged <button class="mini" data-action="unchallenge" data-i="${i}">undo</button></span>`;
            if (p.tokens < 1) return `<span class="chip off">${esc(p.name)} (no 🪙)</span>`;
            return `<button class="hitster" data-action="challenge" data-i="${i}">${esc(p.name)}: HITSTER!</button>`;
          }).join("")}
        </div>
        <div class="row center">
          <button class="ghost" data-action="unlock">← Move my card</button>
          <button class="primary big" data-action="reveal">Reveal! 🎉</button>
        </div>`;
    }
    if (S.phase === "reveal") {
      const r = S.result;
      let msg;
      if (r.how === "self") msg = `✅ Correct! <b>${esc(me.name)}</b> keeps the card.`;
      else if (r.how === "challenge") msg = `⚡ Wrong spot, but <b>${esc(S.players[r.winner].name)}</b> stole it with a HITSTER!`;
      else msg = `❌ Wrong spot. Nobody gets this card.`;
      const winner = S.players.find((p) => p.cards.length >= S.target);
      return `<p class="result">${msg}</p>
        <label class="named">
          <input type="checkbox" data-input="named" ${S.named ? "checked" : ""} ${!S.named && me.tokens >= MAX_TOKENS ? "disabled" : ""} />
          🎤 ${esc(me.name)} named the artist <b>and</b> title before the reveal (+1 🪙)
        </label>
        <button class="primary big" data-action="next">${winner ? "🏆 See the winner" : "Next player ▶"}</button>`;
    }
    return "";
  }

  function renderGame() {
    if (S.phase === "over") {
      const max = Math.max(...S.players.map((p) => p.cards.length));
      const winners = S.players.filter((p) => p.cards.length === max);
      return `<section class="panel over">
        <div class="trophy">🏆</div>
        <h2>${winners.map((w) => esc(w.name)).join(" & ")} win${winners.length === 1 ? "s" : ""}!</h2>
        ${S.endReason ? `<p class="muted">${esc(S.endReason)}</p>` : ""}
        ${S.players.map((p) => `<h3>${esc(p.name)} · ${p.cards.length} cards</h3>${renderTimeline(p)}`).join("")}
        <div class="row center">
          <button class="primary big" data-action="again">Play again</button>
          <button class="ghost" data-action="quit">Change setup</button>
        </div>
      </section>`;
    }
    const me = cur();
    const others = S.players.filter((p) => p !== me);
    return `
      ${renderScoreboard()}
      <section class="panel play">
        ${renderMystery()}
        <h2 class="whose">${esc(me.name)}'s timeline</h2>
        ${renderTimeline(me, { interactive: true })}
        <div class="actions">${renderActions()}</div>
      </section>
      ${others.length ? `<details class="panel others">
        <summary>Other timelines</summary>
        ${others.map((p) => `<h3>${esc(p.name)}</h3>${renderTimeline(p)}`).join("")}
      </details>` : ""}`;
  }

  // ---------- events ----------
  const actions = {
    addPlayer() { settings.players.push(""); saveSettings(); render(); focusLastPlayer(); },
    removePlayer(d) { settings.players.splice(+d.i, 1); saveSettings(); render(); },
    start() { stopAudio(); ui.testing = null; startGame(); },
    testSound,
    saveCustom() {
      const { out, bad } = parseCustom(document.getElementById("custom-text").value);
      customSongs = out;
      customDraft = null;
      store(CUSTOM_KEY, customSongs);
      if (out.length && !settings.packs.includes("custom")) settings.packs.push("custom");
      if (!out.length) settings.packs = settings.packs.filter((p) => p !== "custom");
      saveSettings();
      toast(`Saved ${out.length} custom songs.` + (bad.length ? ` Couldn't read ${bad.length} line(s), e.g. “${bad[0]}”.` : ""));
      render();
    },
    slot(d) {
      const i = +d.i;
      if (S.phase === "place") { S.slot = i; }
      else if (S.phase === "challenge" && S.challenger != null) {
        S.challenges.push({ player: S.challenger, slot: i });
        S.players[S.challenger].tokens--;
        S.challenger = null;
      }
      saveGame(); render();
    },
    lockIn,
    unlock() {
      for (const c of S.challenges) S.players[c.player].tokens++;
      Object.assign(S, { phase: "place", challenges: [], challenger: null });
      saveGame(); render();
    },
    challenge(d) { S.challenger = +d.i; render(); },
    cancelChallenger() { S.challenger = null; render(); },
    unchallenge(d) {
      const i = +d.i;
      S.challenges = S.challenges.filter((c) => c.player !== i);
      S.players[i].tokens++;
      saveGame(); render();
    },
    reveal,
    next: nextTurn,
    skip() { cur().tokens--; replaceSong("Song skipped."); },
    freeSkip() { replaceSong(); },
    retryAudio() { loadAudio(); },
    buy(d) {
      const p = S.players[+d.i];
      const card = S.deck.shift();
      if (!card) return toast("The deck is empty.");
      p.tokens -= 3;
      insertSorted(p.cards, card);
      toast(`${p.name} bought “${card.title}” (${card.year}).`);
      if (p.cards.length >= S.target) return endGame();
      saveGame(); render();
    },
    token(d) {
      const p = S.players[+d.i];
      p.tokens = Math.max(0, Math.min(MAX_TOKENS, p.tokens + +d.d));
      saveGame(); render();
    },
    togglePlay() {
      if (!audio.getAttribute("src")) return loadAudio();
      audio.paused ? audio.play().catch(() => {}) : audio.pause();
    },
    restart() { audio.currentTime = 0; audio.play().catch(() => {}); },
    forward() { audio.currentTime = Math.min((audio.duration || 0) - 1, audio.currentTime + 10); },
    again() {
      const names = S.players.map((p) => p.name);
      settings.players = names;
      settings.source = S.source;
      saveSettings();
      startGame();
    },
    quit() { stopAudio(); S = null; saveGame(); render(); },
  };

  function focusLastPlayer() {
    const inputs = app.querySelectorAll('[data-input="player"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset, el);
  });

  document.addEventListener("input", (e) => {
    const el = e.target;
    switch (el.dataset.input) {
      case "player": settings.players[+el.dataset.i] = el.value; saveSettings(); break;
      case "target": settings.target = el.value; saveSettings(); break;
      case "startTokens": settings.startTokens = el.value; saveSettings(); break;
      case "custom": customDraft = el.value; break;
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    switch (el.dataset.input) {
      case "source": settings.source = el.value; saveSettings(); stopAudio(); ui.testing = null; render(); break;
      case "pack": {
        settings.packs = settings.packs.filter((p) => p !== el.value);
        if (el.checked) settings.packs.push(el.value);
        saveSettings(); render(); break;
      }
      case "folder": if (el.files && el.files.length) loadFolder(el.files); break;
      case "named": {
        const me = cur();
        if (el.checked && !S.named && me.tokens < MAX_TOKENS) { me.tokens++; S.named = true; }
        else if (!el.checked && S.named) { me.tokens--; S.named = false; }
        saveGame(); render(); break;
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.input === "player") {
      e.preventDefault();
      actions.addPlayer();
    }
    if (e.key === " " && S && S.phase !== "over" && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) {
      e.preventDefault();
      actions.togglePlay();
    }
  });

  document.getElementById("btn-rules").addEventListener("click", () => document.getElementById("rules").showModal());
  document.getElementById("btn-new").addEventListener("click", () => {
    if (confirm("End this game and go back to the setup screen?")) actions.quit();
  });

  // ---------- snow ----------
  (function snow() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.getElementById("snow");
    let html = "";
    for (let i = 0; i < 40; i++) {
      const size = 2 + Math.random() * 5;
      html += `<i style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${8 + Math.random() * 12}s;animation-delay:-${Math.random() * 20}s;opacity:${0.3 + Math.random() * 0.6}"></i>`;
    }
    root.innerHTML = html;
  })();

  // Resume a saved game after a reload.
  render();
  if (S && S.phase !== "over" && S.phase !== "reveal") loadAudio();
})();
