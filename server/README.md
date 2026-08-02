# The Tavern — 5etools play server

A self-contained Flask + Postgres backend adding accounts, profiles, characters,
and adventures (campaigns with a full play-by-play event log) on top of the
static 5etools site.

Everything for this feature lives in **new files only** — nothing in the
upstream site or its data JSONs is modified, so upstream merges stay clean:

| Area | Files |
| --- | --- |
| Backend | `server/` (this directory) |
| Pages | `account.html`, `mycharacters.html`, `campaigns.html` |
| Frontend logic | `js/tavern/` |
| Theme | `css/tavern.css` (+ `scss/tavern.scss` source) |

## Quick start (Docker, recommended)

```bash
cd server
docker compose up --build
```

This starts Postgres 16 and the API on <http://localhost:5000>. Then serve the
static site as usual (`npm run serve:dev`) and open
<http://localhost:5050/account.html>.

## Quick start (local, no Docker)

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python wsgi.py          # http://localhost:5000, SQLite fallback DB
```

Without `DATABASE_URL` the server uses a local SQLite file (`server/tavern.db`) —
handy for development; use Postgres for anything real.

## Configuration

Copy `.env.example` to `.env` (auto-loaded). Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres DSN, e.g. `postgresql+psycopg2://tavern:tavern@localhost:5432/tavern` |
| `TAVERN_SECRET_KEY` | JWT signing secret — **required in production** |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Web client ID; unset = Google Sign-In hidden |
| `TAVERN_CORS_ORIGINS` | Comma-separated allowed origins (default `*`) |

For Google Sign-In, create an OAuth *Web application* client in the Google
Cloud console and add your site origin (e.g. `http://localhost:5050`) to its
authorized JavaScript origins.

The frontend auto-detects the API at `http://<host>:5000/api` when the site is
served from a dev static server (ports 5050/5051/8080/3000), and uses
same-origin `/api` otherwise (reverse-proxy the backend there in production).
Override at any time from the browser console:
`localStorage.setItem("tavern:apiUrl", "https://api.example.com/api")`.

## Data model

- **users** — login identity (username/email + password hash and/or Google account)
- **profiles** — display name, bio, pronouns, location, website, avatar
- **characters** — one player, many characters; core columns (name/race/class/level)
  plus a free-form JSONB `sheet` (abilities, combat stats, proficiencies,
  spellcasting, equipment, persona…). Rules validation is deliberately deferred
  to a later phase so any customization is possible.
- **adventures** — a campaign with a six-letter invite code and lifecycle status
  (`recruiting → active → completed/archived`)
- **adventure_members** — who is in it, as `dm` or `player`, and which character
  they play
- **adventure_events** — the chronicle: DM narration, character speech, actions,
  dice rolls (with per-die results in JSONB), OOC chat, DM notes, and
  server-generated system entries (joins, leaves, character switches). Fetched
  incrementally via `?after=<id>` (the frontend polls every 5 s).

## API overview

All routes are under `/api`; authenticated routes take `Authorization: Bearer <JWT>`.

| Method & path | Purpose |
| --- | --- |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/google` | Sign up / sign in (returns `{token, user}`) |
| `GET /auth/me`, `POST /auth/password`, `GET /auth/config` | Session info, password change, client config |
| `GET/PUT /profile`, `POST /profile/avatar` | Profile + avatar upload |
| `GET/POST /characters`, `GET/PUT/DELETE /characters/<id>`, `POST /characters/<id>/portrait` | Characters |
| `GET/POST /adventures`, `POST /adventures/join`, `GET/PUT /adventures/<id>` | Adventures |
| `PUT /adventures/<id>/members/me`, `DELETE /adventures/<id>/members/<mid>` | Membership |
| `GET/POST /adventures/<id>/events`, `DELETE .../events/<eid>` | The chronicle |

Rules enforced server-side: only DMs post `narration`/`note`, edit the
adventure, or remove others; players may only delete their own events; the last
DM cannot leave; completed/archived adventures accept no new members.

## Roadmap (later phases)

1. **Rules validation** — validate sheets against the 5e data (point-buy,
   class/subclass legality, spell lists) using the site's own JSON data.
2. **Realtime** — replace polling with WebSockets/SSE; typing and dice presence.
3. **Table tools** — initiative tracker tied to members, encounter/XP tracking,
   session summaries, image handouts.
4. **Accounts** — email verification, password reset, account deletion.
5. **Migrations** — switch `db.create_all()` to Alembic before the schema evolves.
