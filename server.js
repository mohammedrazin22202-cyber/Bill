const http = require('http');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
loadLocalEnv();

const PORT = parseInt(process.env.PORT, 10) || 8000;
const DB_TYPE = process.env.DB_TYPE || (process.env.MONGODB_URI ? 'mongodb' : 'local');
const useLocalStorage = DB_TYPE === 'local';

let client = null;
let db = null;

if (!useLocalStorage) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!MONGO_URI) {
    console.warn('Warning: DB_TYPE is mongodb but MONGODB_URI is not set. Falling back to local storage.');
  } else {
    try {
      client = new MongoClient(MONGO_URI);
    } catch (e) {
      console.warn('Warning: Could not initialize MongoClient. Falling back to local storage:', e.message);
    }
  }
}

const dbFolder = path.join(ROOT, 'db');
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
}

function readJsonFile(filename, defaultVal = []) {
  const filePath = path.join(dbFolder, filename);
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error creating default file ${filename}:`, err);
    }
    return defaultVal;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultVal;
  }
}

function writeJsonFile(filename, data) {
  const filePath = path.join(dbFolder, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
  }
}

function matchItem(item, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const key in query) {
    const val = query[key];
    if (val && typeof val === 'object') {
      if ('$gt' in val) {
        if (!(item[key] > val.$gt)) return false;
      } else if ('$gte' in val) {
        if (!(item[key] >= val.$gte)) return false;
      } else if ('$lt' in val) {
        if (!(item[key] < val.$lt)) return false;
      } else if ('$lte' in val) {
        if (!(item[key] <= val.$lte)) return false;
      } else if ('$ne' in val) {
        if (item[key] === val.$ne) return false;
      } else if ('$in' in val) {
        if (!Array.isArray(val.$in) || !val.$in.includes(item[key])) return false;
      } else if ('$nin' in val) {
        if (Array.isArray(val.$nin) && val.$nin.includes(item[key])) return false;
      } else if ('$regex' in val) {
        let regex = val.$regex;
        if (!(regex instanceof RegExp)) {
          regex = new RegExp(regex);
        }
        if (!regex.test(item[key])) return false;
      } else {
        if (JSON.stringify(item[key]) !== JSON.stringify(val)) return false;
      }
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

const localDbWrapper = {
  collection(collectionName) {
    let filename = '';
    if (collectionName === 'Invoices') filename = 'invoices.json';
    else if (collectionName === 'Parties') filename = 'customers.json';
    else if (collectionName === 'Payments') filename = 'payments.json';
    else if (collectionName === 'SupplierPayments') filename = 'supplier_payments.json';
    else if (collectionName === 'Products') filename = 'products.json';
    else if (collectionName === 'Lots') filename = 'lots.json';
    else if (collectionName === 'StockTransactions') filename = 'stock_transactions.json';
    else if (collectionName === 'Purchases') filename = 'purchases.json';
    else filename = `${collectionName.toLowerCase()}.json`;

    return {
      find(query = {}) {
        const data = readJsonFile(filename);
        let filtered = data.filter(item => matchItem(item, query));

        const cursor = {
          sort(sortQuery) {
            const sortKey = Object.keys(sortQuery)[0];
            if (sortKey) {
              const sortDir = sortQuery[sortKey];
              filtered.sort((a, b) => {
                const valA = a[sortKey];
                const valB = b[sortKey];
                if (typeof valA === 'string' && typeof valB === 'string') {
                  return valA.localeCompare(valB, undefined, { sensitivity: 'base' }) * sortDir;
                }
                if (valA < valB) return -1 * sortDir;
                if (valA > valB) return 1 * sortDir;
                return 0;
              });
            }
            return this;
          },
          limit(limitVal) {
            filtered = filtered.slice(0, limitVal);
            return this;
          },
          async toArray() {
            return filtered;
          }
        };
        return cursor;
      },

      async findOne(query) {
        const cursor = this.find(query);
        const results = await cursor.toArray();
        return results[0] || null;
      },

      async insertOne(doc) {
        const data = readJsonFile(filename);
        data.push(doc);
        writeJsonFile(filename, data);
        return { insertedId: doc._id || doc.id || Date.now() };
      },

      async insertMany(docs) {
        const data = readJsonFile(filename);
        data.push(...docs);
        writeJsonFile(filename, data);
        return { insertedCount: docs.length };
      },

      async replaceOne(query, doc, options = {}) {
        const data = readJsonFile(filename);
        const index = data.findIndex(item => matchItem(item, query));
        if (index !== -1) {
          data[index] = doc;
        } else if (options.upsert) {
          data.push(doc);
        }
        writeJsonFile(filename, data);
        return { matchedCount: index !== -1 ? 1 : 0, modifiedCount: index !== -1 ? 1 : 0 };
      },

      async updateOne(query, updateDoc) {
        const data = readJsonFile(filename);
        const index = data.findIndex(item => matchItem(item, query));
        if (index !== -1 && updateDoc.$set) {
          data[index] = { ...data[index], ...updateDoc.$set };
          writeJsonFile(filename, data);
        }
        return { matchedCount: index !== -1 ? 1 : 0, modifiedCount: index !== -1 ? 1 : 0 };
      },

      async deleteOne(query) {
        const data = readJsonFile(filename);
        const index = data.findIndex(item => matchItem(item, query));
        if (index !== -1) {
          data.splice(index, 1);
          writeJsonFile(filename, data);
        }
        return { deletedCount: index !== -1 ? 1 : 0 };
      },

      async deleteMany(query) {
        let data = readJsonFile(filename);
        const initialLength = data.length;
        data = data.filter(item => !matchItem(item, query));
        writeJsonFile(filename, data);
        return { deletedCount: initialLength - data.length };
      }
    };
  }
};

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
    else if (val.startsWith("'") && val.endsWith("'")) val = val.substring(1, val.length - 1);
    process.env[key] = val;
  }
}

function hybridDbWrapper(mongoDb) {
  return {
    collection(collectionName) {
      const mongoCol = mongoDb.collection(collectionName);
      const localCol = localDbWrapper.collection(collectionName);

      return {
        find(query) {
          return mongoCol.find(query);
        },
        async findOne(query) {
          return await mongoCol.findOne(query);
        },
        async insertOne(doc) {
          const res = await mongoCol.insertOne(doc);
          try {
            await localCol.insertOne(doc);
          } catch (e) {
            console.error('Failed to sync insertOne to local storage:', e);
          }
          return res;
        },
        async insertMany(docs) {
          const res = await mongoCol.insertMany(docs);
          try {
            await localCol.insertMany(docs);
          } catch (e) {
            console.error('Failed to sync insertMany to local storage:', e);
          }
          return res;
        },
        async replaceOne(query, doc, options) {
          const res = await mongoCol.replaceOne(query, doc, options);
          try {
            await localCol.replaceOne(query, doc, options);
          } catch (e) {
            console.error('Failed to sync replaceOne to local storage:', e);
          }
          return res;
        },
        async updateOne(query, updateDoc) {
          const res = await mongoCol.updateOne(query, updateDoc);
          try {
            await localCol.updateOne(query, updateDoc);
          } catch (e) {
            console.error('Failed to sync updateOne to local storage:', e);
          }
          return res;
        },
        async deleteOne(query) {
          const res = await mongoCol.deleteOne(query);
          try {
            await localCol.deleteOne(query);
          } catch (e) {
            console.error('Failed to sync deleteOne to local storage:', e);
          }
          return res;
        },
        async deleteMany(query) {
          const res = await mongoCol.deleteMany(query);
          try {
            await localCol.deleteMany(query);
          } catch (e) {
            console.error('Failed to sync deleteMany to local storage:', e);
          }
          return res;
        }
      };
    }
  };
}

async function syncMongoToLocal() {
  try {
    const mongoDb = client.db('Billify');
    const collections = [
      { name: 'Invoices', file: 'invoices.json' },
      { name: 'Parties', file: 'customers.json' },
      { name: 'Payments', file: 'payments.json' },
      { name: 'SupplierPayments', file: 'supplier_payments.json' },
      { name: 'Products', file: 'products.json' },
      { name: 'Lots', file: 'lots.json' },
      { name: 'StockTransactions', file: 'stock_transactions.json' },
      { name: 'Purchases', file: 'purchases.json' }
    ];

    console.log('Syncing MongoDB Atlas data to local JSON files...');
    for (const col of collections) {
      const docs = await mongoDb.collection(col.name).find({}).toArray();
      if (docs && docs.length > 0) {
        writeJsonFile(col.file, docs);
      }
    }
    console.log('Sync completed successfully.');
  } catch (err) {
    console.error('Failed to sync MongoDB Atlas to local JSON files:', err.message);
  }
}

async function connectDb() {
  if (useLocalStorage || !client) {
    return localDbWrapper;
  }
  if (!db) {
    try {
      await client.connect();
      const mongoDb = client.db('Billify');
      db = hybridDbWrapper(mongoDb);
      console.log('Connected to MongoDB Atlas');
    } catch (err) {
      console.error('Failed to connect to MongoDB Atlas, falling back to local files:', err.message);
      return localDbWrapper;
    }
  }
  return db;
}

function initDb() {
  if (useLocalStorage || !client) {
    console.log('Running in Local JSON File Storage mode.');
    return;
  }
  connectDb().then(async () => {
    await syncMongoToLocal();
  }).catch(err => {
    console.error('Failed to connect in initDb:', err.message);
  });
}

async function readDb() {
  const database = await connectDb();
  return await database.collection('Invoices').find({}).sort({ created: -1 }).toArray();
}

async function writeDb(invoices) {
  const database = await connectDb();
  const invoicesCol = database.collection('Invoices');
  await invoicesCol.deleteMany({});
  if (invoices.length > 0) {
    await invoicesCol.insertMany(invoices);
  }
}

function normalizeInvoice(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    invNo: String(data.invNo || '').trim(),
    billTo: String(data.billTo || '').trim(),
    invDate: data.invDate || '',
    dueDate: data.dueDate || '',
    currency: data.currency || 'INR',
    discount: Number(data.discount) || 0,
    deliveryCharge: Number(data.deliveryCharge) || 0,
    tax: Number(data.tax) || 0,
    notes: data.notes || '',
    phone: data.phone || '',
    status: data.status || 'draft',
    amountPaid: Number(data.amountPaid) || 0,
    lines: Array.isArray(data.lines)
      ? data.lines.map((l, i) => ({
          id: Number(l.id) || i + 1,
          productId: l.productId ? Number(l.productId) : null,
          desc: String(l.desc || '').trim(),
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          unit: String(l.unit || 'pcs').trim(),
        }))
      : [],
    subtotal: Number(data.subtotal) || 0,
    total: Number(data.total) || 0,
    stockUpdated: !!data.stockUpdated,
    created: Number(data.created) || now,
    updated: now,
  };
}

function normalizeParty(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    name: String(data.name || data.billTo || '').trim(),
    phone: String(data.phone || '').trim(),
    notes: data.notes || '',
    partyType: data.partyType === 'supplier' ? 'supplier' : 'customer',
    creditLimit: Number(data.creditLimit) || 0,
    creditPeriod: Number(data.creditPeriod) || 0,
    amountDue: Number(data.amountDue) || 0,
    created: Number(data.created) || now,
    updated: now,
  };
}

// ── Products / Stock ──────────────────────────────────────────────────────────

function normalizeProduct(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    name: String(data.name || '').trim(),
    sku: String(data.sku || '').trim(),
    unit: String(data.unit || 'pcs').trim(),
    purchasePrice: Number(data.purchasePrice) || 0,
    sellingPrice: Number(data.sellingPrice) || 0,
    stock: Number(data.stock) || 0,
    lowStockAlert: Number(data.lowStockAlert) || 0,
    notes: data.notes || '',
    created: Number(data.created) || now,
    updated: now,
  };
}

async function readProducts() {
  const database = await connectDb();
  return await database.collection('Products').find({}).sort({ name: 1 }).toArray();
}

async function saveProduct(data) {
  const product = normalizeProduct(data);
  if (!product.name) return { error: 'Product name is required' };

  const database = await connectDb();
  const productsCol = database.collection('Products');
  await productsCol.replaceOne(
    { id: product.id },
    product,
    { upsert: true }
  );
  return product;
}

async function deleteProduct(id) {
  const database = await connectDb();
  await database.collection('Products').deleteOne({ id: Number(id) });
}

async function adjustStock(productId, deltaQty, reason = '', txType = 'ADJUSTMENT') {
  const database = await connectDb();
  const productsCol = database.collection('Products');
  const product = await productsCol.findOne({ id: Number(productId) });
  if (!product) return;

  const prevStock = Number(product.stock) || 0;
  const newStock = Math.max(0, prevStock + Number(deltaQty));
  await productsCol.updateOne({ id: Number(productId) }, { $set: { stock: newStock, updated: Date.now() } });

  const tx = {
    id: Date.now() + Math.random(),
    productId: Number(productId),
    productName: product.name,
    txType: String(txType).toUpperCase(),
    qty: Number(deltaQty),
    prevStock,
    newStock,
    reason: String(reason || '').trim(),
    created: Date.now(),
  };
  await database.collection('StockTransactions').insertOne(tx);
  return { prevStock, newStock };
}

// ── Purchases ─────────────────────────────────────────────────────────────────

function normalizePurchase(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    billNo: String(data.billNo || '').trim(),
    supplier: String(data.supplier || '').trim(),
    billDate: data.billDate || '',
    dueDate: data.dueDate || '',
    currency: data.currency || 'INR',
    discount: Number(data.discount) || 0,
    tax: Number(data.tax) || 0,
    adjustments: Array.isArray(data.adjustments)
      ? data.adjustments.map((a, i) => ({
          id: Number(a.id) || i + 1,
          name: String(a.name || '').trim(),
          amount: Number(a.amount) || 0,
          type: a.type === 'sub' ? 'sub' : 'add',
        }))
      : [],
    notes: data.notes || '',
    phone: data.phone || '',
    status: data.status || 'due',
    amountPaid: Number(data.amountPaid) || 0,
    lines: Array.isArray(data.lines)
      ? data.lines.map((l, i) => ({
          id: Number(l.id) || i + 1,
          productId: l.productId ? Number(l.productId) : null,
          productName: String(l.productName || l.desc || '').trim(),
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          unit: String(l.unit || 'pcs').trim(),
          total: Number(l.total) || 0,
        }))
      : [],
    boxes: Array.isArray(data.boxes)
      ? data.boxes.map((b, i) => ({
          boxNo: Number(b.boxNo) || i + 1,
          grossWeight: Number(b.grossWeight) || 0,
          items: Array.isArray(b.items)
            ? b.items.map((it, j) => ({
                id: Number(it.id) || j + 1,
                productId: it.productId ? Number(it.productId) : null,
                productName: String(it.productName || it.desc || '').trim(),
                grossWeight: Number(it.grossWeight) || 0,
                iceTare: Number(it.iceTare) || 0,
                boxTare: Number(it.boxTare) || 0,
                waterTare: Number(it.waterTare) || 0,
                tareWeight: Number(it.tareWeight) || 0,
                netWeight: Number(it.netWeight) || 0,
                rate: Number(it.rate) || 0,
                unit: String(it.unit || 'Kg').trim(),
                total: Number(it.total) || 0,
              }))
            : []
        }))
      : [],
    subtotal: Number(data.subtotal) || 0,
    total: Number(data.total) || 0,
    stockUpdated: !!data.stockUpdated,
    created: Number(data.created) || now,
    updated: now,
  };
}

async function readPurchases() {
  const database = await connectDb();
  return await database.collection('Purchases').find({}).sort({ created: -1 }).toArray();
}

async function savePurchase(data) {
  const purchase = normalizePurchase(data);
  if (!purchase.billNo) return { error: 'Bill number is required' };
  if (!purchase.supplier) return { error: 'Supplier is required' };

  const database = await connectDb();
  const purchasesCol = database.collection('Purchases');

  const existing = await purchasesCol.findOne({ id: purchase.id });
  const isNew = !existing;

  if (isNew) {
    const existingSupplier = await database.collection('Parties').findOne({ name: purchase.supplier, partyType: 'supplier' });
    if (!existingSupplier) {
      await saveParty({
        name: purchase.supplier,
        phone: purchase.phone || '',
        notes: 'Added automatically via Purchase Bill',
        partyType: 'supplier',
      });
    }
  }

  await purchasesCol.replaceOne(
    { id: purchase.id },
    purchase,
    { upsert: true }
  );

  // Update stock and create Lots if not already done
  if (!purchase.stockUpdated && isNew) {
    const itemsToAdd = [];
    if (purchase.boxes && purchase.boxes.length > 0) {
      for (const b of purchase.boxes) {
        for (const it of b.items) {
          if (it.productName && it.netWeight > 0) {
            itemsToAdd.push({
              productId: it.productId,
              productName: it.productName,
              qty: it.netWeight,
              unit: it.unit || 'Kg',
              rate: it.rate || 0,
            });
          }
        }
      }
    } else if (purchase.lines && purchase.lines.length > 0) {
      for (const l of purchase.lines) {
        if (l.productName && l.qty > 0) {
          itemsToAdd.push({
            productId: l.productId,
            productName: l.productName,
            qty: l.qty,
            unit: l.unit || 'pcs',
            rate: l.rate || 0,
          });
        }
      }
    }

    for (const item of itemsToAdd) {
      const prodId = await resolveProductId(database, item.productId, item.productName, item.unit, item.rate);
      if (prodId) {
        await adjustStock(
          prodId,
          item.qty,
          `Purchase: ${purchase.billNo} from ${purchase.supplier}`,
          'PURCHASE'
        );

        const lot = {
          id: Date.now() + Math.random(),
          productId: prodId,
          productName: item.productName,
          purchaseNo: purchase.billNo,
          purchasePrice: item.rate,
          originalQty: item.qty,
          qty: item.qty,
          unit: item.unit,
          created: Date.now(),
        };
        await database.collection('Lots').insertOne(lot);
      }
    }

    await purchasesCol.updateOne(
      { id: purchase.id },
      { $set: { stockUpdated: true } }
    );
    purchase.stockUpdated = true;
  }

  return purchase;
}

async function resolveProductId(database, existingId, productName, unit, purchasePrice) {
  if (existingId) return existingId;
  const productsCol = database.collection('Products');
  const existing = await productsCol.findOne({ name: productName });
  if (existing) return existing.id;

  const newProd = normalizeProduct({
    name: productName,
    unit: unit || 'Kg',
    purchasePrice: purchasePrice || 0,
    stock: 0,
  });
  await productsCol.insertOne(newProd);
  return newProd.id;
}

async function deletePurchase(id) {
  const database = await connectDb();
  const purchase = await database.collection('Purchases').findOne({ id: Number(id) });
  if (purchase) {
    if (purchase.stockUpdated) {
      const itemsToRevert = [];
      if (purchase.boxes && purchase.boxes.length > 0) {
        for (const b of purchase.boxes) {
          for (const it of b.items) {
            if (it.productName && it.netWeight > 0) {
              itemsToRevert.push({ productId: it.productId, productName: it.productName, qty: it.netWeight });
            }
          }
        }
      } else if (purchase.lines && purchase.lines.length > 0) {
        for (const l of purchase.lines) {
          if (l.productName && l.qty > 0) {
            itemsToRevert.push({ productId: l.productId, productName: l.productName, qty: l.qty });
          }
        }
      }

      for (const item of itemsToRevert) {
        const prodId = await resolveProductId(database, item.productId, item.productName);
        if (prodId) {
          await adjustStock(prodId, -item.qty, `Revert Purchase: ${purchase.billNo}`, 'REVERT_PURCHASE');
        }
      }
      await database.collection('Lots').deleteMany({ purchaseNo: purchase.billNo });
    }
    await database.collection('Purchases').deleteOne({ id: Number(id) });
  }
}

// ── Invoices & Customer Balance Sync ──────────────────────────────────────────

async function syncCustomersAmountDue() {
  try {
    const database = await connectDb();
    const invoices = await database.collection('Invoices').find({}).toArray();
    const payments = await database.collection('Payments').find({}).toArray();
    const partiesCol = database.collection('Parties');
    const parties = await partiesCol.find({ partyType: { $ne: 'supplier' } }).toArray();

    for (const cust of parties) {
      const custName = (cust.name || '').toLowerCase();
      const custInvoices = invoices.filter(i => (i.billTo || '').toLowerCase() === custName);
      
      const unlinkedPayments = payments.filter(p => {
        const pName = (p.customerName || p.party || '').toLowerCase();
        return pName === custName && !p.invoiceId;
      });

      const totalInvoiceDue = custInvoices.reduce((sum, inv) => {
        const bal = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0);
        return sum + Math.max(0, bal);
      }, 0);

      const totalUnlinkedPaid = unlinkedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const newDue = totalInvoiceDue - totalUnlinkedPaid;

      await partiesCol.updateOne(
        { id: cust.id },
        { $set: { amountDue: newDue, updated: Date.now() } }
      );
    }
  } catch (err) {
    console.warn('Failed to sync customer amounts due:', err.message);
  }
}

async function saveInvoice(data) {
  const invoice = normalizeInvoice(data);
  if (!invoice.invNo) return { error: 'Invoice number is required' };
  if (!invoice.billTo) return { error: 'Bill To is required' };

  const database = await connectDb();
  const invoicesCol = database.collection('Invoices');

  const wasStockUpdated = invoice.stockUpdated;
  const existing = await invoicesCol.findOne({ id: invoice.id });

  await invoicesCol.replaceOne(
    { id: invoice.id },
    invoice,
    { upsert: true }
  );

  // Deduct stock when invoice is marked paid or partially_paid
  const isChargeable = ['paid', 'partially_paid'].includes(invoice.status);
  if (
    isChargeable &&
    !wasStockUpdated &&
    !(existing && existing.stockUpdated)
  ) {
    for (const line of invoice.lines) {
      if (line.productId && line.qty > 0) {
        await adjustStock(
          line.productId,
          -line.qty,
          `Invoice: ${invoice.invNo}`,
          'SALE'
        );
      }
    }
    await invoicesCol.updateOne(
      { id: invoice.id },
      { $set: { stockUpdated: true } }
    );
    invoice.stockUpdated = true;
  }

  // Synchronize customer amountDue
  await syncCustomersAmountDue();

  return invoice;
}

async function deleteInvoice(id) {
  const database = await connectDb();
  const invoice = await database.collection('Invoices').findOne({ id: Number(id) });
  if (invoice) {
    if (invoice.stockUpdated) {
      for (const line of invoice.lines) {
        if (line.productId && line.qty > 0) {
          await adjustStock(line.productId, line.qty, `Revert Sale: ${invoice.invNo}`, 'REVERT_SALE');
        }
      }
    }
    await database.collection('Invoices').deleteOne({ id: Number(id) });
    await syncCustomersAmountDue();
  }
}

// ── Parties (Customers & Suppliers) ───────────────────────────────────────────

async function readParties(typeFilter = null) {
  const database = await connectDb();
  let query = {};
  if (typeFilter === 'customer') {
    query = { partyType: { $ne: 'supplier' } };
  } else if (typeFilter === 'supplier') {
    query = { partyType: 'supplier' };
  }
  return await database.collection('Parties').find(query).sort({ name: 1 }).toArray();
}

async function saveParty(data) {
  const party = normalizeParty(data);
  if (!party.name) return { error: 'Party name is required' };

  const database = await connectDb();
  const partiesCol = database.collection('Parties');
  await partiesCol.replaceOne(
    { id: party.id },
    party,
    { upsert: true }
  );
  return party;
}

async function deleteParty(id, cleanBills = false, cleanPayments = false) {
  const database = await connectDb();
  const party = await database.collection('Parties').findOne({ id: Number(id) });
  if (party) {
    if (cleanBills && party.partyType === 'supplier') {
      const supplierName = party.name;
      const purchasesCol = database.collection('Purchases');
      const purchases = await purchasesCol.find({ supplier: supplierName }).toArray();
      for (const p of purchases) {
        await deletePurchase(p.id);
      }
    }
    if (cleanPayments && party.partyType === 'supplier') {
      const supplierName = party.name;
      await database.collection('SupplierPayments').deleteMany({ supplier: supplierName });
    }
    await database.collection('Parties').deleteOne({ id: Number(id) });
  }
}

// ── Payments (Customer Collections) ───────────────────────────────────────────

function normalizePayment(data) {
  const now = Date.now();
  const party = String(data.party || data.customerName || '').trim();
  const date = data.date || data.payDate || '';
  const method = data.paymentMode || data.method || 'Cash';
  const refNo = String(data.transactionNumber || data.payRefNo || '').trim();
  const note = data.note || data.notes || '';
  return {
    id: Number(data.id) || now,
    party: party,
    customerName: party,
    customerId: Number(data.customerId) || 0,
    invoiceId: data.invoiceId ? Number(data.invoiceId) : null,
    invoiceNo: data.invoiceNo ? String(data.invoiceNo).trim() : null,
    amount: Number(data.amount) || 0,
    date: date,
    payDate: date,
    paymentMode: method,
    method: method,
    transactionNumber: refNo,
    payRefNo: refNo,
    personName: String(data.personName || '').trim(),
    bankDetails: String(data.bankDetails || '').trim(),
    remarks: String(data.remarks || '').trim(),
    note: note,
    notes: note,
    created: Number(data.created) || now,
    updated: now,
  };
}

async function readPayments() {
  const database = await connectDb();
  return await database.collection('Payments').find({}).sort({ created: -1 }).toArray();
}

async function savePayment(data) {
  const payment = normalizePayment(data);
  if (!payment.party) return { error: 'Customer / Party name is required' };
  if (payment.amount <= 0) return { error: 'Payment amount must be greater than 0' };

  const database = await connectDb();
  const paymentsCol = database.collection('Payments');
  const invoicesCol = database.collection('Invoices');

  const oldPayment = await paymentsCol.findOne({ id: payment.id });

  // 1. Save payment
  await paymentsCol.replaceOne(
    { id: payment.id },
    payment,
    { upsert: true }
  );

  // 2. Invoice Synchronization if linked
  if (oldPayment && oldPayment.invoiceId) {
    const oldInv = await invoicesCol.findOne({ id: oldPayment.invoiceId });
    if (oldInv) {
      if (!payment.invoiceId || payment.invoiceId !== oldPayment.invoiceId) {
        oldInv.amountPaid = Math.max(0, (oldInv.amountPaid || 0) - oldPayment.amount);
      } else {
        const diff = payment.amount - oldPayment.amount;
        oldInv.amountPaid = Math.max(0, (oldInv.amountPaid || 0) + diff);
      }
      if (oldInv.amountPaid >= oldInv.total) {
        oldInv.status = 'paid';
      } else if (oldInv.amountPaid > 0) {
        oldInv.status = 'partially_paid';
      } else {
        oldInv.status = 'due';
      }
      await invoicesCol.replaceOne({ id: oldInv.id }, oldInv);
    }
  }

  if (payment.invoiceId && (!oldPayment || oldPayment.invoiceId !== payment.invoiceId)) {
    const newInv = await invoicesCol.findOne({ id: payment.invoiceId });
    if (newInv) {
      newInv.amountPaid = (newInv.amountPaid || 0) + payment.amount;
      if (newInv.amountPaid >= newInv.total) {
        newInv.status = 'paid';
      } else {
        newInv.status = 'partially_paid';
      }
      await invoicesCol.replaceOne({ id: newInv.id }, newInv);
    }
  }

  // 3. Update customer balance
  await syncCustomersAmountDue();

  return payment;
}

async function deletePayment(id) {
  const database = await connectDb();
  const paymentsCol = database.collection('Payments');
  const payment = await paymentsCol.findOne({ id: Number(id) });

  if (payment) {
    await paymentsCol.deleteOne({ id: Number(id) });

    // Revert invoice payment
    if (payment.invoiceId) {
      const invoicesCol = database.collection('Invoices');
      const inv = await invoicesCol.findOne({ id: payment.invoiceId });
      if (inv) {
        inv.amountPaid = Math.max(0, (inv.amountPaid || 0) - payment.amount);
        if (inv.amountPaid >= inv.total) {
          inv.status = 'paid';
        } else if (inv.amountPaid > 0) {
          inv.status = 'partially_paid';
        } else {
          inv.status = 'due';
        }
        await invoicesCol.replaceOne({ id: inv.id }, inv);
      }
    }

    await syncCustomersAmountDue();
  }
}

// ── Supplier Payments ─────────────────────────────────────────────────────────

function normalizeSupplierPayment(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    supplier: String(data.supplier || '').trim(),
    amount: Number(data.amount) || 0,
    date: data.date || '',
    note: data.note || '',
    paymentMode: String(data.paymentMode || '').trim(),
    personName: String(data.personName || '').trim(),
    transactionNumber: String(data.transactionNumber || '').trim(),
    bankDetails: String(data.bankDetails || '').trim(),
    remarks: String(data.remarks || '').trim(),
    created: Number(data.created) || now,
    updated: now,
  };
}

async function readSupplierPayments() {
  const database = await connectDb();
  return await database.collection('SupplierPayments').find({}).sort({ created: -1 }).toArray();
}

async function saveSupplierPayment(data) {
  const payment = normalizeSupplierPayment(data);
  if (!payment.supplier) return { error: 'Supplier name is required' };
  if (payment.amount <= 0) return { error: 'Payment amount must be greater than 0' };

  const database = await connectDb();
  const supplierPaymentsCol = database.collection('SupplierPayments');
  await supplierPaymentsCol.replaceOne(
    { id: payment.id },
    payment,
    { upsert: true }
  );
  return payment;
}

async function deleteSupplierPayment(id) {
  const database = await connectDb();
  await database.collection('SupplierPayments').deleteOne({ id: Number(id) });
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveStatic(req, res, pathname) {
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relativePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── Authentication & Sessions ─────────────────────────────────────────────────

const SESSIONS = new Set();

function getSessionId(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // Authentication endpoints
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const { username, password } = await readBody(req);
      if ((username === '9841021203' && password === 'Msbdeen@21203') ||
          (username === 'admin' && password === 'admin123')) {
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

  // Protected API middleware
  if (pathname.startsWith('/api/')) {
    const sessionId = getSessionId(req);
    if (!sessionId || !SESSIONS.has(sessionId)) {
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }
  }

  // Invoices API
  if (req.method === 'GET' && pathname === '/api/invoices') {
    try {
      const data = await readDb();
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

  if (req.method === 'DELETE' && pathname.startsWith('/api/invoices/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deleteInvoice(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Parties & Customers API (Unified & Backward Compatible)
  if (req.method === 'GET' && (pathname === '/api/parties' || pathname === '/api/customers')) {
    try {
      const filter = pathname === '/api/customers' ? 'customer' : searchParams.get('type');
      const data = await readParties(filter);
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && (pathname === '/api/parties' || pathname === '/api/customers')) {
    try {
      const body = await readBody(req);
      if (pathname === '/api/customers' && !body.partyType) {
        body.partyType = 'customer';
      }
      const saved = await saveParty(body);
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid party data' }, 400);
    }
  }

  if (req.method === 'DELETE' && (pathname.startsWith('/api/parties/') || pathname.startsWith('/api/customers/'))) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      const cleanBills = searchParams.get('cleanBills') === 'true';
      const cleanPayments = searchParams.get('cleanPayments') === 'true';
      await deleteParty(id, cleanBills, cleanPayments);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Payments (Customer Collections) API
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

  // Supplier Payments API
  if (req.method === 'GET' && pathname === '/api/supplier-payments') {
    try {
      const data = await readSupplierPayments();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/supplier-payments') {
    try {
      const saved = await saveSupplierPayment(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid supplier payment data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/supplier-payments/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deleteSupplierPayment(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Products API
  if (req.method === 'GET' && pathname === '/api/products') {
    try {
      const data = await readProducts();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/products') {
    try {
      const saved = await saveProduct(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid product data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/products/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deleteProduct(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/products/stock-adjust') {
    try {
      const body = await readBody(req);
      const { productId, deltaQty, reason } = body;
      if (!productId || deltaQty === undefined) {
        return sendJson(res, { error: 'productId and deltaQty are required' }, 400);
      }
      const result = await adjustStock(productId, deltaQty, reason);
      return sendJson(res, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Stock Transactions, Movements & Lots API
  if (req.method === 'GET' && (pathname === '/api/stock-transactions' || pathname === '/api/stock-movements')) {
    try {
      const database = await connectDb();
      const txs = await database.collection('StockTransactions').find({}).sort({ created: -1 }).toArray();
      return sendJson(res, txs);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET' && pathname === '/api/lots') {
    try {
      const database = await connectDb();
      const lots = await database.collection('Lots').find({}).sort({ created: -1 }).toArray();
      return sendJson(res, lots);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Purchases API
  if (req.method === 'GET' && pathname === '/api/purchases') {
    try {
      const data = await readPurchases();
      return sendJson(res, data);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/purchases') {
    try {
      const saved = await savePurchase(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid purchase data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/purchases/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      await deletePurchase(id);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Static files fallback
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

initDb();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Billify Unified Server is running at http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  connectDb,
  readDb,
  writeDb,
  saveInvoice,
  deleteInvoice,
  readParties,
  saveParty,
  deleteParty,
  readPayments,
  savePayment,
  deletePayment,
  readSupplierPayments,
  saveSupplierPayment,
  deleteSupplierPayment,
  readProducts,
  saveProduct,
  deleteProduct,
  adjustStock,
  readPurchases,
  savePurchase,
  deletePurchase,
};
