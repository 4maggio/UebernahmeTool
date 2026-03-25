# Unternehmensübernahme-Analyse-Tool

Ein vollständiges, produktionsreifes Web-Tool zur Analyse von Unternehmensübernahmen — mit 7-stufigem Eingabe-Wizard, vier Bewertungsmethoden, automatischer Wissensdatenbank und Admin-Panel.

---

## Features

- **7-Schritt-Wizard** — geführte Eingabe: Zielunternehmen → Finanzdaten → Vermögen → Deal-Struktur → Käufer → Finanzierung → Zusammenfassung
- **4 Bewertungsmethoden** — Substanzwert, EBITDA-Multiple, Ertragswert (§ 199 BewG), Umsatz-Multiple
- **EBITDA-Normalisierung** — überhöhtes Inhabergehalt, Einmalkosten, Privatnutzung, kalkulatorischer Unternehmerlohn
- **Risikoanalyse** — 15+ Faktoren, gewichteter Score, priorisierte Empfehlungen
- **Steuerliche Ersteinschätzung** — § 16 Abs. 4 EStG Freibetrag + § 34 EStG Tarifbegünstigung (mit Disclaimer)
- **Wissensdatenbank** — YAML-gesteuerter Inhalt, OpenAI-Update-Pipeline, Admin-Panel
- **Auto-Updates** — Scraper für gesetze-im-internet.de (BGB, EStG, HGB, BewG, UmwG) + Cron
- **Admin-Panel** — CRUD für KB-Einträge, Pending-Approval-Workflow für KI-Vorschläge
- **i18n** — Deutsch + Englisch, localStorage-persistiert
- **PDF-Export** — `window.print()` mit optimierten `@media print`-Styles
- **Offline-Modus** — Client-seitige Bewertungsengine als Fallback

---

## Tech Stack

| Schicht | Technologie |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (kein Framework), SPA-Wizard |
| Backend | Node.js 20 + Express 4 |
| Datenbank | PostgreSQL 15 |
| Auth | JWT (HS256), bcrypt |
| Scraping | Cheerio |
| KI | OpenAI GPT-4o (laziliy initialized) |
| Cron | node-cron |
| Deployment | PM2, Nginx, GitHub Actions CI/CD |

---

## Voraussetzungen

- Node.js 20+
- PostgreSQL 15+
- Git
- (Optional) OpenAI API Key für KI-gestützte KB-Updates

---

## Lokale Entwicklung

### 1. Repository klonen

```bash
git clone https://github.com/DEIN_USERNAME/uebernahme-tool.git
cd uebernahme-tool
```

### 2. Backend-Abhängigkeiten installieren

```bash
cd backend
npm install
```

### 3. Umgebungsvariablen konfigurieren

```bash
cp ../.env.example backend/.env
```

Inhalt von `backend/.env` anpassen:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/uebernahme
JWT_SECRET=dein-sicherer-jwt-secret-mindestens-32-zeichen
OPENAI_API_KEY=sk-...          # optional, für KI-Updates
NODE_ENV=development
PORT=3000
CRON_ENABLED=false              # Scraper lokal deaktivieren
```

### 4. Datenbank einrichten

```bash
# PostgreSQL-Datenbank anlegen
psql -U postgres -c "CREATE DATABASE uebernahme;"

# Migrationen ausführen
cd backend
node src/db/migrate.js

# Seed-Daten einspielen (Multiplier, Checklisten, Admin-User)
node src/db/seeds/run.js

# Knowledge-Base YAML-Dateien importieren
node src/db/seeds/importKnowledge.js
```

Standard-Admin-Zugangsdaten nach Seed:
- E-Mail: `admin@example.com`
- Passwort: `changeme123` ← **sofort ändern!**

### 5. Backend starten

```bash
cd backend
npm run dev     # mit nodemon (Autoreload)
# oder:
npm start       # Produktion
```

API läuft auf `http://localhost:3000/api`

### 6. Frontend öffnen

Einfach `frontend/index.html` im Browser öffnen — oder mit einem lokalen HTTP-Server:

```bash
# Mit npx (kein Install notwendig)
npx serve frontend -l 5000

# Admin-Panel
open http://localhost:5000/admin.html
```

---

## Projektstruktur

```
uebernahme-tool/
├── frontend/
│   ├── index.html          # SPA-Shell (Hauptanwendung)
│   ├── admin.html          # Admin-Panel
│   ├── css/
│   │   └── style.css       # Design-System (CSS Custom Properties)
│   ├── js/
│   │   ├── i18n.js         # Internationalisierung (DE/EN)
│   │   ├── api.js          # Backend-API-Abstraktionsschicht
│   │   ├── valuation.js    # Client-seitige Bewertungsengine (Offline-Fallback)
│   │   └── app.js          # Haupt-Controller (7-Schritt-Wizard)
│   └── locales/
│       ├── de.json         # Deutsche Übersetzungen
│       └── en.json         # Englische Übersetzungen
│
├── backend/
│   ├── src/
│   │   ├── server.js                   # Express-App (Helmet, CORS, Compression)
│   │   ├── routes/
│   │   │   ├── analysis.js             # Session CRUD + Berechnung
│   │   │   ├── knowledge.js            # KB-Abfragen (öffentlich)
│   │   │   ├── checklist.js            # Dynamische Checkliste
│   │   │   └── admin.js                # Admin-CRUD + Pending-Workflow
│   │   ├── services/
│   │   │   └── valuation.js            # Bewertungsengine (serverseitig)
│   │   ├── scrapers/
│   │   │   ├── gesetze.js              # gesetze-im-internet.de (Cheerio)
│   │   │   ├── cron.js                 # Cron-Wrapper (node-cron)
│   │   │   └── aiService.js            # OpenAI GPT-4o Integration
│   │   ├── middleware/
│   │   │   └── auth.js                 # JWT-Verifikation
│   │   └── db/
│   │       ├── index.js                # PostgreSQL-Pool (pg)
│   │       ├── migrate.js              # Migrationsskript
│   │       ├── migrations/
│   │       │   └── 001_initial.sql     # Vollständiges Schema (8 Tabellen)
│   │       └── seeds/
│   │           ├── run.js              # Daten-Seed (Multiplier, Checkliste, Admin)
│   │           └── importKnowledge.js  # YAML → PostgreSQL Upsert
│   └── package.json
│
├── knowledge/                  # YAML Wissensdatenbank
│   ├── rechtsformen/
│   │   ├── gbr.yaml
│   │   └── gmbh.yaml
│   ├── deal_struktur/
│   │   ├── asset_deal.yaml     # inkl. § 613a BGB-Warnung
│   │   └── share_deal.yaml
│   ├── steuer/
│   │   ├── par16_estg.yaml
│   │   └── par34_estg.yaml
│   ├── bewertung/
│   │   ├── substanzwert.yaml
│   │   └── ertragswert.yaml
│   └── due_diligence/
│       ├── financial_dd.yaml
│       └── recht/
│           └── par613a.yaml
│
├── nginx/
│   └── default.conf            # Nginx-Reverse-Proxy-Konfiguration
│
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions CI/CD → VPS
│
├── ecosystem.config.js         # PM2-Konfiguration (2 Instanzen, Cluster-Mode)
├── .env.example                # Umgebungsvariablen-Template
├── .gitignore
└── README.md
```

---

## API-Endpunkte

### Öffentlich

| Method | Path | Beschreibung |
|---|---|---|
| `POST` | `/api/analysis` | Neue Analyse-Session erstellen |
| `GET` | `/api/analysis/:id` | Session abrufen |
| `PUT` | `/api/analysis/:id` | Session aktualisieren |
| `POST` | `/api/analysis/:id/calculate` | Bewertung berechnen |
| `GET` | `/api/knowledge` | KB-Einträge auflisten |
| `GET` | `/api/knowledge/:slug` | Einzelner KB-Eintrag |
| `GET` | `/api/checklist` | Dynamische Checkliste |

### Admin (JWT-geschützt)

| Method | Path | Beschreibung |
|---|---|---|
| `POST` | `/api/admin/login` | Anmelden, Token erhalten |
| `GET` | `/api/admin/knowledge` | KB-Einträge mit Paginierung |
| `POST` | `/api/admin/knowledge` | Neuer KB-Eintrag |
| `PUT` | `/api/admin/knowledge/:id` | KB-Eintrag bearbeiten |
| `DELETE` | `/api/admin/knowledge/:id` | KB-Eintrag löschen |
| `GET` | `/api/admin/pending` | Ausstehende Updates |
| `POST` | `/api/admin/pending/:id/approve` | Update genehmigen |
| `DELETE` | `/api/admin/pending/:id/reject` | Update ablehnen |
| `POST` | `/api/admin/trigger-update` | Scraper manuell starten |
| `GET` | `/api/admin/scrape-logs` | Scraper-Logs |

---

## Deployment (VPS)

### GitHub Actions Secrets konfigurieren

Im GitHub-Repository unter `Settings → Secrets and variables → Actions`:

| Secret | Wert |
|---|---|
| `SSH_PRIVATE_KEY` | Privater SSH-Key für den VPS-Zugang |
| `VPS_HOST` | IP oder Hostname des VPS |
| `VPS_USER` | Linux-Benutzer (z. B. `deploy`) |
| `VPS_PATH` | Pfad zum Projektverzeichnis auf dem VPS |
| `DATABASE_URL` | PostgreSQL-Connection-String |
| `JWT_SECRET` | Zufälliger 64-Zeichen-String |
| `OPENAI_API_KEY` | OpenAI API Key (optional) |

### Ersteinrichtung VPS

```bash
# Repository klonen
git clone https://github.com/DEIN_USERNAME/uebernahme-tool.git /var/www/uebernahme
cd /var/www/uebernahme

# PM2 global installieren
npm install -g pm2

# Anwendung starten
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # Autostart nach Neustart

# Nginx konfigurieren
cp nginx/default.conf /etc/nginx/sites-available/uebernahme
ln -s /etc/nginx/sites-available/uebernahme /etc/nginx/sites-enabled/
# domain in default.conf anpassen: example.com → deine-domain.de
nginx -t && systemctl reload nginx

# SSL-Zertifikat (Let's Encrypt)
certbot --nginx -d deine-domain.de -d www.deine-domain.de
```

### Automatisches Deployment

Jeder Push auf `main` löst automatisch aus:
1. Tests (Backend)
2. SSH-Deploy auf VPS
3. DB-Migrationen
4. KB-Import
5. PM2-Reload (Zero-Downtime)

---

## Wissensdatenbank pflegen

### Via YAML (empfohlen für inhaltliche Präzision)

```bash
# Neue YAML-Datei anlegen, z. B.:
# backend/knowledge/finanzierung/kfw.yaml

# Nach Git-Push importieren:
node backend/src/db/seeds/importKnowledge.js

# Oder im Admin-Panel → "Scraper" → "Scraper jetzt starten"
```

**YAML-Format:**
```yaml
slug: finanzierung/kfw
category: finanzierung
title:
  de: "KfW-Förderprogramme für Unternehmensnachfolge"
  en: "KfW Financing Programs for Business Succession"
summary:
  de: "ERP-Gründerkredit, KfW-Unternehmerkredit und Nachfolge-Finanzierung"
content:
  de: |
    ## KfW ERP-Gründerkredit Universell
    ...
  en: |
    ## KfW ERP Start-up Loan
    ...
tags: [kfw, finanzierung, nachfolge]
source_type: manual
source_url: "https://www.kfw.de/inlandsfoerderung/"
source_law_paragraph: null
is_active: true
```

### Via Admin-Panel (für schnelle Korrekturen)

1. `https://deine-domain.de/admin.html` öffnen
2. Anmelden (E-Mail + Passwort)
3. `Wissensbasis` → `+ Neu` oder vorhandenen Eintrag bearbeiten

### Via KI-Update-Workflow

Der Scraper erkennt Gesetzesänderungen automatisch und stellt über OpenAI GPT-4o einen Änderungsvorschlag in der Pending-Queue bereit. Der Admin-Nutzer kann unter `Ausstehend` jeden Vorschlag prüfen und genehmigen oder ablehnen.

---

## Lizenz

Privates Projekt — alle Rechte vorbehalten.

---

## Hinweis

**Kein Ersatz für professionelle Beratung.** Die Bewertungsergebnisse und steuerlichen Einschätzungen sind Richtwerte. Für verbindliche Aussagen sind Steuerberater, Wirtschaftsprüfer und Rechtsanwälte hinzuzuziehen.
