# 🎸 ASCII Chords

A lightweight, web-based platform for guitarists: write songs with chord-above-lyric notation
and ASCII tab blocks, get live preview, audio playback (Web Audio API), autoscroll,
transposition, and a personal song library. All vanilla HTML/CSS/JS + PHP 8.x + MySQL 8.0
in Docker – no frameworks.

---

## Quick start

Requires **Docker** and **docker-compose**.

```bash
cd ascii-chords
docker-compose up --build
```

Then open: http://localhost:8080/login.html

The MySQL schema and a starter chord library are loaded automatically on first run
(via `db-init/01-schema.sql`).

> If port `8080` or `3307` is already in use, edit `docker-compose.yml`
> and change the `ports:` mappings.

To stop: `Ctrl+C`. To reset everything (including the database):

```bash
docker-compose down -v
```

---

## File map

```
ascii-chords/
├── Dockerfile               # PHP 8.2 + Apache + pdo_mysql
├── docker-compose.yml       # web (Apache/PHP) + db (MySQL 8.0)
├── apache-rewrite.conf      # routes /api/* to api.php
├── db-init/
│   └── 01-schema.sql        # auto-imported by mysql container
└── src/
    ├── index.html           # SPA shell, view templates
    ├── login.html           # Login + Register
    ├── style.css            # Styling + @media print
    ├── app.js               # Routing, parser, preview, library, editor
    ├── chords.js            # Chord regex, transposition, ASCII diagrams
    ├── player.js            # Web Audio playback engine
    ├── autoscroll.js        # rAF-based scroller
    ├── api.php              # REST router (auth, songs, chords, export, import)
    └── db.php               # PDO singleton with retry on cold start
```

---

## Manual verification checklist

| # | Test | Expected |
|---|---|---|
| 1 | Visit `/login.html`, register | Redirects to library |
| 2 | Create new song with chords + lyrics | Preview pane shows chord row above lyrics |
| 3 | Click a chord token | Popover with diagram + notes |
| 4 | Click ▶ Play at 120 BPM | Notes synthesise; preview pulses with beat |
| 5 | Drag BPM slider | Tempo changes in real time |
| 6 | Toggle Autoscroll | Smooth scroll, click again to pause |
| 7 | Transpose +2 | Chord names shift up 2 semitones; tab frets adjust |
| 8 | Switch ♯ ↔ ♭ | Chord display switches accidentals |
| 9 | Save | Toast "Saved", URL updates if new song |
| 10 | Export JSON / TXT | Browser downloads correctly named file |
| 11 | Print | Only song body prints, no UI chrome |
| 12 | Logout, hit `/api/songs` | 401 Unauthorized |
| 13 | Visit `#chords` | Built-in chord shapes render as diagrams |

---

## API surface

All endpoints return JSON. Session cookie required except `/api/csrf`,
`/api/auth/register`, `/api/auth/login`. State-changing methods need
the `X-CSRF-Token` header (token from `GET /api/csrf`).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/csrf` | Returns `{ token }` |
| GET | `/api/me`   | `{ user }` or `{ user: null }` |
| POST | `/api/auth/register` | `{ username, password }` |
| POST | `/api/auth/login` | `{ username, password }` |
| POST | `/api/auth/logout` | – |
| GET | `/api/songs` | Query: `q, key, difficulty, genre, tuning, sort` |
| POST | `/api/songs` | Create |
| GET | `/api/songs/{id}` | Read |
| PUT | `/api/songs/{id}` | Update |
| DELETE | `/api/songs/{id}` | Delete |
| GET | `/api/songs/{id}/export/json` | Download |
| GET | `/api/songs/{id}/export/txt`  | Download |
| GET | `/api/chords` | Built-in chord shapes |

---

## Body format

Inside the song body, the parser recognises:

- **`[Section]`** lines (`[Verse]`, `[Chorus]`, …) → styled headings
- **Chord lines** (`Am  F  C  G`) → tokenised, rendered above the next line
- **Tab blocks** (lines starting with `e|`, `B|`, `G|`, `D|`, `A|`, `E|`)
- **Lyric lines** (everything else)
- **Empty lines** → paragraph breaks

Sample:

```
[Verse]

C       G       Am      F
This is the first line of lyrics.

e|--0--0--0--0--|
B|--1--1--1--1--|
G|--0--0--0--0--|
D|--2--2--2--2--|
A|--3--3--3--3--|
E|--x--x--x--x--|
```

---

## Security notes

- Passwords hashed with `password_hash($p, PASSWORD_BCRYPT)`
- SQL via PDO prepared statements only
- HTML output escaped (server-side responses are JSON; client renders via `escapeHtml`)
- CSRF token required on all POST/PUT/DELETE
- `session_regenerate_id(true)` on login/register; `SameSite=Lax`, `HttpOnly` cookies

---

## Known limits

- The audio engine uses simple sawtooth oscillators with an envelope – it is
  closer to a synth than a real guitar. The hookup for the strumming pattern
  is in `player.js::scheduleChordLine`; expand if you want a richer voicing.
- Real-time autoscroll/playback sync is approximate (visual pulse only).
- No real-time collaboration; single-user editing per session.
