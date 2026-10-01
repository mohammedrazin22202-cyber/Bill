const fs = require('fs');
const http = require('http');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;
const DB_DIR = path.resolve(process.env.PERSISTENT_DIR || ROOT, 'db');
const INVOICES_FILE = path.resolve(DB_DIR, 'invoices.json');
const CUSTOMERS_FILE = path.resolve(DB_DIR, 'customers.json');
const PAYMENTS_FILE = path.resolve(DB_DIR, 'payments.json');

// Read MONGODB_URI from process env or parse it manually from .env file
const envPath = path.resolve(ROOT, '.env');
let MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^MONGODB_URI\s*=\s*(.+)$/m);
  if (match) {
    MONGO_URI = match[1].trim();
  }
}

if (!MONGO_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set and could not be loaded from .env. Exiting.');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db = null;

async function connectDb() {
  if (!db) {
    try {
      await client.connect();
      db = client.db('Billify');
      console.log('Connected to MongoDB Atlas');
    } catch (err) {
      console.error('Failed to connect to MongoDB Atlas:', err);
    }
  }
  if (!db) {
    throw new Error('Database connection not established');
  }
  return db;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function migrateLegacyDb() {
  const legacyDbFile = path.resolve(process.env.PERSISTENT_DIR || ROOT, 'db.json');
  if (fs.existsSync(legacyDbFile)) {
    console.log('Migrating legacy db.json to db/ folder...');
    try {
      const data = JSON.parse(fs.readFileSync(legacyDbFile, 'utf8'));
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }
      // Save invoices
      if (Array.isArray(data.invoices)) {
        fs.writeFileSync(INVOICES_FILE, JSON.stringify(data.invoices, null, 2), 'utf8');
        console.log(`Migrated ${data.invoices.length} invoices to db/invoices.json`);
      } else {
        fs.writeFileSync(INVOICES_FILE, JSON.stringify([], null, 2), 'utf8');
      }
      // Save customers
      if (Array.isArray(data.customers)) {
        fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(data.customers, null, 2), 'utf8');
        console.log(`Migrated ${data.customers.length} customers to db/customers.json`);
      } else {
        fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify([], null, 2), 'utf8');
      }
      // Rename legacy db.json to db.json.bak
      fs.renameSync(legacyDbFile, `${legacyDbFile}.bak`);
      console.log('Legacy db.json successfully renamed to db.json.bak');
    } catch (err) {
      console.error('Error migrating legacy database:', err);
    }
  }
}

function readInvoicesFile() {
  if (!fs.existsSync(INVOICES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(INVOICES_FILE, 'utf8');
    return JSON.parse(data) || [];
  } catch (err) {
    console.error('Error reading invoices.json, returning empty list:', err);
    return [];
  }
}

function writeInvoicesFile(data) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(INVOICES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to invoices.json:', err);
  }
}

function readCustomersFile() {
  if (!fs.existsSync(CUSTOMERS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(CUSTOMERS_FILE, 'utf8');
    return JSON.parse(data) || [];
  } catch (err) {
    console.error('Error reading customers.json, returning empty list:', err);
    return [];
  }
}

function writeCustomersFile(data) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to customers.json:', err);
  }
}

function readPaymentsFile() {
  if (!fs.existsSync(PAYMENTS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(data) || [];
  } catch (err) {
    console.error('Error reading payments.json, returning empty list:', err);
    return [];
  }
}

function writePaymentsFile(data) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing to payments.json:', err);
  }
}

function initDbFiles() {
  migrateLegacyDb();
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(INVOICES_FILE)) {
    writeInvoicesFile([]);
  }
  if (!fs.existsSync(CUSTOMERS_FILE)) {
    writeCustomersFile([]);
  }
  if (!fs.existsSync(PAYMENTS_FILE)) {
    writePaymentsFile([]);
  }
}

function initDb() {
  initDbFiles();
  connectDb().catch(err => {
    console.error('Failed to connect to database in initDb:', err);
  });
}

async function readDb() {
  let invoices = [];
  try {
    const database = await connectDb();
    invoices = await database.collection('Invoices').find({}).sort({ created: -1 }).toArray();
    // Sync local file cache
    writeInvoicesFile(invoices);
  } catch (err) {
    console.warn('Failed to read from MongoDB Atlas, falling back to local invoices.json:', err.message);
    invoices = readInvoicesFile().sort((a, b) => b.created - a.created);
  }
  return invoices;
}

async function writeDb(invoices) {
  // 1. Save to invoices.json
  writeInvoicesFile(invoices);

  // 2. Try saving to Atlas
  try {
    const database = await connectDb();
    const invoicesCol = database.collection('Invoices');
    await invoicesCol.deleteMany({});
    if (invoices.length > 0) {
      await invoicesCol.insertMany(invoices);
    }
  } catch (err) {
    console.warn('Failed to write to MongoDB Atlas:', err.message);
  }
}

async function syncCustomersAmountDue() {
  // 1. Read all invoices
  let invoices = [];
  try {
    const database = await connectDb();
    invoices = await database.collection('Invoices').find({}).toArray();
  } catch (err) {
    invoices = readInvoicesFile();
  }

  // 2. Read all customers
  let customers = [];
  try {
    const database = await connectDb();
    customers = await database.collection('Customers').find({}).toArray();
  } catch (err) {
    customers = readCustomersFile();
  }

  // 3. Read all payments (needed to account for general/unlinked payments,
  // which are not tied to a specific invoice and therefore aren't reflected
  // in any invoice's amountPaid/status below)
  let payments = [];
  try {
    const database = await connectDb();
    payments = await database.collection('Payments').find({}).toArray();
  } catch (err) {
    payments = readPaymentsFile();
  }

  // Calculate amount due for each customer based on their name
  const amountDueMap = {};
  customers.forEach(c => {
    amountDueMap[c.name.toLowerCase()] = 0;
  });

  invoices.forEach(inv => {
    if (inv.billTo && inv.status !== 'draft' && inv.status !== 'cancelled') {
      const nameKey = inv.billTo.toLowerCase();
      const due = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
      if (amountDueMap[nameKey] !== undefined) {
        amountDueMap[nameKey] += due;
      }
    }
  });

  // Subtract general (unlinked) payments. Payments linked to an invoice are
  // already reflected above via that invoice's amountPaid/status, so only
  // unlinked ones need to be subtracted here to avoid double-counting.
  payments.forEach(p => {
    if (!p.invoiceId && p.customerName) {
      const nameKey = p.customerName.toLowerCase();
      if (amountDueMap[nameKey] !== undefined) {
        amountDueMap[nameKey] -= Number(p.amount) || 0;
      }
    }
  });

  // Update customers array
  const updatedCustomers = customers.map(c => {
    c.amountDue = amountDueMap[c.name.toLowerCase()] || 0;
    return c;
  });

  // Save updated customers to local cache
  writeCustomersFile(updatedCustomers);

  // Try updating MongoDB Atlas
  try {
    const database = await connectDb();
    const customersCol = database.collection('Customers');
    for (const c of updatedCustomers) {
      const doc = { ...c };
      delete doc._id;
      await customersCol.replaceOne({ id: c.id }, doc, { upsert: true });
    }
  } catch (err) {
    console.warn('Failed to sync amountDue to MongoDB Atlas:', err.message);
  }
}

function normalizeInvoice(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    invNo: String(data.invNo || '').trim(),
    billTo: String(data.billTo || '').trim(),
    invDate: data.invDate || '',
    currency: data.currency || 'INR',
    discount: Number(data.discount) || 0,
    deliveryCharge: Number(data.deliveryCharge) || 0,
    tax: Number(data.tax) || 0,
    notes: data.notes || '',
    phone: data.phone || '',
    status: data.status || 'draft',
    amountPaid: Number(data.amountPaid) || 0,
    lines: Array.isArray(data.lines) ? data.lines : [],
    subtotal: Number(data.subtotal) || 0,
    total: Number(data.total) || 0,
    created: Number(data.created) || now,
    updated: now,
  };
}

function normalizeCustomer(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    name: String(data.name || data.billTo || '').trim(),
    phone: String(data.phone || '').trim(),
    notes: data.notes || '',
    amountDue: Number(data.amountDue) || 0,
    created: Number(data.created) || now,
    updated: now,
  };
}

async function saveInvoice(data) {
  const invoice = normalizeInvoice(data);
  if (!invoice.invNo) return { error: 'Invoice number is required' };
  if (!invoice.billTo) return { error: 'Bill To is required' };

  // 1. Save to invoices.json
  const invoices = readInvoicesFile();
  const idx = invoices.findIndex(i => i.id === invoice.id);
  if (idx >= 0) {
    invoices[idx] = invoice;
  } else {
    invoices.unshift(invoice);
  }
  writeInvoicesFile(invoices);

  // 2. Save to Atlas
  try {
    const database = await connectDb();
    const invoicesCol = database.collection('Invoices');
    await invoicesCol.replaceOne(
      { id: invoice.id },
      invoice,
      { upsert: true }
    );
  } catch (err) {
    console.warn('Failed to save invoice to MongoDB Atlas:', err.message);
  }

  // 3. Update customers amountDue
  await syncCustomersAmountDue();

  return invoice;
}

async function readCustomers() {
  await syncCustomersAmountDue();
  let customers = [];
  try {
    const database = await connectDb();
    customers = await database.collection('Customers').find({}).sort({ name: 1 }).toArray();
    writeCustomersFile(customers);
  } catch (err) {
    console.warn('Failed to read customers from MongoDB Atlas, falling back to customers.json:', err.message);
    customers = readCustomersFile().sort((a, b) => a.name.localeCompare(b.name));
  }
  return customers;
}

async function saveCustomer(data) {
  const customer = normalizeCustomer(data);
  if (!customer.name) return { error: 'Customer name is required' };

  // 1. Save to customers.json
  const customers = readCustomersFile();
  const idx = customers.findIndex(c => c.id === customer.id);
  if (idx >= 0) {
    customers[idx] = customer;
  } else {
    customers.push(customer);
  }
  writeCustomersFile(customers);

  // 2. Save to Atlas
  try {
    const database = await connectDb();
    const customersCol = database.collection('Customers');
    await customersCol.replaceOne(
      { id: customer.id },
      customer,
      { upsert: true }
    );
  } catch (err) {
    console.warn('Failed to save customer to MongoDB Atlas:', err.message);
  }

  // 3. Recalculate amountDue
  await syncCustomersAmountDue();

  // Return the customer from local file with its correct amountDue
  const updated = readCustomersFile().find(c => c.id === customer.id);
  return updated || customer;
}

async function deleteCustomer(id) {
  // 1. Delete from customers.json
  const customers = readCustomersFile();
  const filtered = customers.filter(c => c.id !== Number(id));
  writeCustomersFile(filtered);

  // 2. Delete from Atlas
  try {
    const database = await connectDb();
    await database.collection('Customers').deleteOne({ id: Number(id) });
  } catch (err) {
    console.warn('Failed to delete customer from MongoDB Atlas:', err.message);
  }

  // 3. Recalculate customers amountDue
  await syncCustomersAmountDue();
}

function normalizePayment(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    payDate: data.payDate || '',
    payRefNo: String(data.payRefNo || '').trim(),
    customerId: Number(data.customerId) || 0,
    customerName: String(data.customerName || '').trim(),
    invoiceId: data.invoiceId ? Number(data.invoiceId) : null,
    invoiceNo: data.invoiceNo ? String(data.invoiceNo).trim() : null,
    method: data.method || 'Cash',
    amount: Number(data.amount) || 0,
    notes: data.notes || '',
    created: Number(data.created) || now,
  };
}

async function readPayments() {
  let payments = [];
  try {
    const database = await connectDb();
    payments = await database.collection('Payments').find({}).sort({ payDate: -1, created: -1 }).toArray();
    writePaymentsFile(payments);
  } catch (err) {
    console.warn('Failed to read payments from MongoDB Atlas, falling back to payments.json:', err.message);
    payments = readPaymentsFile().sort((a, b) => b.created - a.created);
  }
  return payments;
}

async function savePayment(data) {
  const payment = normalizePayment(data);
  if (!payment.customerName) return { error: 'Customer name is required' };
  if (payment.amount <= 0) return { error: 'Amount must be greater than zero' };

  // Load old payment if editing
  const payments = readPaymentsFile();
  const oldPayment = payments.find(p => p.id === payment.id);
  console.log('[DEBUG savePayment] payment.id:', payment.id, 'oldPayment found:', !!oldPayment, 'oldPayment:', oldPayment);

  // 1. Save to payments.json
  const idx = payments.findIndex(p => p.id === payment.id);
  if (idx >= 0) {
    payments[idx] = payment;
  } else {
    payments.unshift(payment);
  }
  writePaymentsFile(payments);

  // 2. Save to Atlas
  try {
    const database = await connectDb();
    const paymentsCol = database.collection('Payments');
    await paymentsCol.replaceOne(
      { id: payment.id },
      payment,
      { upsert: true }
    );
  } catch (err) {
    console.warn('Failed to save payment to MongoDB Atlas:', err.message);
  }

  // 3. Invoice Synchronization
  const invoices = readInvoicesFile();

  // Revert old invoice if link changed or if amount changed
  if (oldPayment && oldPayment.invoiceId) {
    const oldInv = invoices.find(i => i.id === oldPayment.invoiceId);
    if (oldInv) {
      if (!payment.invoiceId || payment.invoiceId !== oldPayment.invoiceId) {
        // Completely unlinked or linked to a different invoice. Revert full amount.
        oldInv.amountPaid = Math.max(0, (oldInv.amountPaid || 0) - oldPayment.amount);
      } else {
        // Same invoice, but amount changed. Adjust difference.
        const diff = payment.amount - oldPayment.amount;
        oldInv.amountPaid = Math.max(0, (oldInv.amountPaid || 0) + diff);
      }
      // Update status
      if (oldInv.amountPaid >= oldInv.total) {
        oldInv.status = 'paid';
      } else if (oldInv.amountPaid > 0) {
        oldInv.status = 'partially_paid';
      } else {
        oldInv.status = 'due';
      }
    }
  }

  // Apply to new invoice if linked
  if (payment.invoiceId && (!oldPayment || oldPayment.invoiceId !== payment.invoiceId)) {
    const newInv = invoices.find(i => i.id === payment.invoiceId);
    if (newInv) {
      newInv.amountPaid = (newInv.amountPaid || 0) + payment.amount;
      if (newInv.amountPaid >= newInv.total) {
        newInv.status = 'paid';
      } else {
        newInv.status = 'partially_paid';
      }
    }
  }

  // Save invoices back
  writeInvoicesFile(invoices);
  try {
    const database = await connectDb();
    const invoicesCol = database.collection('Invoices');
    for (const inv of invoices) {
      const doc = { ...inv };
      delete doc._id;
      await invoicesCol.replaceOne({ id: inv.id }, doc, { upsert: true });
    }
  } catch (err) {
    console.warn('Failed to update invoices during payment save:', err.message);
  }

  // 4. Update customer balances
  await syncCustomersAmountDue();

  return payment;
}

async function deletePayment(id) {
  const payments = readPaymentsFile();
  const payment = payments.find(p => p.id === Number(id));

  if (payment) {
    // 1. Delete from payments.json
    const filtered = payments.filter(p => p.id !== Number(id));
    writePaymentsFile(filtered);

    // 2. Delete from Atlas
    try {
      const database = await connectDb();
      await database.collection('Payments').deleteOne({ id: Number(id) });
    } catch (err) {
      console.warn('Failed to delete payment from MongoDB Atlas:', err.message);
    }

    // 3. Invoice Synchronization (revert payment amount)
    if (payment.invoiceId) {
      const invoices = readInvoicesFile();
      const inv = invoices.find(i => i.id === payment.invoiceId);
      if (inv) {
        inv.amountPaid = Math.max(0, (inv.amountPaid || 0) - payment.amount);
        if (inv.amountPaid >= inv.total) {
          inv.status = 'paid';
        } else if (inv.amountPaid > 0) {
          inv.status = 'partially_paid';
         } else {
          inv.status = 'due';
        }
        writeInvoicesFile(invoices);
        try {
          const database = await connectDb();
          const doc = { ...inv };
          delete doc._id;
          await database.collection('Invoices').replaceOne({ id: inv.id }, doc, { upsert: true });
        } catch (err) {
          console.warn('Failed to update invoice during payment delete:', err.message);
        }
      }
    }

    // 4. Recalculate customer balances
    await syncCustomersAmountDue();
  }
}

function sendJson(res, data, status = 200) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(ROOT, requested);

  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
  });
  res.end(body);
}

const SESSIONS = new Set();

function getSessionId(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

const server = http.createServer(async (req, res) => {
  console.log(`[HTTP LOCAL ATLAS] ${req.method} ${req.url}`);
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // Authentication endpoints
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const { username, password } = await readBody(req);
      if (username === '9841021203' && password === 'Msbdeen@21203') {
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        SESSIONS.add(sessionId);
        res.writeHead(200, {
          'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`,
          'Content-Type': 'application/json'
        });
        return res.end(JSON.stringify({ ok: true }));
      } else {
        return sendJson(res, { error: 'Invalid username or password' }, 401);
      }
    } catch (err) {
      return sendJson(res, { error: 'Invalid request body' }, 400);
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const sessionId = getSessionId(req);
    if (sessionId) {
      SESSIONS.delete(sessionId);
    }
    res.writeHead(200, {
      'Set-Cookie': 'session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict',
      'Content-Type': 'application/json'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === 'GET' && pathname === '/api/auth/status') {
    const sessionId = getSessionId(req);
    const loggedIn = sessionId && SESSIONS.has(sessionId);
    return sendJson(res, { loggedIn: !!loggedIn });
  }

  // Middleware protecting other API endpoints
  if (pathname.startsWith('/api/')) {
    const sessionId = getSessionId(req);
    if (!sessionId || !SESSIONS.has(sessionId)) {
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }
  }

  if (req.method === 'GET' && pathname === '/api/invoices') {
    try {
      const data = await readDb();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET' && pathname === '/api/customers') {
    try {
      const data = await readCustomers();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/invoices') {
    try {
      const saved = await saveInvoice(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid invoice data' }, 400);
    }
  }

  if (req.method === 'POST' && pathname === '/api/customers') {
    try {
      const saved = await saveCustomer(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid customer data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/invoices/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      // 1. Delete from invoices.json
      const invoices = readInvoicesFile();
      const filtered = invoices.filter(i => i.id !== id);
      writeInvoicesFile(filtered);

      // 2. Delete from Atlas
      try {
        const database = await connectDb();
        await database.collection('Invoices').deleteOne({ id: id });
      } catch (err) {
        console.warn('Failed to delete invoice from MongoDB Atlas:', err.message);
      }

      // 3. Recalculate amountDue
      await syncCustomersAmountDue();

      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/customers/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deleteCustomer(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET' && pathname === '/api/payments') {
    try {
      const data = await readPayments();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/payments') {
    try {
      const saved = await savePayment(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid payment data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/payments/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deletePayment(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(405);
  res.end('Method not allowed');
});

initDb();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BillForge Local Atlas Server is running at http://localhost:${PORT}`);
  });
}

module.exports = {
  initDb,
  readDb,
  writeDb,
  readCustomers,
  saveCustomer,
  deleteCustomer,
  saveInvoice,
  readPayments,
  savePayment,
  deletePayment,
  server,
};