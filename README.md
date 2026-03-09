# 📬 Mail Desk – Personal Mail & Document Organizer

Upload photos or scans of your mail. AI reads, categorizes, and summarizes each one.
All files are stored persistently so you can pull up the original any time.

---

## Deploy to Render

### 1. Create a new GitHub repo
- Go to github.com → New repository
- Name it: `mail-organizer` (or whatever you like)
- Upload all three files:
  - `server.js`
  - `package.json`
  - `public/index.html`  ← must be inside a `public/` folder

### 2. Create a Render Web Service
- Go to render.com → New → Web Service
- Connect your GitHub repo
- Settings:
  - **Build Command:** `npm install`
  - **Start Command:** `node server.js`
  - **Instance Type:** Starter ($7/mo) — needed for persistent disk

### 3. Add a Persistent Disk
- In your Render service → **Disks** → Add Disk
  - **Name:** `mail-data`
  - **Mount Path:** `/data`
  - **Size:** 5 GB (or more as needed)

### 4. Set Environment Variables
In Render → Environment:
- `ANTHROPIC_API_KEY` = your Anthropic API key
- `DATA_DIR` = `/data`

### 5. Deploy!
Render will build and deploy automatically.

---

## Features

- Upload photos (JPG, PNG) or PDFs up to 20MB
- AI extracts: category, priority, sender, amount, due date, summary, action items
- Categories: Bills, Tax Docs, Tax Receipts, Notices, Appointments, Receipts, Insurance, Legal, Financial, Other
- View the original file any time from the document detail page
- Edit category, priority, amount, due date, and add personal notes
- Dashboard shows urgent items and what's due in 14 days
- Search across all documents

---

## File Storage

- Uploaded files are saved to `/data/files/` on Render's persistent disk
- Document metadata (title, category, dates, etc.) is saved to `/data/documents.json`
- Both survive redeploys and restarts
