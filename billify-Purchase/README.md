# BillForge

BillForge stores invoices and customers in a MongoDB Atlas cluster when launched through the local server.

## Start

Create a local `.env` file from `.env.example`, then replace the example value with your MongoDB Atlas connection string:

```powershell
copy .env.example .env
```

Use either `MONGODB_URI` or `MONGODB_URL` as the key. Keep `.env` private; it is ignored by Git.

Double-click `start_billforge.bat`, or run:

```powershell
node server.js
```

Then open:

```text
http://127.0.0.1:8000
```

Existing invoices and customers from browser local storage are automatically copied into the MongoDB Atlas database the first time the server-backed app opens and the database is empty.

Use **Save Customer** on the invoice form to store a customer's name, phone, and notes. Pick them later from **Saved Customer** to reuse those details.
