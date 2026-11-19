# SplitMate — Smart Expense Sharing and Group Financial Management

A Splitwise-inspired full-stack app (original branding and UI) with its own splitting engine, debt-simplification algorithm, receipt OCR, analytics, budgets and admin console. **100% free and open-source; runs fully on your own machine.**

| Layer | Tech |
|---|---|
| Client | React 18, TypeScript, Vite, Tailwind, Zustand, Recharts, Lucide |
| Server | Node 20+/22, Express, TypeScript, Zod, JWT (HTTP-only cookies), bcrypt |
| Database | MongoDB Community + Mongoose |
| OCR | Tesseract (local binary) |
| Tests | Vitest, Supertest, mongodb-memory-server, React Testing Library |

## Quick start (Windows, PowerShell)

1. Install: **Node.js 22 LTS**, **MongoDB Community**, **Tesseract** (UB Mannheim build), **Git**.
2. MongoDB as a single-node replica set (needed for transactions):
   ```powershell
   mkdir C:\data\rs0
   mongod --replSet rs0 --dbpath C:\data\rs0
   ```
   In a second terminal, once only: `mongosh --eval "rs.initiate()"`.
   (Plain standalone `mongod` also works; the app then runs without transactions and says so at start-up.)
3. Project setup:
   ```powershell
   git clone <your-repo> splitmate; cd splitmate
   npm install
   copy .env.example server\.env
   ```
   Edit `server\.env`: set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (long random strings), and `TESSERACT_PATH` (e.g. `C:\Program Files\Tesseract-OCR\tesseract.exe`).
4. Run (two terminals):
   ```powershell
   npm run dev:server      # API on http://localhost:4000  (Swagger: /docs)
   npm run dev:client      # App on http://localhost:5173
   ```
5. Optional admin account: `npm run seed:admin` (credentials from `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

**Forgot password (local):** the reset link is printed in the server console and shown at `GET /api/v1/dev/outbox` (development only). Set `SMTP_*` for real email with any free SMTP provider.

**Docker alternative:** put the two JWT secrets in a root `.env`, then `docker compose up --build` and open http://localhost:8080.

## Tests
```powershell
npm test                          # server: engine + API (downloads a MongoDB binary once)
npm run test -w client            # client component tests
npm run test:engine -w server     # pure engine only, no database needed
```

## Key design points
- Money is **integer paise** everywhere; the client never decides financial results.
- Splits use the **largest-remainder method**, so allocations always sum exactly to the expense.
- **Balances are derived** from expenses + completed settlements, never stored, so edits and deletes cannot drift.
- Debt simplification: net balances → greedy two-heap (≤ n−1 transfers, O(n log n)), plus an exact bitmask-DP mode for groups of ≤ 16 people. See `docs/algorithms.md`.
- Settlements are **manual**: SplitMate never moves money or claims to process UPI. The receiver confirms.
- Security: bcrypt(12), rotating hashed refresh tokens, HTTP-only SameSite cookies + CSRF header, Helmet, rate limits, Zod validation, upload magic-byte checks, audit logs, account lockout, CSV formula-injection guard.

## Free-hosting note
Optional only. Free tiers (Vercel Hobby, Render, MongoDB Atlas) change their limits often; check their current terms before deploying. The app does not depend on any of them.

## Structure
`server/src/engine` (pure logic) · `server/src/services` · `server/src/routes` · `client/src/pages` · `client/src/ui` (design system) · `docs/`
