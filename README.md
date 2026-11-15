# Chola Seva Tracker

A phone-first website that shows which Hanuman ji location needs fresh chola next.
Chola is offered on Tuesdays and Saturdays, at one location per day.

Hosted free on Cloudflare:

| Part | What it does |
| --- | --- |
| Worker static assets (`public/`) | The website: HTML, CSS and JavaScript |
| Worker script (`src/worker.js` + `functions/api/`) | The API: `/api/data` for everyone, write routes for the owner |
| D1 database (`schema.sql`) | Locations and chola entries |

Everyone with the link can view. Only the owner can log, after unlocking with a private key
(the `ADMIN_KEY` secret). You can also add or edit rows directly in the D1 console.

## Project files

```
public/            website (index.html, app.css, app.js, icon, manifest)
src/worker.js      Worker entry: sends /api/* to the handlers, everything else to public/
functions/api/     API handlers, one file per route
lib/util.js        shared server helpers and validation
schema.sql         creates the tables (run once)
seed.sql           six locations + visits from 13 Oct to 14 Nov 2026 (run once)
wrangler.toml      Cloudflare settings: Worker name, assets folder, D1 database ID
```

## Deploy without installing anything (GitHub + Cloudflare dashboard)

1. **Create the database.** In the Cloudflare dashboard open *Storage & Databases → D1 SQL Database →
   Create*, name it `chola-seva`, and copy its **Database ID**.
2. **Create the tables.** Open the database, go to *Console*, paste all of `schema.sql`, and run it.
   Then paste all of `seed.sql` and run it. If the console only accepts one statement at a time,
   run each `CREATE` and `INSERT` on its own.
3. **Connect the database.** Put the ID in `database_id` in `wrangler.toml`.
4. **Put the code on GitHub.** Create a new repository and upload this whole folder.
5. **Create the Worker.** *Workers & Pages → Create → Import a repository*, pick the repository.
   Name the Worker **`chola-seva`** (it must match `name` in `wrangler.toml`), leave the build command
   empty and keep the deploy command **`npx wrangler deploy`**. Deploy.
6. **Set the logging key.** In the Worker: *Settings → Variables and Secrets → Add*,
   type **Secret**, name **`ADMIN_KEY`**, value: a long private phrase only you know.
   Secrets apply straight away and stay in place on later deploys.
7. **Open the site** at the `workers.dev` address shown on the Worker's page. Tap *Owner? Unlock logging*
   at the bottom and enter the key. On your phone, use *Add to Home screen* so it opens like an app.

Every push to the `main` branch on GitHub deploys the site again.

## Deploy with the Wrangler command line (needs Node.js)

```bash
npx wrangler login
```

```bash
npx wrangler d1 create chola-seva
```

Copy the `database_id` it prints into `wrangler.toml`, then:

```bash
npx wrangler d1 execute chola-seva --remote --file=schema.sql
```

```bash
npx wrangler d1 execute chola-seva --remote --file=seed.sql
```

```bash
npx wrangler deploy
```

```bash
npx wrangler secret put ADMIN_KEY
```

### Run it on your computer first

Copy `.dev.vars.example` to `.dev.vars`, then:

```bash
npx wrangler d1 execute chola-seva --local --file=schema.sql
```

```bash
npx wrangler d1 execute chola-seva --local --file=seed.sql
```

```bash
npx wrangler dev
```

## Adding entries from the D1 console

The site's log sheet is the easy way. If you prefer the dashboard, open the D1 *Console* and run:

```sql
INSERT INTO entries (location_id, date, note) VALUES ('jaypee-fmg', '2026-11-17', '');
```

For a special day that is not a Tuesday or Saturday, name the occasion:

```sql
INSERT INTO entries (location_id, date, special) VALUES ('igl', '2027-04-21', 'Hanuman Jayanti');
```

Location codes: `igl`, `bakhtawarpur`, `nagli`, `5-mukhi`, `jaypee-fmg`, `bio-diversity`.

The database itself enforces the seva rules: one entry per date, and a date must be a Tuesday or
Saturday unless `special` names the occasion.

## How the site decides

- **Due date**: the Nth Tuesday or Saturday after a location's last chola (N = its target, default 6,
  which is one full round of six locations).
- **Go next**: a location with no visit logged first, then the most overdue, then the one due soonest.
- **Six-day plan**: gives each coming Tuesday and Saturday its most urgent location, assuming each
  planned visit happens.
- **Seva streak**: Tuesdays and Saturdays in a row with an entry. A skipped day resets it; a special-day
  entry refreshes its location but does not change the streak.
- **On-time streak**: visits to one location made on or before its due date.

## API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/data` | everyone | all locations and entries |
| `GET /api/check` | owner | confirms the key |
| `POST /api/entries` | owner | add `{loc, date, note?, special?}` |
| `PUT /api/entries/:id` | owner | edit an entry |
| `DELETE /api/entries/:id` | owner | delete an entry |
| `POST /api/locations` | owner | add `{name, target?}` |
| `PUT /api/locations/:id` | owner | change `{name?, target?, active?}` |

Owner routes need the key in the `x-admin-key` header.
