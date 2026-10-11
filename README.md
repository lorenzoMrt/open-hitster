# 🎄 Open Hitster

A homemade, local version of the music game **Hitster** for family game night.
You need no account, no install and no cards. Open it in a browser on a laptop
connected to the TV or a speaker, and pass the laptop around (or let one person
be the DJ).

## Start playing

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Double-click **`index.html`**. It opens in your browser (Chrome, Edge, Firefox or Safari).
3. Type the player or team names, pick the song packs and press **Start game**.

Press **🔊 Test sound** on the setup screen before your guests arrive, to check that music plays.

## How to play

- Everyone starts with one card that shows its year face-up.
- On your turn a mystery song plays. Tap the spot in **your** timeline where you think it belongs, then press **Lock it in**.
- Anyone else can shout **HITSTER!** and pay 1 🪙 to put the song in a different spot.
- **Reveal!** If you're right you keep the card. If you're wrong and a challenger is right, the challenger gets the card.
- Name the artist **and** title before the reveal to earn 1 🪙 (max 5). Tick the box on the reveal screen.
- Spend 1 🪙 to skip a song, or 3 🪙 to buy a card that goes straight into your timeline.
- The first player to reach the target number of cards (10 by default) wins.

The game is saved in the browser, so an accidental refresh doesn't lose it.

## Music sources

**Built-in song packs (needs internet).** About 250 songs with their original
release years, from Elvis to Sabrina Carpenter:

| Pack | Songs |
|---|---|
| Greatest Hits (1950s–today) | 173 |
| Musica italiana | 43 |
| Christmas Classics | 36 |

The game plays a 30-second preview of each song from the public iTunes Search
API, with Deezer as a fallback. If neither service has a song, the game quietly
picks another one.

**Spotify (full songs, needs Premium).** See [Playing with Spotify](#playing-with-spotify) below.

**Your own songs.** On the setup screen, open **Add your own songs** and add one song per line:

```
1985; Opus; Live Is Life
2003; The Darkness; Christmas Time (Don't Let the Bells End)
```

**My own music files (fully offline).** Choose **My own music files** and pick
a folder of MP3s (other audio formats work too). Each song's year comes from
its ID3 tag. If a year is missing or wrong (compilations often carry the
compilation's year), put the right one in the file name; it takes priority:

```
Queen - Bohemian Rhapsody (1975).mp3
```

## Playing with Spotify

Spotify plays full songs, either in the browser or on any Spotify device
(phone, TV, smart speaker). You can also import your own playlists. It takes a
one-time setup of about 5 minutes.

**What you need**
- **Spotify Premium.** Spotify only lets Premium accounts control playback,
  and since 2026 a developer app's owner must also have Premium.
- **A free Spotify developer app.** This gives you a *Client ID*. The game
  shows step-by-step instructions on the setup screen.
- **A web address for the game.** Spotify login doesn't work when
  `index.html` is opened as a file. Pick one:
  - **Local (easiest):** double-click `start-mac.command`, `start-windows.bat`
    or `start-linux.sh`. They need Python, which Macs and Linux already have;
    on Windows install it from [python.org](https://www.python.org/downloads/).
    The game opens at `http://127.0.0.1:8000/`. If the browser jumps to
    `localhost` instead, type `127.0.0.1` because Spotify rejects `localhost`.
  - **Online:** in this GitHub repository open *Settings → Pages* and choose
    *Deploy from a branch → main → / (root)*. The game is then at
    `https://<your-github-name>.github.io/open-hitster/`.

**Setup**
1. Open the game, choose **Spotify** and follow the steps shown: create an app
   at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
   add the **Redirect URI** the game shows, tick *Web API* and *Web Playback SDK*,
   and paste the Client ID.
2. Press **Connect Spotify** and log in.
3. Under **Play on**, choose *This browser* (Chrome, Edge or Firefox on a
   computer) or press **Find devices** to play on a phone or TV where Spotify
   is open. A device's screen shows the song title, so keep it hidden!
4. *(Optional)* Paste a playlist link and press **Import**. The year on each
   card comes from the album's release date. Remasters and "Greatest Hits"
   albums often carry the wrong year, so the game warns you and lets you fix
   them in **My songs**.

The built-in packs work with Spotify too: each song is looked up on Spotify
when it comes up.

**Limits:** a Spotify developer app in "development mode" can be used by at
most 5 Spotify accounts, which you add under *User Management*. One account
logged in on the game laptop is all a family game needs.

## Files

| File | What it does |
|---|---|
| `index.html` / `style.css` | The page |
| `app.js` | Game rules, screens, turn flow |
| `songs.js` | The built-in song packs. Edit this to add songs permanently |
| `music.js` | Finds song previews (iTunes, then Deezer) |
| `spotify.js` | Spotify login, search, playlist import and playback |
| `start-*.command/.bat/.sh` | Start a tiny local web server (needed for Spotify) |
| `id3.js` | Reads artist, title and year from your MP3 files |

## Disclaimer

This is an unofficial fan project for private use. It is not affiliated with
Hitster or Jumbo. Songs are streamed from Apple, Deezer and Spotify and stay
the property of their owners.
