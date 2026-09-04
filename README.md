# Blood Pressure Bot

Telegram bot for recording and reviewing blood pressure measurements for a single
patient. Data is stored in PostgreSQL and shared with the `khiro.website` web platform.

---

## Features

| Button | Action |
|---|---|
| **Ввести тиск** | Two-step dialog: systolic → diastolic, then writes to the database |
| **Останні вимірювання** | Lists the 5 most recent readings with date and time |
| **Графік тиску** | Renders a PNG chart of the last 30 readings (server-side Chart.js) |

Access is restricted: messages from users outside the `ADMINS` list are silently ignored.

---

## Data model

An important distinction: **the person entering the data and the person the data
belongs to are different entities.**

- `ADMINS` — Telegram IDs allowed to use the bot (operators)
- `PATIENT_ID` — Telegram ID of the patient the readings belong to

Whichever operator submits a reading, the row is always stored against
`PATIENT_ID`. There is currently a single patient.

```sql
CREATE TABLE pressure_data (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR(100),        -- holds PATIENT_ID, not the author of the entry
  systolic   INTEGER NOT NULL,
  diastolic  INTEGER NOT NULL,
  pulse      INTEGER,             -- column exists, the bot does not populate it yet
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> `user_id` is a poor name — it holds the patient, not the user. It will be renamed
> to `patient_id` when the schema moves to EF Migrations and the .NET API becomes
> its owner.

---

## Requirements

- **Node.js 20+**
- **PostgreSQL 15+**
- **DejaVuSans system font** at `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`

The font path is hardcoded in `src/index.js`. Without it, chart rendering fails.
On Debian/Ubuntu:

```bash
apt install fonts-dejavu-core
```

The `canvas` package builds from native libraries. On a clean system you may also need:

```bash
apt install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

---

## Running locally

```bash
npm ci                       # install exact versions from package-lock.json
cp .env.example .env         # fill in real values
chmod 600 .env
npm start
```

> Use `npm ci` rather than `npm install` — it installs exactly the versions pinned
> in `package-lock.json`, so the result is always reproducible.

---

## Running on a server (PM2)

```bash
pm2 start npm --name telegram-bot -- start
pm2 save                     # persist the process list
pm2 startup                  # start automatically after reboot
```

Useful commands:

```bash
pm2 status
pm2 logs telegram-bot --lines 30 --nostream
pm2 restart telegram-bot
```

---

## Environment variables

See [`.env.example`](.env.example) for the full annotated list. The real `.env` is
git-ignored and should be `chmod 600`.

---

## Known issues

- `formatDate()` adds a hardcoded `+2` hours instead of handling time zones —
  it will be wrong across daylight saving transitions
- The `pulse` column exists in the database but the bot never writes to it
- `REMAIND_ID` is defined in `.env` but unused in code — reminders are not implemented
- `userState` is held in process memory, so an in-progress entry dialog is lost
  on restart
