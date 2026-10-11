// Minimal ID3v2 tag reader: just enough to get artist, title and year
// out of the user's own MP3 files. Falls back to parsing the file name.
(function () {
  function syncsafe(b, o) {
    return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  }

  function decodeText(bytes) {
    if (!bytes.length) return "";
    const enc = bytes[0];
    const body = bytes.subarray(1);
    let label = "latin1";
    if (enc === 1) label = "utf-16";
    else if (enc === 2) label = "utf-16be";
    else if (enc === 3) label = "utf-8";
    try {
      return new TextDecoder(label).decode(body).replace(/\u0000.*$/s, "").trim();
    } catch (e) {
      return "";
    }
  }

  async function readId3(file) {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
    const ver = head[3];
    const size = syncsafe(head, 6);
    const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    const tags = {};
    let o = 0;
    // Skip extended header if present.
    if (head[5] & 0x40 && ver >= 3) o += ver === 4 ? syncsafe(b, 0) : 4 + ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]);
    const idLen = ver === 2 ? 3 : 4;
    const hdrLen = ver === 2 ? 6 : 10;
    while (o + hdrLen <= b.length) {
      const id = String.fromCharCode(...b.subarray(o, o + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      let len;
      if (ver === 2) len = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
      else if (ver === 4) len = syncsafe(b, o + 4);
      else len = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
      const start = o + hdrLen;
      if (len <= 0 || start + len > b.length) break;
      if (id[0] === "T") tags[id] = decodeText(b.subarray(start, start + len));
      o = start + len;
    }
    const pickYear = (...ids) => {
      for (const id of ids) {
        const m = tags[id] && tags[id].match(/\b(1[89]\d\d|20\d\d)\b/);
        if (m) return +m[1];
      }
      return null;
    };
    return {
      title: tags.TIT2 || tags.TT2 || "",
      artist: tags.TPE1 || tags.TP1 || "",
      // Prefer the original release year when the tag has one.
      year: pickYear("TDOR", "TORY", "TOR", "TDRC", "TYER", "TYE"),
    };
  }

  // "Artist - Title (1984).mp3", "1984 - Artist - Title.mp3", "Artist - Title.mp3"
  function parseFileName(name) {
    let base = name.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
    let year = null;
    const ym = base.match(/[\[(]\s*(1[89]\d\d|20\d\d)\s*[\])]/) || base.match(/^(1[89]\d\d|20\d\d)\s*[-–.]\s*/);
    if (ym) {
      year = +ym[1];
      base = base.replace(ym[0], " ").trim();
    }
    base = base.replace(/^\d{1,3}\s*[-.]\s*/, ""); // leading track number
    const parts = base.split(/\s+[-–]\s+/);
    if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim(), year };
    return { artist: "", title: base, year };
  }

  async function readSongInfo(file) {
    let tag = {};
    if (/\.mp3$/i.test(file.name)) {
      try { tag = await readId3(file); } catch (e) { tag = {}; }
    }
    const fromName = parseFileName(file.name);
    return {
      artist: tag.artist || fromName.artist || "Unknown artist",
      title: tag.title || fromName.title,
      // A year in the file name wins: it is the easiest way for people to fix a wrong tag.
      year: fromName.year || tag.year,
    };
  }

  window.ID3 = { readSongInfo };
})();
