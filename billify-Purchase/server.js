const fs = require('fs');
const http = require('http');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
const PORT = process.env.PORT || 7777;

loadLocalEnv();

const DB_TYPE = process.env.DB_TYPE || (process.env.MONGODB_URI ? 'mongodb' : 'local');
const useLocalStorage = DB_TYPE === 'local';

let client = null;
let db = null;

if (!useLocalStorage) {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!MONGO_URI) {
    console.error('ERROR: MONGODB_URI or MONGODB_URL environment variable is not set. Exiting.');
    process.exit(1);
  }
  client = new MongoClient(MONGO_URI);
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
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) || defaultVal;
  } catch (err) {
    console.error(`Error reading file ${filename}:`, err);
    return defaultVal;
  }
}

function writeJsonFile(filename, data) {
  const filePath = path.join(dbFolder, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing file ${filename}:`, err);
  }
}

function matchItem(item, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const key in query) {
    const val = query[key];
    if (val && typeof val === 'object') {
      if ('$gt' in val) {
        if (!(item[key] > val.$gt)) return false;
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

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
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
      writeJsonFile(col.file, docs);
    }
    console.log('Sync completed successfully.');
  } catch (err) {
    console.error('Failed to sync MongoDB Atlas to local JSON files:', err);
  }
}

async function connectDb() {
  if (useLocalStorage) {
    return localDbWrapper;
  }
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
  return hybridDbWrapper(db);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function initDb() {
  if (useLocalStorage) {
    console.log('Running in Local JSON File Storage mode.');
    return;
  }
  connectDb().then(async () => {
    await syncMongoToLocal();
  }).catch(err => {
    console.error('Failed to connect to database in initDb:', err);
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
    lines: Array.isArray(data.lines) ? data.lines : [],
    subtotal: Number(data.subtotal) || 0,
    total: Number(data.total) || 0,
    stockUpdated: data.stockUpdated === true,
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
  const products = await database.collection('Products').find({}).sort({ name: 1 }).toArray();
  const lots = await database.collection('Lots').find({ qty: { $gt: 0 } }).toArray();
  products.forEach(p => {
    const pLots = lots.filter(l => l.productId === p.id);
    p.stock = pLots.reduce((s, l) => s + (l.qty || 0), 0);
  });
  return products;
}

async function saveProduct(data) {
  const product = normalizeProduct(data);
  if (!product.name) return { error: 'Product name is required' };
  const database = await connectDb();

  const lotsCol = database.collection('Lots');
  const activeLots = await lotsCol.find({ productId: product.id, qty: { $gt: 0 } }).toArray();
  const currentStockSum = activeLots.reduce((s, l) => s + (l.qty || 0), 0);

  await database.collection('Products').replaceOne(
    { id: product.id },
    product,
    { upsert: true }
  );

  if (Number(data.stock || 0) !== currentStockSum) {
    const diff = Number(data.stock || 0) - currentStockSum;
    if (diff !== 0) {
      await adjustStock(product.id, diff, 'Opening Stock', 'ADJUSTMENT', product.purchasePrice);
    }
  }

  product.stock = Number(data.stock || 0);
  return product;
}

async function deleteProduct(id) {
  const database = await connectDb();
  await database.collection('Products').deleteOne({ id: Number(id) });
  await database.collection('Lots').deleteMany({ productId: Number(id) });
}

async function adjustStock(productId, qty, reason, txType, rate = null) {
  const database = await connectDb();
  const productsCol = database.collection('Products');
  const product = await productsCol.findOne({ id: Number(productId) });
  if (!product) return { error: 'Product not found' };

  const lotsCol = database.collection('Lots');
  const txCol = database.collection('StockTransactions');
  const now = Date.now();

  const activeLotsBefore = await lotsCol.find({ productId: Number(productId), qty: { $gt: 0 } }).toArray();
  const prevStockTotal = activeLotsBefore.reduce((s, l) => s + (l.qty || 0), 0);

  if (Number(qty) > 0) {
    // 1. Positive adjustment / Purchase: Create a new lot
    const lot = {
      id: now + Math.random(),
      productId: Number(productId),
      productName: product.name,
      purchaseNo: reason || 'Manual Adjustment',
      purchasePrice: typeof rate === 'number' ? rate : (product.purchasePrice || 0),
      originalQty: Number(qty),
      qty: Number(qty),
      unit: product.unit || 'pcs',
      created: now
    };
    await lotsCol.insertOne(lot);

    const newStockTotal = prevStockTotal + Number(qty);
    await txCol.insertOne({
      id: now + Math.random(),
      productId: Number(productId),
      productName: product.name,
      txType: txType || 'PURCHASE',
      qty: Number(qty),
      prevStock: prevStockTotal,
      newStock: newStockTotal,
      reason: reason || '',
      created: now,
    });
  } else if (Number(qty) < 0) {
    // 2. Negative adjustment / Sale: Deduct using FIFO
    let remainingToDeduct = Math.abs(Number(qty));
    const activeLots = await lotsCol.find({ productId: Number(productId), qty: { $gt: 0 } }).sort({ created: 1 }).toArray();

    for (const lot of activeLots) {
      if (remainingToDeduct <= 0) break;
      const deductFromThisLot = Math.min(lot.qty, remainingToDeduct);
      const newLotQty = lot.qty - deductFromThisLot;

      await lotsCol.updateOne({ id: lot.id }, { $set: { qty: newLotQty } });

      await txCol.insertOne({
        id: now + Math.random(),
        productId: Number(productId),
        productName: product.name,
        txType: txType || 'SALE',
        qty: -deductFromThisLot,
        prevStock: lot.qty,
        newStock: newLotQty,
        reason: `${reason} (Lot: ${lot.purchaseNo})`,
        created: now,
      });

      remainingToDeduct -= deductFromThisLot;
    }

    if (remainingToDeduct > 0) {
      const negativeLot = {
        id: now + Math.random(),
        productId: Number(productId),
        productName: product.name,
        purchaseNo: 'Oversold Stock',
        purchasePrice: product.purchasePrice || 0,
        originalQty: -remainingToDeduct,
        qty: -remainingToDeduct,
        unit: product.unit || 'pcs',
        created: now
      };
      await lotsCol.insertOne(negativeLot);

      await txCol.insertOne({
        id: now + Math.random(),
        productId: Number(productId),
        productName: product.name,
        txType: txType || 'SALE',
        qty: -remainingToDeduct,
        prevStock: 0,
        newStock: -remainingToDeduct,
        reason: `${reason} (Oversold)`,
        created: now,
      });
    }
  }

  const activeLotsAfter = await lotsCol.find({ productId: Number(productId), qty: { $gt: 0 } }).toArray();
  const finalStockTotal = activeLotsAfter.reduce((s, l) => s + (l.qty || 0), 0);
  return { ...product, stock: finalStockTotal };
}

// ── Purchase Bills ────────────────────────────────────────────────────────────

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
    adjustments: Array.isArray(data.adjustments) ? data.adjustments : [],
    notes: data.notes || '',
    phone: data.phone || '',
    status: data.status || 'draft',
    amountPaid: Number(data.amountPaid) || 0,
    lines: Array.isArray(data.lines) ? data.lines : [],
    boxes: Array.isArray(data.boxes) ? data.boxes : [],
    subtotal: Number(data.subtotal) || 0,
    total: Number(data.total) || 0,
    stockUpdated: data.stockUpdated === true,
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
  let wasStockUpdated = purchase.stockUpdated;

  // Check if there's an existing record to know if stock was already applied
  const existing = await database.collection('Purchases').findOne({ id: purchase.id });

  if (existing && existing.stockUpdated) {
    // Revert the old stock:
    const oldBillNo = existing.billNo;
    const regex = new RegExp(`^Purchase Bill:\\s*${oldBillNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\(|$)`, 'i');
    await database.collection('Lots').deleteMany({ purchaseNo: { $regex: regex } });
    await database.collection('StockTransactions').deleteMany({ reason: { $regex: regex } });

    // Mark as false so that the stock will be re-applied or left unupdated if status changed
    wasStockUpdated = false;
    existing.stockUpdated = false;
    purchase.stockUpdated = false;
  }

  await database.collection('Purchases').replaceOne(
    { id: purchase.id },
    purchase,
    { upsert: true }
  );

  // Auto-increase stock when a purchase is marked as 'received' for the first time
  if (
    purchase.status === 'received' &&
    !wasStockUpdated &&
    !(existing && existing.stockUpdated)
  ) {
    // Helper: find or auto-create a product by name, returning its id
    async function resolveProductId(name, unit, rate) {
      if (!name || !name.trim()) return null;
      const cleanName = name.trim();
      const productsCol = database.collection('Products');
      const existing = await productsCol.findOne({
        name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });
      if (existing) return existing.id;
      // Auto-create
      const now = Date.now();
      const newProduct = {
        id: now,
        name: cleanName,
        sku: '',
        unit: unit || 'pcs',
        purchasePrice: parseFloat(rate) || 0,
        sellingPrice: 0,
        stock: 0,
        lowStockAlert: 0,
        notes: `Auto-created via Purchase Bill: ${purchase.billNo}`,
        created: now,
        updated: now,
      };
      await productsCol.insertOne(newProduct);
      console.log(`Auto-created product: "${cleanName}" (id: ${now})`);
      return now;
    }

    if (Array.isArray(purchase.boxes) && purchase.boxes.length > 0) {
      for (const box of purchase.boxes) {
        if (Array.isArray(box.items)) {
          for (const item of box.items) {
            if (!item.qty || item.qty <= 0) continue;
            // Auto-resolve productId if missing but desc is provided
            if (!item.productId && item.desc) {
              item.productId = await resolveProductId(item.desc, item.unit, item.rate);
            }
            if (item.productId) {
              await adjustStock(
                item.productId,
                item.qty,
                `Purchase Bill: ${purchase.billNo}${box.note ? ` (${box.note})` : ''}`,
                'PURCHASE',
                item.rate
              );
            }
          }
        }
      }
    } else {
      for (const line of purchase.lines) {
        if (!line.qty || line.qty <= 0) continue;
        if (!line.productId && line.desc) {
          line.productId = await resolveProductId(line.desc, line.unit, line.rate);
        }
        if (line.productId) {
          await adjustStock(
            line.productId,
            line.qty,
            `Purchase Bill: ${purchase.billNo}`,
            'PURCHASE',
            line.rate
          );
        }
      }
    }
    // Persist updated productIds back (boxes may have been mutated)
    await database.collection('Purchases').replaceOne(
      { id: purchase.id },
      { ...purchase, boxes: purchase.boxes, lines: purchase.lines },
      { upsert: true }
    );
    // Mark stock as updated so it doesn't run twice
    await database.collection('Purchases').updateOne(
      { id: purchase.id },
      { $set: { stockUpdated: true } }
    );
    purchase.stockUpdated = true;
  }

  return purchase;
}

async function deletePurchase(id) {
  const database = await connectDb();
  const purchase = await database.collection('Purchases').findOne({ id: Number(id) });
  if (purchase) {
    if (purchase.stockUpdated) {
      const billNo = purchase.billNo;
      // Match "Purchase Bill: <billNo>" or "Purchase Bill: <billNo> (some note)"
      const regex = new RegExp(`^Purchase Bill:\\s*${billNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\(|$)`, 'i');
      await database.collection('Lots').deleteMany({ purchaseNo: { $regex: regex } });
      await database.collection('StockTransactions').deleteMany({ reason: { $regex: regex } });
    }
    await database.collection('Purchases').deleteOne({ id: Number(id) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Deduct stock when invoice is first marked paid / partially_paid
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

  return invoice;
}

async function readParties() {
  const database = await connectDb();
  return await database.collection('Parties').find({}).sort({ name: 1 }).toArray();
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

// ── Payments (Collections) ───────────────────────────────────────────────────

function normalizePayment(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    party: String(data.party || '').trim(),
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

async function readPayments() {
  const database = await connectDb();
  return await database.collection('Payments').find({}).sort({ created: -1 }).toArray();
}

async function savePayment(data) {
  const payment = normalizePayment(data);
  if (!payment.party) return { error: 'Party (Customer) name is required' };
  if (payment.amount <= 0) return { error: 'Payment amount must be greater than 0' };

  const database = await connectDb();
  const paymentsCol = database.collection('Payments');
  await paymentsCol.replaceOne(
    { id: payment.id },
    payment,
    { upsert: true }
  );
  return payment;
}

async function deletePayment(id) {
  const database = await connectDb();
  await database.collection('Payments').deleteOne({ id: Number(id) });
}

// ── Supplier Payments (Payments) ──────────────────────────────────────────────

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
  console.log(`[HTTP] ${req.method} ${req.url}`);
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = parsedUrl;
  const params = parsedUrl.searchParams;

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

  if (req.method === 'GET' && pathname === '/api/parties') {
    try {
      const data = await readParties();
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

  if (req.method === 'POST' && pathname === '/api/parties') {
    try {
      const saved = await saveParty(await readBody(req));
      return saved.error ? sendJson(res, saved, 400) : sendJson(res, saved);
    } catch (err) {
      return sendJson(res, { error: err.message || 'Invalid party data' }, 400);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/invoices/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      const database = await connectDb();
      await database.collection('Invoices').deleteOne({ id: id });
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/parties/')) {
    try {
      const id = Number(decodeURIComponent(pathname.split('/').pop()));
      const cleanBills = params.get('cleanBills') === 'true';
      const cleanPayments = params.get('cleanPayments') === 'true';
      await deleteParty(id, cleanBills, cleanPayments);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Customer Payments (Collections) ─────────────────────────────────────────
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

  // ── Supplier Payments (Payments) ────────────────────────────────────────────
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


  // ── Products ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/products') {
    try {
      return sendJson(res, await readProducts());
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'GET' && pathname === '/api/lots') {
    try {
      const database = await connectDb();
      const lots = await database.collection('Lots').find({ qty: { $gt: 0 } }).sort({ created: -1 }).toArray();
      return sendJson(res, lots);
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
      const { productId, qty, reason } = await readBody(req);
      const result = await adjustStock(productId, qty, reason, 'ADJUSTMENT');
      return result.error ? sendJson(res, result, 400) : sendJson(res, result);
    } catch (err) {
      return sendJson(res, { error: err.message }, 400);
    }
  }

  // ── Stock Transactions (Audit Trail) ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stock-transactions') {
    try {
      const database = await connectDb();
      const q = {};
      if (params.get('productId')) q.productId = Number(params.get('productId'));
      if (params.get('txType')) q.txType = params.get('txType');
      const transactions = await database.collection('StockTransactions')
        .find(q).sort({ created: -1 }).limit(1000).toArray();
      return sendJson(res, transactions);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Stock Movements (legacy, kept for compatibility) ──────────────────────
  if (req.method === 'GET' && pathname === '/api/stock-movements') {
    try {
      const database = await connectDb();
      const movements = await database.collection('StockTransactions')
        .find({}).sort({ created: -1 }).limit(500).toArray();
      return sendJson(res, movements);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Purchases ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/purchases') {
    try {
      return sendJson(res, await readPurchases());
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

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(405);
  res.end('Method not allowed');
});

initDb();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BillForge is running at http://0.0.0.0:${PORT}`);
  });
}

module.exports = {
  initDb,
  connectDb,
  readDb,
  writeDb,
  readParties,
  saveParty,
  deleteParty,
  saveInvoice,
  readProducts,
  saveProduct,
  deleteProduct,
  adjustStock,
  readPurchases,
  savePurchase,
  deletePurchase,
  readPayments,
  savePayment,
  deletePayment,
  readSupplierPayments,
  saveSupplierPayment,
  deleteSupplierPayment,
  server,
};
