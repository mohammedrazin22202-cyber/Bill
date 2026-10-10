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
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.slice(1);
    }
    raw = raw.trim();
    return raw ? JSON.parse(raw) : defaultVal;
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

function getDefaultSettings() {
  return {
    companyName: 'Al Haseena Exports',
    harborLocation: 'Kasimedu Fishing Harbor, Chennai - Gate 2',
    proprietorName: 'M S Bhathrudeen',
    contactPhone: '+91 9841021203',
    contactEmail: 'alhaseenaexports@gmail.com',
    mandiLicenseNo: 'TN-CHE-KSM-2024-88',
    gstin: '33AABCA1234F1Z5',
    tagline: 'Wholesale Fish Commission Agent & Consignment Exporter',
    defaultCommission: 5,
    commissionMode: 'percent',
    trackBrokingProfit: true,
    autoCarryForward: true,
    deductLorryBhada: true,
    deductIce: true,
    deductCoolie: true,
    deductStorage: false,
    defaultCreditDays: 7,
    defaultCreditLimit: 50000,
    enableOverdueBlinking: true,
    strictCreditLock: false,
    enableBadDebtProtection: true,
    invoicePrefix: 'ALH-',
    hideDealerOnBuyerInvoice: true,
    printFormat: 'a4',
    whatsappTemplate: 'Al Haseena Exports: Bill #{billNo} for Rs.{amount} ({crates} crates {fish}). Balance: Rs.{balance}. Thank you!',
    enableHourlyQuotes: true,
    quoteRotationFrequency: 'hourly',
    quoteManualCycle: true,
    soundAlerts: true,
    settingsPin: '8181',
    openingCashInHand: 0
  };
}

function matchItem(item, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const key in query) {
    const val = query[key];
    if (key === '$or' && Array.isArray(val)) {
      if (!val.some(subQ => matchItem(item, subQ))) return false;
      continue;
    }
    if (val instanceof RegExp) {
      if (!val.test(String(item[key] || ''))) return false;
      continue;
    }
    if (val && typeof val === 'object' && !(val instanceof RegExp)) {
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
    let filename = `${collectionName.toLowerCase()}.json`;

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

// ─────────────────────────────────────────────────────────────────────────────
// DATA MODELS & NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function normalizeContact(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    name: String(data.name || '').trim(),
    phone: String(data.phone || '').trim(),
    address: String(data.address || '').trim(),
    notes: String(data.notes || '').trim(),
    isDealer: data.isDealer !== undefined ? !!data.isDealer : true,
    isBuyer: data.isBuyer !== undefined ? !!data.isBuyer : false,
    defaultCommissionType: data.defaultCommissionType || 'percent', // 'percent' or 'flat_per_crate'
    defaultCommissionVal: Number(data.defaultCommissionVal) || 5, // e.g. 5% or 50/crate
    creditLimit: Number(data.creditLimit) || 0,
    creditPeriod: Number(data.creditPeriod) || 0, // days allowed
    bypassCreditCheck: !!data.bypassCreditCheck,
    isBadDebtDefaulter: !!data.isBadDebtDefaulter,
    badDebtReason: String(data.badDebtReason || ''),
    created: Number(data.created) || now,
    updated: now
  };
}

function normalizeConsignment(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    consignmentNo: String(data.consignmentNo || `INW-${now}`).trim(),
    date: data.date || new Date().toISOString().split('T')[0],
    dealerId: Number(data.dealerId) || 0,
    dealerName: String(data.dealerName || '').trim(),
    vehicleNo: String(data.vehicleNo || '').trim(),
    driverPhone: String(data.driverPhone || '').trim(),
    // Lorry Bhada (Advance freight paid to driver upon arrival)
    lorryBhada: Number(data.lorryBhada) || 0,
    lorryBhadaMode: data.lorryBhadaMode || 'Cash', // 'Cash', 'Bank', 'UPI'
    lorryBhadaNotes: String(data.lorryBhadaNotes || ''),
    items: Array.isArray(data.items)
      ? data.items.map((it, idx) => ({
          id: Number(it.id) || idx + 1,
          variety: String(it.variety || '').trim(),
          crates: Number(it.crates) || 0,
          weightKg: Number(it.weightKg) || 0,
          unsoldCrates: Number(it.unsoldCrates !== undefined ? it.unsoldCrates : it.crates) || 0,
          unsoldWeightKg: Number(it.unsoldWeightKg !== undefined ? it.unsoldWeightKg : it.weightKg) || 0,
          rateExpectation: Number(it.rateExpectation) || 0,
          notes: String(it.notes || '')
        }))
      : [],
    status: data.status || 'Active', // 'Active', 'Settled'
    notes: String(data.notes || ''),
    created: Number(data.created) || now,
    updated: now
  };
}

function normalizeSale(data) {
  const now = Date.now();
  const subtotal = Number(data.subtotal) || 0;
  const discount = Number(data.discount) || 0;
  const total = Number(data.total) !== undefined ? Number(data.total) : Math.max(0, subtotal - discount);
  const prevBal = Number(data.previousBalance) || 0;
  const totalDue = Number(data.totalBalanceDue) !== undefined ? Number(data.totalBalanceDue) : (total + prevBal);
  const paid = Number(data.amountPaid) || 0;
  const closingBal = Number(data.closingBalance) !== undefined ? Number(data.closingBalance) : (totalDue - paid);

  let totalBoxes = Number(data.totalBoxes) || 0;
  const lines = Array.isArray(data.lines)
    ? data.lines.map((l, idx) => {
        const crates = Number(l.crates) || 0;
        const kgPerCrate = Number(l.kgPerCrate) || 0;
        let qty = Number(l.qty) || 0;
        if (crates > 0 && kgPerCrate > 0 && (!qty || qty === crates)) {
          qty = crates * kgPerCrate;
        }
        const rate = Number(l.rate) || 0;
        const amount = Number(l.amount) !== undefined ? Number(l.amount) : (crates > 0 ? crates * rate : (qty > 0 ? qty * rate : 0));
        return {
          id: Number(l.id) || idx + 1,
          consignmentId: Number(l.consignmentId) || null,
          consignmentNo: String(l.consignmentNo || ''),
          dealerId: Number(l.dealerId) || null,
          dealerName: String(l.dealerName || ''),
          variety: String(l.variety || '').trim(),
          unit: (l.unit === 'Crate' || l.unit === 'Box') ? l.unit : (kgPerCrate > 0 ? 'Kg' : 'Box'),
          crates,
          kgPerCrate,
          qty: qty || crates,
          rate,
          amount
        };
      })
    : [];

  if (!totalBoxes && lines.length > 0) {
    totalBoxes = lines.reduce((sum, l) => sum + (Number(l.crates) || ((l.unit === 'Crate' || l.unit === 'Box') ? Number(l.qty) : 0)), 0);
  }

  return {
    id: Number(data.id) || now,
    billNo: String(data.billNo || `SAL-${now}`).trim(),
    date: data.date || new Date().toISOString().split('T')[0],
    time: data.time || new Date().toLocaleTimeString('en-US', { hour12: false }),
    buyerId: Number(data.buyerId) || 0,
    buyerName: String(data.buyerName || '').trim(),
    buyerPhone: String(data.buyerPhone || '').trim(),
    paymentType: data.paymentType === 'Credit' ? 'Credit' : 'Cash',
    paymentMode: data.paymentMode || 'Cash', // 'Cash', 'UPI', 'Bank'
    totalBoxes,
    lines,
    subtotal,
    discount,
    total,
    previousBalance: prevBal,
    totalBalanceDue: totalDue,
    amountPaid: paid,
    closingBalance: closingBal,
    notes: String(data.notes || ''),
    isBadDebt: !!data.isBadDebt,
    created: Number(data.created) || now,
    updated: now
  };
}

function normalizeSettlement(data) {
  const now = Date.now();
  const gross = Number(data.totalReportedGross) || 0;
  const totalExp = Number(data.totalExpenses) || 0;
  const commAmt = Number(data.commissionAmount) || 0;
  const adj = Number(data.adjustments) || 0;
  const netProceed = Math.max(0, gross - totalExp - commAmt + adj);
  const prevBal = Number(data.previousBalance) || 0;
  const totalBal = Number(data.totalBalanceDue) !== undefined ? Number(data.totalBalanceDue) : (netProceed + prevBal);
  const cashPaid = Number(data.cashPaidToday) || 0;
  const closingBal = Number(data.closingBalance) !== undefined ? Number(data.closingBalance) : (totalBal - cashPaid);

  const items = Array.isArray(data.items)
    ? data.items.map((it, idx) => ({
        id: Number(it.id) || idx + 1,
        consignmentId: Number(it.consignmentId) || null,
        consignmentNo: String(it.consignmentNo || ''),
        variety: String(it.variety || ''),
        unit: it.unit || 'Crate',
        qtySold: Number(it.qtySold) || 0,
        realizedRevenue: Number(it.realizedRevenue) || 0,
        systemAvgRate: Number(it.systemAvgRate) || 0,
        reportedRate: Number(it.reportedRate !== undefined ? it.reportedRate : it.systemAvgRate) || 0,
        reportedGross: Number(it.reportedGross) !== undefined ? Number(it.reportedGross) : (Number(it.qtySold) || 0) * (Number(it.reportedRate) || 0),
        brokingProfit: Number(it.brokingProfit) !== undefined ? Number(it.brokingProfit) : ((Number(it.realizedRevenue) || 0) - (Number(it.reportedGross) || 0))
      }))
    : [];

  const totalQtySold = Number(data.totalQtySold) || items.reduce((s, it) => s + (it.qtySold || 0), 0);
  const avgRate = Number(data.averageRate) || (totalQtySold > 0 ? Math.round(gross / totalQtySold) : 0);

  return {
    id: Number(data.id) || now,
    settlementNo: String(data.settlementNo || `SET-${now}`).trim(),
    date: data.date || new Date().toISOString().split('T')[0],
    dealerId: Number(data.dealerId) || 0,
    dealerName: String(data.dealerName || '').trim(),
    arrivalCrates: Number(data.arrivalCrates) || 0,
    items,
    totalQtySold,
    totalRealizedRevenue: Number(data.totalRealizedRevenue) || 0,
    totalReportedGross: gross,
    totalBrokingProfit: Number(data.totalBrokingProfit) || 0,
    averageRate: avgRate,
    
    // Dynamic line-item expenses (Transport, Ice, Coolie, Storage, Lorry Bhada, etc.)
    expenses: Array.isArray(data.expenses)
      ? data.expenses.map((e, idx) => ({
          id: Number(e.id) || idx + 1,
          name: String(e.name || '').trim(),
          amount: Number(e.amount) || 0
        }))
      : [],
    totalExpenses: totalExp,

    // Commission structure
    commissionType: data.commissionType || 'percent', // 'percent' or 'flat_per_crate' or 'fixed'
    commissionRate: Number(data.commissionRate) || 5,
    commissionAmount: commAmt,

    // Adjustments (+ / -) e.g. + 1170
    adjustments: adj,

    // Consignment Net Proceed
    netConsignmentAmount: netProceed,
    netPayableToDealer: netProceed,

    // Continuous Ledger Details
    previousBalance: prevBal,
    totalBalanceDue: totalBal,
    cashPaidToday: cashPaid,
    cashPaidPayee: String(data.cashPaidPayee || '').trim(), // e.g. 'Cash Paid to DRL (Driver) / Me / JoJo'
    closingBalance: closingBal,

    unsoldCratesCarriedForward: Number(data.unsoldCratesCarriedForward) || 0,
    notes: String(data.notes || ''),
    created: Number(data.created) || now,
    updated: now
  };
}

function normalizePayment(data) {
  const now = Date.now();
  return {
    id: Number(data.id) || now,
    paymentNo: String(data.paymentNo || `PAY-${now}`).trim(),
    date: data.date || new Date().toISOString().split('T')[0],
    contactId: Number(data.contactId) || 0,
    contactName: String(data.contactName || '').trim(),
    // 'DEALER_PAYMENT' (we pay dealer), 'BUYER_COLLECTION' (buyer pays us), 'CONTRA_ADJUSTMENT' (offsetting dual-role balances)
    type: data.type || 'DEALER_PAYMENT',
    amount: Number(data.amount) || 0,
    // Settlement discount / Kasar (e.g. paying 100k, reducing balance by 8,250 -> 250 discount)
    settlementDiscount: Number(data.settlementDiscount) || 0,
    paymentMode: data.paymentMode || 'Cash', // 'Cash', 'Bank Transfer', 'UPI', 'Cheque'
    referenceNo: String(data.referenceNo || '').trim(), // Cheque No, UTR, Txn ID
    bankName: String(data.bankName || '').trim(),
    bankAccountId: Number(data.bankAccountId) || null,
    paymentDate: data.paymentDate || data.date || '',
    notes: String(data.notes || ''),
    created: Number(data.created) || now,
    updated: now
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE RECOMPUTATION & DUAL-ROLE LEDGER LOGIC
// ─────────────────────────────────────────────────────────────────────────────

async function getContactFinancials(contactId) {
  const database = await connectDb();
  const cId = Number(contactId);

  // 1. Dealer Payable: Generated from Dealer Settlements (Patiya)
  const settlements = await database.collection('settlements').find({ dealerId: cId }).toArray();
  const totalSettlementCredited = settlements.reduce((sum, s) => sum + (Number(s.netPayableToDealer) || 0), 0);

  // 2. Buyer Receivable: Generated from Sales where this contact bought items
  const contact = await database.collection('contacts').findOne({ id: cId });
  const sales = await database.collection('sales').find({
    $or: [
      { buyerId: cId },
      { buyerName: new RegExp(`^${(contact?.name || '').trim()}$`, 'i') }
    ]
  }).toArray();

  const totalPurchasedGoods = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const totalImmediateCashPaid = sales.reduce((sum, s) => {
    return sum + (s.paymentType === 'Cash' ? (Number(s.total) || 0) : (Number(s.amountPaid) || 0));
  }, 0);
  const totalBadDebtLoss = sales.reduce((sum, s) => {
    if (s.isBadDebt) return sum + (Number(s.total) || 0);
    return sum;
  }, 0);

  // 3. Payments made to dealer
  const payments = await database.collection('payments').find({ contactId: cId }).toArray();
  
  let totalPaidToDealer = 0;
  let totalDealerDiscounts = 0;
  let totalCollectedFromBuyer = 0;
  let totalContraAdjustments = 0;

  for (const p of payments) {
    const amt = Number(p.amount) || 0;
    const disc = Number(p.settlementDiscount) || 0;
    if (p.type === 'DEALER_PAYMENT') {
      totalPaidToDealer += amt;
      totalDealerDiscounts += disc;
    } else if (p.type === 'BUYER_COLLECTION') {
      totalCollectedFromBuyer += amt;
    } else if (p.type === 'CONTRA_ADJUSTMENT') {
      totalContraAdjustments += amt;
    }
  }

  // Dealer Balance: What we owe them
  const payableBalance = Math.max(0, totalSettlementCredited - totalPaidToDealer - totalDealerDiscounts - totalContraAdjustments);

  // Buyer Balance: What they owe us (active receivable excluding written off bad debt)
  const rawReceivable = Math.max(0, totalPurchasedGoods - totalImmediateCashPaid - totalCollectedFromBuyer - totalContraAdjustments);
  const receivableBalance = Math.max(0, rawReceivable - totalBadDebtLoss);

  // Net Balance: (+ve means we owe them, -ve means they owe us)
  const netBalance = payableBalance - receivableBalance;

  // Check Overdue Status
  const creditPeriod = Number(contact?.creditPeriod) || 0;
  let isOverdue = false;
  let daysOverdue = 0;

  if (receivableBalance > 0 && creditPeriod > 0) {
    const unpaidCreditSales = sales.filter(s => s.paymentType === 'Credit' && !s.isBadDebt);
    const now = Date.now();
    for (const s of unpaidCreditSales) {
      const saleDate = new Date(s.date).getTime();
      const elapsedDays = Math.floor((now - saleDate) / (1000 * 60 * 60 * 24));
      if (elapsedDays > creditPeriod) {
        isOverdue = true;
        daysOverdue = Math.max(daysOverdue, elapsedDays - creditPeriod);
      }
    }
  }

  return {
    payableBalance,
    receivableBalance,
    rawReceivable,
    badDebtAmount: totalBadDebtLoss,
    isBadDebtDefaulter: !!contact?.isBadDebtDefaulter,
    badDebtReason: contact?.badDebtReason || '',
    netBalance,
    isOverdue: isOverdue && !contact?.isBadDebtDefaulter,
    daysOverdue,
    totalSettlementCredited,
    totalPurchasedGoods,
    totalPaidToDealer,
    totalCollectedFromBuyer,
    totalContraAdjustments
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY & STOCK TRACKING
// ─────────────────────────────────────────────────────────────────────────────

async function getLiveStockSummary() {
  const database = await connectDb();
  const consignments = await database.collection('consignments').find({}).toArray();

  const productMap = {}; // varietyName -> { totalCrates, totalKg, byDealer: { [dealerName]: { crates, kg, percentOfWeight, percentOfCrates, consignmentNo, date } } }

  for (const c of consignments) {
    for (const it of (c.items || [])) {
      const uCrates = Number(it.unsoldCrates) || 0;
      let uKg = Number(it.unsoldWeightKg) || 0;
      if (uCrates <= 0) {
        uKg = 0;
      }

      // Do not include if crates are sold (0 crates and 0 kg)
      if (uCrates <= 0 && uKg <= 0) {
        continue;
      }

      const v = it.variety || 'General';

      if (!productMap[v]) {
        productMap[v] = {
          variety: v,
          totalCrates: 0,
          totalKg: 0,
          byDealer: {}
        };
      }

      productMap[v].totalCrates += uCrates;
      productMap[v].totalKg += uKg;

      const dName = c.dealerName || 'Unknown Dealer';
      if (!productMap[v].byDealer[dName]) {
        productMap[v].byDealer[dName] = {
          dealerId: c.dealerId,
          crates: 0,
          kg: 0,
          consignmentNo: c.consignmentNo || ('#' + c.id),
          date: c.date || '',
          vehicleNo: c.vehicleNo || ''
        };
      }
      productMap[v].byDealer[dName].crates += uCrates;
      productMap[v].byDealer[dName].kg += uKg;
    }
  }

  // Filter out any varieties with 0 live stock
  const activeStock = Object.values(productMap).filter(p => p.totalCrates > 0 || p.totalKg > 0);

  // Compute contribution percentages and ensure zero-crate dealers are excluded
  for (const p of activeStock) {
    const liveDealers = {};
    for (const [name, d] of Object.entries(p.byDealer)) {
      if (d.crates > 0 || d.kg > 0) {
        d.percentOfWeight = p.totalKg > 0 ? Number(((d.kg / p.totalKg) * 100).toFixed(1)) : 0;
        d.percentOfCrates = p.totalCrates > 0 ? Number(((d.crates / p.totalCrates) * 100).toFixed(1)) : 0;
        liveDealers[name] = d;
      }
    }
    p.byDealer = liveDealers;
  }

  return activeStock.filter(p => Object.keys(p.byDealer).length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// DAYBOOK & CASH/BANK BOOK
// ─────────────────────────────────────────────────────────────────────────────

async function getDaybook(dateStr) {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const database = await connectDb();

  const entries = [];

  // 1. Inward Lorry Bhada (Cash Out)
  const consignments = await database.collection('consignments').find({ date: targetDate }).toArray();
  for (const c of consignments) {
    if (Number(c.lorryBhada) > 0) {
      entries.push({
        id: `LB-${c.id}`,
        time: 'Morning',
        type: 'LORRY_BHADA',
        category: 'Cash Out',
        description: `Lorry Bhada to driver (${c.vehicleNo}) - Dealer: ${c.dealerName}`,
        mode: c.lorryBhadaMode || 'Cash',
        inflow: 0,
        outflow: Number(c.lorryBhada)
      });
    }
  }

  // 2. Daily Sales (Cash In for cash sales)
  const sales = await database.collection('sales').find({ date: targetDate }).toArray();
  for (const s of sales) {
    if (s.paymentType === 'Cash' || Number(s.amountPaid) > 0) {
      const amt = s.paymentType === 'Cash' ? Number(s.total) : Number(s.amountPaid);
      entries.push({
        id: `SALE-${s.id}`,
        time: s.time || '06:00',
        type: 'SALE_COLLECTION',
        category: 'Cash In',
        description: `Cash Sale Bill #${s.billNo} - Buyer: ${s.buyerName}`,
        mode: s.paymentMode || 'Cash',
        inflow: amt,
        outflow: 0
      });
    }
  }

  // 3. Payments and Collections
  const payments = await database.collection('payments').find({ date: targetDate }).toArray();
  for (const p of payments) {
    if (p.type === 'DEALER_PAYMENT') {
      entries.push({
        id: `PAY-${p.id}`,
        time: 'Settlement',
        type: 'DEALER_PAYMENT',
        category: 'Cash Out',
        description: `Payment to Dealer: ${p.contactName} (${p.paymentMode})`,
        mode: p.paymentMode,
        inflow: 0,
        outflow: Number(p.amount)
      });
    } else if (p.type === 'BUYER_COLLECTION') {
      entries.push({
        id: `COL-${p.id}`,
        time: 'Collection',
        type: 'BUYER_COLLECTION',
        category: 'Cash In',
        description: `Payment Collection from Buyer: ${p.contactName} (${p.paymentMode})`,
        mode: p.paymentMode,
        inflow: Number(p.amount),
        outflow: 0
      });
    }
  }

  // 4. Custom manual daybook entries
  const manualEntries = await database.collection('daybook').find({ date: targetDate }).toArray();
  for (const m of manualEntries) {
    entries.push(m);
  }

  // Calculate totals
  let totalCashIn = 0;
  let totalCashOut = 0;
  let totalBankIn = 0;
  let totalBankOut = 0;

  for (const e of entries) {
    const isCash = String(e.mode || '').toLowerCase() === 'cash';
    if (isCash) {
      totalCashIn += Number(e.inflow) || 0;
      totalCashOut += Number(e.outflow) || 0;
    } else {
      totalBankIn += Number(e.inflow) || 0;
      totalBankOut += Number(e.outflow) || 0;
    }
  }

  return {
    date: targetDate,
    entries,
    summary: {
      cashIn: totalCashIn,
      cashOut: totalCashOut,
      netCashChange: totalCashIn - totalCashOut,
      bankIn: totalBankIn,
      bankOut: totalBankOut,
      netBankChange: totalBankIn - totalBankOut
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BANK ACCOUNTS & TREASURY CASH/BANK LEDGER
// ─────────────────────────────────────────────────────────────────────────────

function getDefaultBankAccounts() {
  return [
    {
      id: 1,
      accountName: "HDFC Kasimedu Current A/c",
      bankName: "HDFC Bank",
      accountNumber: "50200084729103",
      ifscCode: "HDFC0000124",
      accountType: "Current",
      upiId: "alhaseena@hdfcbank",
      branch: "Royapuram / Kasimedu",
      openingBalance: 250000,
      isActive: true,
      created: 1791076627149
    },
    {
      id: 2,
      accountName: "SBI Harbor Branch",
      bankName: "State Bank of India",
      accountNumber: "38920194821",
      ifscCode: "SBIN0001842",
      accountType: "Current",
      upiId: "alhaseenafoods@sbi",
      branch: "Kasimedu Harbor",
      openingBalance: 120000,
      isActive: true,
      created: 1791076627150
    }
  ];
}

async function getTreasuryOverview() {
  const database = await connectDb();
  let accounts = null;
  if (useLocalStorage) {
    accounts = readJsonFile('bank_accounts.json', null);
  } else {
    accounts = await database.collection('bank_accounts').find({}).toArray();
  }
  if (accounts === null || !Array.isArray(accounts)) {
    accounts = getDefaultBankAccounts();
    if (useLocalStorage) {
      writeJsonFile('bank_accounts.json', accounts);
    } else {
      await database.collection('bank_accounts').insertMany(accounts);
    }
  }

  const treasuryTxns = useLocalStorage ? readJsonFile('treasury_transactions.json', []) : await database.collection('treasury_transactions').find({}).toArray();
  const payments = await database.collection('payments').find({}).toArray();
  const sales = await database.collection('sales').find({}).toArray();
  const consignments = await database.collection('consignments').find({}).toArray();

  const enrichedAccounts = accounts.map(acc => {
    let balance = Number(acc.openingBalance) || 0;
    let totalIn = 0;
    let totalOut = 0;

    for (const p of payments) {
      const isThisBank = (p.bankAccountId && Number(p.bankAccountId) === Number(acc.id)) || 
                         (!p.bankAccountId && p.bankName && p.bankName.toLowerCase().includes(acc.bankName.toLowerCase()));
      if (['Bank Transfer', 'UPI', 'Cheque'].includes(p.paymentMode) && isThisBank) {
        const amt = Number(p.amount) || 0;
        if (p.type === 'BUYER_COLLECTION') {
          balance += amt;
          totalIn += amt;
        } else if (p.type === 'DEALER_PAYMENT') {
          balance -= amt;
          totalOut += amt;
        }
      }
    }

    for (const tx of treasuryTxns) {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'BANK_IN' && Number(tx.accountId) === Number(acc.id)) {
        balance += amt;
        totalIn += amt;
      } else if (tx.type === 'BANK_OUT' && Number(tx.accountId) === Number(acc.id)) {
        balance -= amt;
        totalOut += amt;
      } else if (tx.type === 'CONTRA') {
        if (Number(tx.toAccountId) === Number(acc.id)) {
          balance += amt;
          totalIn += amt;
        }
        if (Number(tx.accountId) === Number(acc.id)) {
          balance -= amt;
          totalOut += amt;
        }
      }
    }

    return {
      ...acc,
      currentBalance: balance,
      totalIn,
      totalOut
    };
  });

  const settings = (useLocalStorage ? readJsonFile('settings.json', null) : await database.collection('settings').findOne({ _id: 'app_settings' })) || getDefaultSettings();
  const openingCash = settings && settings.openingCashInHand !== undefined ? Number(settings.openingCashInHand) : 0;

  let cashInHandBalance = openingCash;
  let cashInTotal = 0;
  let cashOutTotal = 0;

  for (const s of sales) {
    if (s.paymentType === 'Cash' || (s.paymentMode === 'Cash' && Number(s.amountPaid) > 0)) {
      const amt = s.paymentType === 'Cash' ? (Number(s.total) || 0) : (Number(s.amountPaid) || 0);
      cashInHandBalance += amt;
      cashInTotal += amt;
    }
  }

  for (const p of payments) {
    if (p.paymentMode === 'Cash') {
      const amt = Number(p.amount) || 0;
      if (p.type === 'BUYER_COLLECTION') {
        cashInHandBalance += amt;
        cashInTotal += amt;
      } else if (p.type === 'DEALER_PAYMENT') {
        cashInHandBalance -= amt;
        cashOutTotal += amt;
      }
    }
  }

  for (const c of consignments) {
    if (c.lorryBhadaMode !== 'Bank' && Number(c.lorryBhada) > 0) {
      const amt = Number(c.lorryBhada) || 0;
      cashInHandBalance -= amt;
      cashOutTotal += amt;
    }
  }

  for (const tx of treasuryTxns) {
    const amt = Number(tx.amount) || 0;
    if (tx.accountId === 'cash_in_hand') {
      if (tx.type === 'CASH_IN') {
        cashInHandBalance += amt;
        cashInTotal += amt;
      } else if (tx.type === 'CASH_OUT') {
        cashInHandBalance -= amt;
        cashOutTotal += amt;
      } else if (tx.type === 'CONTRA') {
        cashInHandBalance -= amt;
        cashOutTotal += amt;
      }
    } else if (tx.type === 'CONTRA' && tx.toAccountId === 'cash_in_hand') {
      cashInHandBalance += amt;
      cashInTotal += amt;
    }
  }

  const totalBankBalance = enrichedAccounts.reduce((sum, a) => sum + (a.currentBalance || 0), 0);
  const totalLiquidFunds = cashInHandBalance + totalBankBalance;

  return {
    accounts: enrichedAccounts,
    cashInHand: {
      id: 'cash_in_hand',
      name: 'Cash in Hand (Physical Drawer)',
      openingBalance: openingCash,
      currentBalance: cashInHandBalance,
      totalIn: cashInTotal,
      totalOut: cashOutTotal
    },
    totalBankBalance,
    totalLiquidFunds
  };
}

async function getTreasuryTransactions() {
  const overview = await getTreasuryOverview();
  const database = await connectDb();

  const treasuryTxns = useLocalStorage ? readJsonFile('treasury_transactions.json', []) : await database.collection('treasury_transactions').find({}).toArray();
  const payments = await database.collection('payments').find({}).toArray();
  const consignments = await database.collection('consignments').find({}).toArray();
  const sales = await database.collection('sales').find({}).toArray();

  const accountsMap = {};
  for (const a of overview.accounts) {
    accountsMap[a.id] = a.accountName;
  }
  accountsMap['cash_in_hand'] = 'Cash in Hand (Drawer)';

  const allList = [];

  for (const t of treasuryTxns) {
    const isContra = t.type === 'CONTRA';
    const isIn = t.type === 'CASH_IN' || t.type === 'BANK_IN';
    const isOut = t.type === 'CASH_OUT' || t.type === 'BANK_OUT';

    let accountName = accountsMap[t.accountId] || (t.accountId === 'cash_in_hand' ? 'Cash in Hand (Drawer)' : 'Treasury Account');
    let toAccountName = isContra ? (accountsMap[t.toAccountId] || (t.toAccountId === 'cash_in_hand' ? 'Cash in Hand (Drawer)' : 'Target Account')) : '';

    allList.push({
      id: `TRX-${t.id}`,
      rawId: t.id,
      date: t.date || new Date(t.created || Date.now()).toISOString().split('T')[0],
      time: t.time || '10:00 AM',
      type: t.type,
      flow: isContra ? 'CONTRA' : (isIn ? 'IN' : 'OUT'),
      accountId: t.accountId,
      accountName,
      toAccountId: t.toAccountId || null,
      toAccountName,
      amount: Number(t.amount) || 0,
      inflow: isIn ? Number(t.amount) || 0 : (isContra ? Number(t.amount) || 0 : 0),
      outflow: isOut ? Number(t.amount) || 0 : 0,
      category: t.category || (isContra ? 'Internal Contra Transfer' : (isIn ? 'General Inflow' : 'General Expense')),
      referenceNo: t.referenceNo || '',
      contactName: t.contactName || '',
      notes: t.notes || (isContra ? `Transferred from ${accountName} to ${toAccountName}` : ''),
      isManual: true,
      created: t.created || Date.now()
    });
  }

  for (const p of payments) {
    const isCash = p.paymentMode === 'Cash';
    const isBuyerCol = p.type === 'BUYER_COLLECTION';
    const isDealerPay = p.type === 'DEALER_PAYMENT';
    if (!isBuyerCol && !isDealerPay) continue;

    let accId = isCash ? 'cash_in_hand' : (p.bankAccountId || null);
    if (!accId && !isCash && p.bankName) {
      const match = overview.accounts.find(a => a.bankName.toLowerCase().includes(p.bankName.toLowerCase()));
      if (match) accId = match.id;
    }
    if (!accId && !isCash && overview.accounts.length > 0) {
      accId = overview.accounts[0].id;
    }

    const accName = accId ? (accountsMap[accId] || p.bankName || 'Bank') : (isCash ? 'Cash in Hand (Drawer)' : 'Bank');
    const amt = Number(p.amount) || 0;

    allList.push({
      id: `PAY-${p.id}`,
      rawId: p.id,
      date: p.date || (p.created ? new Date(p.created).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
      time: p.time || 'Trade',
      type: isBuyerCol ? (isCash ? 'CASH_IN' : 'BANK_IN') : (isCash ? 'CASH_OUT' : 'BANK_OUT'),
      flow: isBuyerCol ? 'IN' : 'OUT',
      accountId: accId || (isCash ? 'cash_in_hand' : 'bank'),
      accountName: accName,
      amount: amt,
      inflow: isBuyerCol ? amt : 0,
      outflow: isDealerPay ? amt : 0,
      category: isBuyerCol ? 'Buyer Collection' : 'Dealer Payout',
      referenceNo: p.referenceNo || p.paymentNo || '',
      contactName: p.contactName || '',
      notes: p.notes || (isBuyerCol ? `Collection from ${p.contactName} (${p.paymentMode})` : `Payout to ${p.contactName} (${p.paymentMode})`),
      isManual: false,
      created: p.created || Date.now()
    });
  }

  for (const c of consignments) {
    if (Number(c.lorryBhada) > 0) {
      const amt = Number(c.lorryBhada);
      const isBank = c.lorryBhadaMode === 'Bank';
      const accId = isBank && overview.accounts[0] ? overview.accounts[0].id : 'cash_in_hand';
      const accName = accountsMap[accId] || 'Cash in Hand (Drawer)';

      allList.push({
        id: `LB-${c.id}`,
        rawId: c.id,
        date: c.date,
        time: 'Morning',
        type: isBank ? 'BANK_OUT' : 'CASH_OUT',
        flow: 'OUT',
        accountId: accId,
        accountName: accName,
        amount: amt,
        inflow: 0,
        outflow: amt,
        category: 'Advance Lorry Bhada',
        referenceNo: c.vehicleNo || '',
        contactName: c.dealerName || '',
        notes: `Freight paid to driver (${c.vehicleNo}) - Dealer: ${c.dealerName}`,
        isManual: false,
        created: c.created || Date.now()
      });
    }
  }

  for (const s of sales) {
    if (s.paymentType === 'Cash' || (s.paymentMode === 'Cash' && Number(s.amountPaid) > 0)) {
      const amt = s.paymentType === 'Cash' ? (Number(s.total) || 0) : (Number(s.amountPaid) || 0);
      if (amt > 0) {
        allList.push({
          id: `SALE-${s.id}`,
          rawId: s.id,
          date: s.date,
          time: s.time || 'Market',
          type: 'CASH_IN',
          flow: 'IN',
          accountId: 'cash_in_hand',
          accountName: 'Cash in Hand (Drawer)',
          amount: amt,
          inflow: amt,
          outflow: 0,
          category: 'Market Cash Sale',
          referenceNo: `Bill #${s.billNo}`,
          contactName: s.buyerName || '',
          notes: `Fast cash sale to ${s.buyerName} - Bill #${s.billNo}`,
          isManual: false,
          created: s.created || Date.now()
        });
      }
    }
  }

  allList.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.created || 0) - (a.created || 0);
  });

  return allList;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATEMENT GENERATOR (PURCHASES ONLY, SALES ONLY, OR COMBINED)
// ─────────────────────────────────────────────────────────────────────────────

async function getContactFullStatement(contactId, mode = 'all') {
  const database = await connectDb();
  const cId = Number(contactId);
  const contact = await database.collection('contacts').findOne({ id: cId });
  if (!contact) return null;

  const rows = [];

  // Consignments Received
  if (mode === 'all' || mode === 'sales_only') {
    const consignments = await database.collection('consignments').find({ dealerId: cId }).toArray();
    for (const c of consignments) {
      const items = Array.isArray(c.items) ? c.items : [];
      const totalCrates = items.reduce((s, it) => s + (Number(it.crates) || 0), 0);
      rows.push({
        id: `CON-${c.id}`,
        date: c.date,
        type: 'CONSIGNMENT_INWARD',
        ref: c.consignmentNo,
        description: `Inward Consignment: ${totalCrates} crates (Veh: ${c.vehicleNo || 'N/A'})`,
        crates: totalCrates,
        rate: '-',
        debit: 0,
        credit: 0,
        notes: c.lorryBhada > 0 ? `Lorry Bhada paid: ₹${c.lorryBhada}` : ''
      });
    }

    // Settlements (Patiya) - Credits Dealer
    const settlements = await database.collection('settlements').find({ dealerId: cId }).toArray();
    for (const s of settlements) {
      const items = Array.isArray(s.items) ? s.items : [];
      const repRate = (items[0] && items[0].reportedRate) || (s.totalQtySold > 0 ? Math.round((s.totalReportedGross || 0) / s.totalQtySold) : 0);
      const netCredit = Number(s.netPayableToDealer) || Number(s.netConsignmentAmount) || 0;
      rows.push({
        id: `SET-${s.id}`,
        date: s.date,
        type: 'SETTLEMENT_PATIYA',
        ref: s.settlementNo,
        description: `Patiya: ${s.totalQtySold || 0} crates sold @ ₹${repRate || '-'} (Gross: ₹${s.totalReportedGross || 0} - Exp: ₹${s.totalExpenses || 0} - Comm: ₹${s.commissionAmount || 0})`,
        crates: s.totalQtySold || 0,
        rate: repRate || 0,
        debit: 0,
        credit: netCredit,
        brokingProfit: s.totalBrokingProfit || 0,
        notes: `Unsold carried forward: ${s.unsoldCratesCarriedForward || 0} crates`
      });
    }
  }

  // Purchases made by contact (Goods bought from broker) - Debits Buyer
  if (mode === 'all' || mode === 'purchases_only') {
    const sales = await database.collection('sales').find({ buyerId: cId }).toArray();
    for (const s of sales) {
      const lines = Array.isArray(s.lines) ? s.lines : [];
      const isBad = !!s.isBadDebt;
      rows.push({
        id: `SAL-${s.id}`,
        date: s.date,
        type: 'GOODS_PURCHASED',
        ref: s.billNo,
        description: `Fish Bought: ${lines.map(l => `${l.qty} ${l.unit} ${l.variety}`).join(', ') || 'Fish'}`,
        crates: lines.reduce((acc, l) => acc + (l.unit === 'Crate' ? l.qty : 0), 0),
        rate: lines[0]?.rate || 0,
        debit: Number(s.total) || 0,
        credit: 0,
        isBadDebt: isBad,
        notes: isBad ? 'MARKED AS BAD DEBT (Loss absorbed by broker)' : (s.paymentType || '')
      });
    }
  }

  // Payments & Collections
  const payments = await database.collection('payments').find({ contactId: cId }).toArray();
  for (const p of payments) {
    if (p.type === 'DEALER_PAYMENT' && (mode === 'all' || mode === 'sales_only')) {
      rows.push({
        id: `PAY-${p.id}`,
        date: p.date,
        type: 'DEALER_PAYMENT',
        ref: p.paymentNo,
        description: `Payment paid to dealer (${p.paymentMode}${p.referenceNo ? ' Ref:' + p.referenceNo : ''})`,
        crates: 0,
        rate: 0,
        debit: Number(p.amount) + (Number(p.settlementDiscount) || 0),
        credit: 0,
        notes: p.settlementDiscount > 0 ? `Paid ₹${p.amount} + Kasar/Discount ₹${p.settlementDiscount}` : ''
      });
    } else if (p.type === 'BUYER_COLLECTION' && (mode === 'all' || mode === 'purchases_only')) {
      rows.push({
        id: `COL-${p.id}`,
        date: p.date,
        type: 'BUYER_COLLECTION',
        ref: p.paymentNo,
        description: `Collection received from buyer (${p.paymentMode})`,
        crates: 0,
        rate: 0,
        debit: 0,
        credit: Number(p.amount),
        notes: p.notes
      });
    } else if (p.type === 'CONTRA_ADJUSTMENT' && mode === 'all') {
      rows.push({
        id: `CNT-${p.id}`,
        date: p.date,
        type: 'CONTRA_ADJUSTMENT',
        ref: p.paymentNo,
        description: `Contra Balance Adjustment (Offsetting goods bought against consignment credit)`,
        crates: 0,
        rate: 0,
        debit: Number(p.amount),
        credit: Number(p.amount),
        notes: 'Net balance offset'
      });
    }
  }

  // Sort rows chronologically
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Compute running balance
  let runningBalance = 0;
  for (const r of rows) {
    // Credit increases what we owe (+), Debit decreases it (-)
    runningBalance += (r.credit - r.debit);
    r.runningBalance = runningBalance;
  }

  const financials = await getContactFinancials(cId);

  return {
    contact,
    financials,
    mode,
    rows
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER & API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
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
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Fallback to index.html for SPA
    const indexPath = path.join(ROOT, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }
    res.writeHead(404);
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const searchParams = urlObj.searchParams;

  // ── Auth API ──
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      const body = await readBody(req);
      const user = String(body.username || '').trim();
      const pass = String(body.password || '').trim();

      if ((user === 'admin' && pass === 'admin123') || (user === '9841021203' && pass === 'Msbdeen@21203')) {
        return sendJson(res, { ok: true, user: { username: user, name: 'M S Bhathrudeen', role: 'admin' } });
      }
      return sendJson(res, { error: 'Invalid username or password' }, 401);
    } catch (e) {
      return sendJson(res, { error: e.message }, 500);
    }
  }

  // ── Contacts API (Dealers & Buyers with Dual-Role) ──
  if (req.method === 'GET' && pathname === '/api/contacts') {
    try {
      const database = await connectDb();
      const contacts = await database.collection('contacts').find({}).sort({ name: 1 }).toArray();

      // Enrich with live financial calculations
      const enriched = [];
      for (const c of contacts) {
        const fin = await getContactFinancials(c.id);
        enriched.push({
          ...c,
          ...fin
        });
      }
      return sendJson(res, enriched);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/contacts') {
    try {
      const body = await readBody(req);
      const contact = normalizeContact(body);
      if (!contact.name) return sendJson(res, { error: 'Contact name is required' }, 400);

      const database = await connectDb();
      await database.collection('contacts').replaceOne({ id: contact.id }, contact, { upsert: true });
      return sendJson(res, contact);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname.startsWith('/api/contacts/') && pathname.endsWith('/bad-debt')) {
    try {
      const parts = pathname.split('/');
      const id = Number(parts[3]);
      const body = await readBody(req);
      const database = await connectDb();
      const isDefaulter = !!body.isBadDebtDefaulter;
      const contact = await database.collection('contacts').findOne({ id });

      await database.collection('contacts').updateOne(
        { id },
        { $set: { isBadDebtDefaulter: isDefaulter, badDebtReason: body.reason || (isDefaulter ? 'Defaulted on credit payment' : ''), updated: Date.now() } }
      );

      // Also update credit sales for this buyer
      const query = contact ? { $or: [{ buyerId: id }, { buyerName: new RegExp(`^${contact.name.trim()}$`, 'i') }] } : { buyerId: id };
      const sales = await database.collection('sales').find(query).toArray();
      for (const s of sales) {
        if (s.paymentType === 'Credit') {
          await database.collection('sales').updateOne(
            { id: s.id },
            { $set: { isBadDebt: isDefaulter, updated: Date.now() } }
          );
        }
      }

      return sendJson(res, { ok: true, isBadDebtDefaulter: isDefaulter });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname.startsWith('/api/sales/') && pathname.endsWith('/bad-debt')) {
    try {
      const parts = pathname.split('/');
      const id = Number(parts[3]);
      const body = await readBody(req);
      const database = await connectDb();
      const isBad = body.isBadDebt !== undefined ? !!body.isBadDebt : true;

      await database.collection('sales').updateOne(
        { id },
        { $set: { isBadDebt: isBad, badDebtReason: body.reason || (isBad ? 'Written off as bad debt' : ''), updated: Date.now() } }
      );
      return sendJson(res, { ok: true, isBadDebt: isBad });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Contacts
  if (req.method === 'POST' && pathname === '/api/contacts/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => !isNaN(n)) : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      for (const id of ids) {
        await database.collection('contacts').deleteOne({ id });
        deletedCount++;
      }
      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/contacts/')) {
    try {
      const id = Number(pathname.split('/').pop());
      const database = await connectDb();
      await database.collection('contacts').deleteOne({ id });
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Statement & Ledger API ──
  if (req.method === 'GET' && pathname.startsWith('/api/contacts/') && pathname.endsWith('/statement')) {
    try {
      const parts = pathname.split('/');
      const id = Number(parts[3]);
      const mode = searchParams.get('mode') || 'all'; // 'all', 'sales_only', 'purchases_only'
      const statement = await getContactFullStatement(id, mode);
      if (!statement) return sendJson(res, { error: 'Contact not found' }, 404);
      return sendJson(res, statement);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Inward Consignments API (Arrivals) ──
  if (req.method === 'GET' && pathname === '/api/consignments') {
    try {
      const database = await connectDb();
      const consignments = await database.collection('consignments').find({}).sort({ date: -1, id: -1 }).toArray();
      return sendJson(res, consignments);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/consignments') {
    try {
      const body = await readBody(req);
      const cons = normalizeConsignment(body);
      if (!cons.dealerName) return sendJson(res, { error: 'Dealer name is required' }, 400);

      const database = await connectDb();

      // Ensure Dealer exists in contacts
      let contact = await database.collection('contacts').findOne({ name: cons.dealerName });
      if (!contact && cons.dealerId) {
        contact = await database.collection('contacts').findOne({ id: cons.dealerId });
      }
      if (!contact) {
        contact = normalizeContact({ name: cons.dealerName, isDealer: true });
        await database.collection('contacts').insertOne(contact);
      }
      cons.dealerId = contact.id;

      await database.collection('consignments').replaceOne({ id: cons.id }, cons, { upsert: true });
      return sendJson(res, cons);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Consignments (Arrivals)
  if (req.method === 'POST' && pathname === '/api/consignments/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => !isNaN(n)) : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      for (const id of ids) {
        await database.collection('consignments').deleteOne({ id });
        deletedCount++;
      }
      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/consignments/')) {
    try {
      const id = Number(pathname.split('/').pop());
      const database = await connectDb();
      await database.collection('consignments').deleteOne({ id });
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Daily Market Sales API ──
  if (req.method === 'GET' && pathname === '/api/sales') {
    try {
      const database = await connectDb();
      const sales = await database.collection('sales').find({}).sort({ date: -1, id: -1 }).toArray();
      return sendJson(res, sales);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/sales') {
    try {
      const body = await readBody(req);
      const sale = normalizeSale(body);
      if (!sale.buyerName) return sendJson(res, { error: 'Buyer name is required' }, 400);
      if (!sale.lines || sale.lines.length === 0) return sendJson(res, { error: 'At least one item is required' }, 400);

      const database = await connectDb();

      // Ensure Buyer exists in contacts
      let contact = await database.collection('contacts').findOne({ name: sale.buyerName });
      if (!contact && sale.buyerId) {
        contact = await database.collection('contacts').findOne({ id: sale.buyerId });
      }
      if (!contact) {
        contact = normalizeContact({ name: sale.buyerName, isBuyer: true, phone: sale.buyerPhone });
        await database.collection('contacts').insertOne(contact);
      }
      sale.buyerId = contact.id;

      // Credit limit & Overdue check (unless cash or explicitly bypassed)
      if (sale.paymentType === 'Credit' && !body.bypassCreditCheck && !contact.bypassCreditCheck) {
        const fin = await getContactFinancials(contact.id);
        const newTotalDue = fin.receivableBalance + sale.total;
        if (contact.creditLimit > 0 && newTotalDue > contact.creditLimit) {
          return sendJson(res, {
            error: `Credit limit exceeded! Limit: ₹${contact.creditLimit}, Current Due: ₹${fin.receivableBalance}, Bill Total: ₹${sale.total}. Authorize bypass to proceed.`,
            creditLimitBreached: true
          }, 400);
        }
        if (fin.isOverdue) {
          return sendJson(res, {
            error: `Buyer has overdue bills by ${fin.daysOverdue} days! Outstanding: ₹${fin.receivableBalance}. Authorize bypass to proceed.`,
            creditPeriodBreached: true
          }, 400);
        }
      }

      // Check existing sale to handle edits/stock changes
      const existing = await database.collection('sales').findOne({ id: sale.id });
      if (existing) {
        // Revert stock for existing lines
        for (const oldLine of existing.lines) {
          if (oldLine.consignmentId) {
            const cons = await database.collection('consignments').findOne({ id: oldLine.consignmentId });
            if (cons) {
              const lineCrates = Number(oldLine.crates) > 0 ? Number(oldLine.crates) : ((oldLine.unit === 'Crate' || oldLine.unit === 'Box') ? Number(oldLine.qty) : 0);
              const lineKg = oldLine.unit === 'Kg' ? Number(oldLine.qty) : (Number(oldLine.crates) > 0 && Number(oldLine.kgPerCrate) > 0 ? Number(oldLine.crates) * Number(oldLine.kgPerCrate) : 0);
              const updatedItems = cons.items.map(it => {
                if (it.variety === oldLine.variety) {
                  return {
                    ...it,
                    unsoldCrates: Math.min(it.crates, (it.unsoldCrates || 0) + lineCrates),
                    unsoldWeightKg: Math.min(it.weightKg, (it.unsoldWeightKg || 0) + lineKg)
                  };
                }
                return it;
              });
              await database.collection('consignments').updateOne({ id: cons.id }, { $set: { items: updatedItems, updated: Date.now() } });
            }
          }
        }
      }

      // Deduct stock from the chosen consignments
      for (const line of sale.lines) {
        if (line.consignmentId) {
          const cons = await database.collection('consignments').findOne({ id: line.consignmentId });
          if (cons) {
            const lineCrates = Number(line.crates) > 0 ? Number(line.crates) : ((line.unit === 'Crate' || line.unit === 'Box') ? Number(line.qty) : 0);
            const lineKg = line.unit === 'Kg' ? Number(line.qty) : (Number(line.crates) > 0 && Number(line.kgPerCrate) > 0 ? Number(line.crates) * Number(line.kgPerCrate) : 0);
            const updatedItems = cons.items.map(it => {
              if (it.variety === line.variety) {
                const remCrates = Math.max(0, (it.unsoldCrates || 0) - lineCrates);
                const remKg = remCrates === 0 ? 0 : Math.max(0, (it.unsoldWeightKg || 0) - lineKg);
                return {
                  ...it,
                  unsoldCrates: remCrates,
                  unsoldWeightKg: remKg
                };
              }
              return it;
            });
            await database.collection('consignments').updateOne({ id: cons.id }, { $set: { items: updatedItems, updated: Date.now() } });
          }
        }
      }

      await database.collection('sales').replaceOne({ id: sale.id }, sale, { upsert: true });
      return sendJson(res, sale);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Sales Bills
  if (req.method === 'POST' && pathname === '/api/sales/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => !isNaN(n)) : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      for (const id of ids) {
        const sale = await database.collection('sales').findOne({ id });
        if (sale) {
          // Revert stock
          if (Array.isArray(sale.lines)) {
            for (const line of sale.lines) {
              if (line.consignmentId) {
                const cons = await database.collection('consignments').findOne({ id: line.consignmentId });
                if (cons && Array.isArray(cons.items)) {
                  const lineCrates = Number(line.crates) > 0 ? Number(line.crates) : (line.unit === 'Crate' ? Number(line.qty) : 0);
                  const lineKg = line.unit === 'Kg' ? Number(line.qty) : (Number(line.crates) > 0 && Number(line.kgPerCrate) > 0 ? Number(line.crates) * Number(line.kgPerCrate) : 0);
                  const updatedItems = cons.items.map(it => {
                    if (it.variety === line.variety) {
                      return {
                        ...it,
                        unsoldCrates: Math.min(it.crates, (it.unsoldCrates || 0) + lineCrates),
                        unsoldWeightKg: Math.min(it.weightKg, (it.unsoldWeightKg || 0) + lineKg)
                      };
                    }
                    return it;
                  });
                  await database.collection('consignments').updateOne({ id: cons.id }, { $set: { items: updatedItems, updated: Date.now() } });
                }
              }
            }
          }
          await database.collection('sales').deleteOne({ id });
          deletedCount++;
        }
      }
      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/sales/')) {
    try {
      const id = Number(pathname.split('/').pop());
      const database = await connectDb();
      const sale = await database.collection('sales').findOne({ id });
      if (sale) {
        // Revert stock
        for (const line of sale.lines) {
          if (line.consignmentId) {
            const cons = await database.collection('consignments').findOne({ id: line.consignmentId });
            if (cons) {
              const lineCrates = Number(line.crates) > 0 ? Number(line.crates) : (line.unit === 'Crate' ? Number(line.qty) : 0);
              const lineKg = line.unit === 'Kg' ? Number(line.qty) : (Number(line.crates) > 0 && Number(line.kgPerCrate) > 0 ? Number(line.crates) * Number(line.kgPerCrate) : 0);
              const updatedItems = cons.items.map(it => {
                if (it.variety === line.variety) {
                  return {
                    ...it,
                    unsoldCrates: Math.min(it.crates, (it.unsoldCrates || 0) + lineCrates),
                    unsoldWeightKg: Math.min(it.weightKg, (it.unsoldWeightKg || 0) + lineKg)
                  };
                }
                return it;
              });
              await database.collection('consignments').updateOne({ id: cons.id }, { $set: { items: updatedItems, updated: Date.now() } });
            }
          }
        }
        await database.collection('sales').deleteOne({ id });
      }
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Dealer Settlements API (Patiya) ──
  if (req.method === 'GET' && pathname === '/api/settlements') {
    try {
      const database = await connectDb();
      const settlements = await database.collection('settlements').find({}).sort({ date: -1, id: -1 }).toArray();
      return sendJson(res, settlements);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Pre-calculate sales for a dealer to build Patiya
  if (req.method === 'POST' && pathname === '/api/settlements/calculate') {
    try {
      const body = await readBody(req);
      const dealerId = Number(body.dealerId);
      const date = body.date || new Date().toISOString().split('T')[0];

      if (!dealerId) return sendJson(res, { error: 'dealerId is required' }, 400);

      const database = await connectDb();
      const dealer = await database.collection('contacts').findOne({ id: dealerId });
      if (!dealer) return sendJson(res, { error: 'Dealer not found' }, 404);

      // Find all sales bills that contained fish from this dealer
      const allSales = await database.collection('sales').find({}).toArray();
      const matchingLines = [];

      for (const s of allSales) {
        if (body.date && s.date !== body.date) continue;
        for (const line of s.lines) {
          if (line.dealerId === dealerId || (line.dealerName && line.dealerName.toLowerCase() === dealer.name.toLowerCase())) {
            matchingLines.push({
              saleId: s.id,
              billNo: s.billNo,
              date: s.date,
              consignmentId: line.consignmentId,
              variety: line.variety,
              unit: line.unit,
              qty: line.qty,
              rate: line.rate,
              amount: line.amount
            });
          }
        }
      }

      // Group by variety + rate so different rates (e.g. 70 @ 3000, 26 @ 2500) appear cleanly as sub-lots
      const varietyRateGroups = {};
      for (const l of matchingLines) {
        const v = l.variety || 'Fish';
        const r = Number(l.rate) || 0;
        const u = l.unit || 'Crate';
        const key = `${v}___${r}___${u}`;
        if (!varietyRateGroups[key]) {
          varietyRateGroups[key] = {
            variety: v,
            unit: u,
            rate: r,
            consignmentId: l.consignmentId,
            qtySold: 0,
            realizedRevenue: 0
          };
        }
        varietyRateGroups[key].qtySold += Number(l.qty) || 0;
        varietyRateGroups[key].realizedRevenue += Number(l.amount) || 0;
      }

      const items = Object.values(varietyRateGroups).map((g, idx) => {
        return {
          id: idx + 1,
          consignmentId: g.consignmentId,
          variety: g.variety,
          unit: g.unit,
          qtySold: g.qtySold,
          realizedRevenue: g.realizedRevenue,
          systemAvgRate: g.rate,
          reportedRate: g.rate,
          reportedGross: g.realizedRevenue,
          brokingProfit: 0
        };
      });

      // Find arrival crates, varieties, and unsold crates for this dealer
      const consignments = await database.collection('consignments').find({
        $or: [
          { dealerId },
          { dealerName: new RegExp(`^${dealer.name.trim()}$`, 'i') }
        ]
      }).toArray();

      const receivedVarietiesMap = {};
      let arrivalCratesToday = 0;
      let unsoldCrates = 0;

      for (const c of consignments) {
        const isMatchDate = !date || c.date === date;
        for (const it of (c.items || [])) {
          const varName = (it.variety || 'Fish').trim();
          if (isMatchDate) {
            arrivalCratesToday += Number(it.crates) || 0;
            if (!receivedVarietiesMap[varName]) {
              receivedVarietiesMap[varName] = {
                variety: varName,
                totalCrates: 0,
                unsoldCrates: 0
              };
            }
            receivedVarietiesMap[varName].totalCrates += Number(it.crates) || 0;
            receivedVarietiesMap[varName].unsoldCrates += (it.unsoldCrates !== undefined ? Number(it.unsoldCrates) : Number(it.crates)) || 0;
          }
          unsoldCrates += Number(it.unsoldCrates) || 0;
        }
      }

      // If no arrivals on exact date, check any consignments with unsold stock for this dealer
      if (Object.keys(receivedVarietiesMap).length === 0) {
        for (const c of consignments) {
          for (const it of (c.items || [])) {
            const varName = (it.variety || 'Fish').trim();
            const left = (it.unsoldCrates !== undefined ? Number(it.unsoldCrates) : Number(it.crates)) || 0;
            if (left > 0 || (Number(it.crates) > 0)) {
              if (!receivedVarietiesMap[varName]) {
                receivedVarietiesMap[varName] = {
                  variety: varName,
                  totalCrates: 0,
                  unsoldCrates: 0
                };
              }
              receivedVarietiesMap[varName].totalCrates += Number(it.crates) || 0;
              receivedVarietiesMap[varName].unsoldCrates += left;
              arrivalCratesToday += Number(it.crates) || 0;
            }
          }
        }
      }

      const receivedVarieties = Object.values(receivedVarietiesMap);

      if (!arrivalCratesToday && items.length > 0) {
        arrivalCratesToday = items.reduce((s, it) => s + (it.unit === 'Crate' ? it.qtySold : 0), 0);
      }

      let totalLorryBhada = 0;
      for (const c of consignments) {
        if (!date || c.date === date) {
          totalLorryBhada += Number(c.lorryBhada) || 0;
        }
      }

      // Financials / Previous Balance
      const fin = await getContactFinancials(dealerId);
      const previousBalance = fin.payableBalance || 0;

      return sendJson(res, {
        dealer,
        date,
        items,
        receivedVarieties,
        defaultCommissionType: dealer.defaultCommissionType || 'percent',
        defaultCommissionVal: dealer.defaultCommissionVal || 5,
        arrivalCratesToday,
        unsoldCratesRemaining: unsoldCrates,
        lorryBhada: totalLorryBhada,
        previousBalance
      });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/settlements') {
    try {
      const body = await readBody(req);
      const settlement = normalizeSettlement(body);
      if (!settlement.dealerName) return sendJson(res, { error: 'Dealer name is required' }, 400);

      const database = await connectDb();
      await database.collection('settlements').replaceOne({ id: settlement.id }, settlement, { upsert: true });

      // Automatically deduct settled crates from active consignments for this dealer
      if (Array.isArray(settlement.items)) {
        const dealerConsignments = await database.collection('consignments').find({
          $or: [
            { dealerId: settlement.dealerId },
            { dealerName: new RegExp(`^${settlement.dealerName.trim()}$`, 'i') }
          ]
        }).toArray();

        for (const it of settlement.items) {
          let toDeduct = Number(it.qtySold) || 0;
          for (const c of dealerConsignments) {
            if (toDeduct <= 0) break;
            let modified = false;
            const updatedItems = (c.items || []).map(ci => {
              if (ci.variety && ci.variety.toLowerCase() === (it.variety || '').toLowerCase() && toDeduct > 0) {
                const currentUnsold = ci.unsoldCrates !== undefined ? Number(ci.unsoldCrates) : Number(ci.crates);
                const deduct = Math.min(toDeduct, currentUnsold);
                toDeduct -= deduct;
                modified = true;
                return { ...ci, unsoldCrates: Math.max(0, currentUnsold - deduct) };
              }
              return ci;
            });
            if (modified) {
              const allSold = updatedItems.every(ci => (ci.unsoldCrates || 0) === 0);
              await database.collection('consignments').updateOne(
                { id: c.id },
                { $set: { items: updatedItems, status: allSold ? 'Settled' : c.status, updated: Date.now() } }
              );
            }
          }
        }
      }

      // Automatically sync on-the-spot driver cash payment to Payments collection
      if (settlement.cashPaidToday > 0) {
        const paymentId = Number(`88${settlement.id}`.slice(0, 14)) || Date.now();
        await database.collection('payments').replaceOne(
          { linkedSettlementId: settlement.id },
          {
            id: paymentId,
            paymentNo: `PAY-SET-${settlement.settlementNo || settlement.id}`,
            date: settlement.date,
            contactId: settlement.dealerId,
            contactName: settlement.dealerName,
            type: 'DEALER_PAYMENT',
            amount: settlement.cashPaidToday,
            settlementDiscount: 0,
            paymentMode: 'Cash',
            referenceNo: settlement.cashPaidPayee || 'Cash to Driver on Patiya',
            linkedSettlementId: settlement.id,
            notes: `Patiya #${settlement.settlementNo} on-the-spot payout: ${settlement.cashPaidPayee || 'Cash to Driver'}`,
            created: settlement.created || Date.now(),
            updated: Date.now()
          },
          { upsert: true }
        );
      } else {
        await database.collection('payments').deleteMany({ linkedSettlementId: settlement.id });
      }

      return sendJson(res, settlement);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Settlements (Patiya)
  if (req.method === 'POST' && pathname === '/api/settlements/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => !isNaN(n)) : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      for (const id of ids) {
        await database.collection('settlements').deleteOne({ id });
        await database.collection('payments').deleteMany({ linkedSettlementId: id });
        deletedCount++;
      }
      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname === '/api/settlements') {
    try {
      const database = await connectDb();
      await database.collection('settlements').deleteMany({});
      if (useLocalStorage) {
        writeJsonFile('settlements.json', []);
      }
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/settlements/')) {
    try {
      const id = Number(pathname.split('/').pop());
      const database = await connectDb();
      await database.collection('settlements').deleteOne({ id });
      await database.collection('payments').deleteMany({ linkedSettlementId: id });
      if (useLocalStorage) {
        let settlements = readJsonFile('settlements.json', []);
        settlements = settlements.filter(s => Number(s.id) !== id);
        writeJsonFile('settlements.json', settlements);
      }
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Payments & Settlements API ──
  if (req.method === 'GET' && pathname === '/api/payments') {
    try {
      const database = await connectDb();
      const payments = await database.collection('payments').find({}).sort({ date: -1, id: -1 }).toArray();
      return sendJson(res, payments);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/payments') {
    try {
      const body = await readBody(req);
      const p = normalizePayment(body);
      if (!p.contactName) return sendJson(res, { error: 'Contact name is required' }, 400);
      if (p.amount <= 0 && p.settlementDiscount <= 0) {
        return sendJson(res, { error: 'Payment amount or discount must be greater than 0' }, 400);
      }

      const database = await connectDb();
      let contact = await database.collection('contacts').findOne({ name: p.contactName });
      if (!contact && p.contactId) {
        contact = await database.collection('contacts').findOne({ id: p.contactId });
      }
      if (contact) p.contactId = contact.id;

      await database.collection('payments').replaceOne({ id: p.id }, p, { upsert: true });
      return sendJson(res, p);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Payments
  if (req.method === 'POST' && pathname === '/api/payments/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(n => !isNaN(n)) : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      for (const id of ids) {
        await database.collection('payments').deleteOne({ id });
        deletedCount++;
      }
      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/payments/')) {
    try {
      const id = Number(pathname.split('/').pop());
      const database = await connectDb();
      await database.collection('payments').deleteOne({ id });
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Inventory API ──
  if (req.method === 'GET' && pathname === '/api/inventory') {
    try {
      const stock = await getLiveStockSummary();
      return sendJson(res, stock);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname === '/api/inventory') {
    try {
      const variety = searchParams.get('variety');
      if (!variety) return sendJson(res, { error: 'Variety parameter is required' }, 400);

      const database = await connectDb();
      const consignments = await database.collection('consignments').find({}).toArray();
      let updatedCount = 0;

      for (const c of consignments) {
        let changed = false;
        if (c.items && Array.isArray(c.items)) {
          for (const it of c.items) {
            const v = (it.variety || '').trim().toLowerCase();
            const target = variety.trim().toLowerCase();
            if (v === target || v.startsWith(target) || target.startsWith(v)) {
              it.unsoldCrates = 0;
              it.unsoldWeightKg = 0;
              changed = true;
            }
          }
        }
        if (changed) {
          await database.collection('consignments').replaceOne({ id: c.id }, c);
          updatedCount++;
        }
      }

      return sendJson(res, { ok: true, variety, updatedConsignments: updatedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Daybook API ──
  if (req.method === 'GET' && pathname === '/api/daybook') {
    try {
      const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
      const daybookData = await getDaybook(date);
      return sendJson(res, daybookData);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/daybook') {
    try {
      const body = await readBody(req);
      const database = await connectDb();
      const entry = {
        id: Number(body.id) || Date.now(),
        date: body.date || new Date().toISOString().split('T')[0],
        time: body.time || new Date().toLocaleTimeString('en-US', { hour12: false }),
        type: body.type || 'MANUAL_ENTRY',
        category: body.category || 'Expense',
        description: String(body.description || '').trim(),
        mode: body.mode || 'Cash',
        inflow: Number(body.inflow) || 0,
        outflow: Number(body.outflow) || 0,
        created: Date.now()
      };
      await database.collection('daybook').insertOne(entry);
      return sendJson(res, entry);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Bank Accounts API ──
  if (req.method === 'GET' && pathname === '/api/bank-accounts') {
    try {
      const overview = await getTreasuryOverview();
      return sendJson(res, overview);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/bank-accounts') {
    try {
      const body = await readBody(req);
      const database = await connectDb();
      let accounts = useLocalStorage ? readJsonFile('bank_accounts.json', null) : await database.collection('bank_accounts').find({}).toArray();
      if (!accounts || !Array.isArray(accounts)) accounts = getDefaultBankAccounts();

      const id = Number(body.id) || Date.now();
      const existingIdx = accounts.findIndex(a => Number(a.id) === id);

      const accObj = {
        id,
        accountName: String(body.accountName || '').trim() || 'Bank Account',
        bankName: String(body.bankName || '').trim() || 'Bank',
        accountNumber: String(body.accountNumber || '').trim(),
        ifscCode: String(body.ifscCode || '').trim().toUpperCase(),
        accountType: body.accountType || 'Current',
        upiId: String(body.upiId || '').trim(),
        branch: String(body.branch || '').trim(),
        openingBalance: Number(body.openingBalance) || 0,
        isActive: body.isActive !== false,
        created: existingIdx >= 0 ? accounts[existingIdx].created : Date.now(),
        updated: Date.now()
      };

      if (existingIdx >= 0) {
        accounts[existingIdx] = accObj;
      } else {
        accounts.push(accObj);
      }

      if (useLocalStorage) {
        writeJsonFile('bank_accounts.json', accounts);
      } else {
        await database.collection('bank_accounts').replaceOne({ id }, accObj, { upsert: true });
      }

      return sendJson(res, accObj);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/bank-accounts/')) {
    try {
      const rawId = pathname.split('/').pop();
      const numId = Number(rawId);
      const database = await connectDb();
      await database.collection('bank_accounts').deleteOne({
        $or: [{ id: numId }, { id: rawId }]
      });
      let accounts = readJsonFile('bank_accounts.json', []);
      accounts = accounts.filter(a => Number(a.id) !== numId && String(a.id) !== rawId);
      writeJsonFile('bank_accounts.json', accounts);
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Edit Cash in Hand (Physical Drawer) Balance ──
  if (req.method === 'POST' && pathname === '/api/treasury/cash-in-hand') {
    try {
      const body = await readBody(req);
      const targetBalance = Number(body.amount) || 0;
      const database = await connectDb();

      const overview = await getTreasuryOverview();
      const netTxns = (overview.cashInHand.totalIn || 0) - (overview.cashInHand.totalOut || 0);
      const newOpening = targetBalance - netTxns;

      const currentSettings = (useLocalStorage ? readJsonFile('settings.json', null) : await database.collection('settings').findOne({ _id: 'app_settings' })) || getDefaultSettings();
      const updated = {
        ...(Array.isArray(currentSettings) ? getDefaultSettings() : currentSettings),
        openingCashInHand: newOpening,
        updatedAt: new Date().toISOString()
      };

      if (useLocalStorage) {
        writeJsonFile('settings.json', updated);
      } else {
        await database.collection('settings').replaceOne({ _id: 'app_settings' }, { _id: 'app_settings', ...updated }, { upsert: true });
        writeJsonFile('settings.json', updated);
      }

      return sendJson(res, { ok: true, currentBalance: targetBalance, openingCashInHand: newOpening });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Treasury Transactions API (Cash In/Out, Bank In/Out, Contra) ──
  if (req.method === 'GET' && pathname === '/api/treasury/transactions') {
    try {
      const txns = await getTreasuryTransactions();
      return sendJson(res, txns);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/treasury/transactions') {
    try {
      const body = await readBody(req);
      const database = await connectDb();
      const id = Number(body.id) || Date.now();
      const txObj = {
        id,
        date: body.date || new Date().toISOString().split('T')[0],
        time: body.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        type: body.type || 'CASH_IN',
        accountId: body.accountId || 'cash_in_hand',
        toAccountId: body.toAccountId || null,
        amount: Number(body.amount) || 0,
        category: String(body.category || 'General').trim(),
        referenceNo: String(body.referenceNo || '').trim(),
        contactId: Number(body.contactId) || null,
        contactName: String(body.contactName || '').trim(),
        notes: String(body.notes || '').trim(),
        created: Date.now()
      };

      if (txObj.amount <= 0) {
        return sendJson(res, { error: 'Amount must be greater than 0' }, 400);
      }

      if (useLocalStorage) {
        const list = readJsonFile('treasury_transactions.json', []);
        list.push(txObj);
        writeJsonFile('treasury_transactions.json', list);
      } else {
        await database.collection('treasury_transactions').insertOne(txObj);
      }

      return sendJson(res, txObj);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // Bulk Delete Treasury Transactions
  if (req.method === 'POST' && pathname === '/api/treasury/transactions/bulk-delete') {
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length === 0) return sendJson(res, { error: 'No IDs provided' }, 400);

      const database = await connectDb();
      let deletedCount = 0;
      let treasuryList = useLocalStorage ? readJsonFile('treasury_transactions.json', []) : null;

      for (const item of ids) {
        const strId = String(item);
        if (strId.startsWith('PAY-')) {
          const payId = Number(strId.replace('PAY-', ''));
          await database.collection('payments').deleteOne({ id: payId });
          deletedCount++;
        } else {
          const numId = Number(strId.replace('TRX-', ''));
          if (!isNaN(numId)) {
            if (useLocalStorage && treasuryList) {
              treasuryList = treasuryList.filter(t => Number(t.id) !== numId);
            } else {
              await database.collection('treasury_transactions').deleteOne({ id: numId });
            }
            deletedCount++;
          }
        }
      }

      if (useLocalStorage && treasuryList) {
        writeJsonFile('treasury_transactions.json', treasuryList);
      }

      return sendJson(res, { ok: true, count: deletedCount });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/treasury/transactions/')) {
    try {
      const rawId = pathname.split('/').pop().replace('TRX-', '');
      const id = Number(rawId);
      const database = await connectDb();
      if (useLocalStorage) {
        let list = readJsonFile('treasury_transactions.json', []);
        list = list.filter(t => Number(t.id) !== id);
        writeJsonFile('treasury_transactions.json', list);
      } else {
        await database.collection('treasury_transactions').deleteOne({ id });
      }
      return sendJson(res, { ok: true });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Products / Fish Varieties API ──
  if (req.method === 'GET' && pathname === '/api/products') {
    try {
      const database = await connectDb();
      const products = await database.collection('products').find({}).sort({ name: 1 }).toArray();
      return sendJson(res, products);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/products') {
    try {
      const body = await readBody(req);
      const database = await connectDb();
      const prod = {
        id: Number(body.id) || Date.now(),
        name: String(body.name || '').trim(),
        defaultUnit: body.defaultUnit === 'Kg' ? 'Kg' : 'Crate',
        created: Date.now()
      };
      await database.collection('products').replaceOne({ id: prod.id }, prod, { upsert: true });
      return sendJson(res, prod);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Reports & Dashboard Stats API ──
  if (req.method === 'GET' && pathname === '/api/reports') {
    try {
      const database = await connectDb();
      const settlements = await database.collection('settlements').find({}).toArray();
      const sales = await database.collection('sales').find({}).toArray();
      const contacts = await database.collection('contacts').find({}).toArray();
      const consignments = await database.collection('consignments').find({}).toArray();

      let totalGrossConsignmentSales = 0;
      let totalBrokerCommission = 0;
      let totalBrokingProfit = 0;
      let totalBadDebtLoss = 0;

      for (const s of settlements) {
        totalGrossConsignmentSales += Number(s.totalReportedGross) || 0;
        totalBrokerCommission += Number(s.commissionAmount) || 0;
        totalBrokingProfit += Number(s.totalBrokingProfit) || 0;
      }

      for (const s of sales) {
        if (s.isBadDebt) {
          totalBadDebtLoss += Number(s.total) || 0;
        }
      }

      const totalBrokerEarnings = totalBrokerCommission + totalBrokingProfit;
      const netCompanyProfit = totalBrokerEarnings - totalBadDebtLoss;

      // Crates counts
      let totalCratesReceived = 0;
      let totalCratesUnsold = 0;
      for (const c of consignments) {
        for (const it of c.items) {
          totalCratesReceived += Number(it.crates) || 0;
          totalCratesUnsold += Number(it.unsoldCrates) || 0;
        }
      }

      // Overdue stats
      let overdueBuyersCount = 0;
      let totalOverdueAmount = 0;
      const overdueList = [];

      for (const c of contacts) {
        if (c.isBuyer) {
          const fin = await getContactFinancials(c.id);
          if (fin.isOverdue && fin.receivableBalance > 0) {
            overdueBuyersCount++;
            totalOverdueAmount += fin.receivableBalance;
            overdueList.push({
              id: c.id,
              name: c.name,
              phone: c.phone,
              receivableBalance: fin.receivableBalance,
              daysOverdue: fin.daysOverdue
            });
          }
        }
      }

      // Cash today
      const todayDate = new Date().toISOString().split('T')[0];
      const todayDaybook = await getDaybook(todayDate);

      return sendJson(res, {
        totalGrossConsignmentSales,
        totalBrokerCommission,
        totalBrokingProfit,
        totalBrokerEarnings,
        totalBadDebtLoss,
        netCompanyProfit,
        totalCratesReceived,
        totalCratesUnsold,
        overdueBuyersCount,
        totalOverdueAmount,
        overdueList,
        todayCashIn: todayDaybook.summary.cashIn,
        todayCashOut: todayDaybook.summary.cashOut,
        netCashToday: todayDaybook.summary.netCashChange
      });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Settings API ──
  if (req.method === 'GET' && pathname === '/api/settings') {
    try {
      const database = await connectDb();
      let settings = null;
      if (useLocalStorage) {
        settings = readJsonFile('settings.json', null);
      } else {
        settings = await database.collection('settings').findOne({ _id: 'app_settings' });
      }
      if (!settings || Array.isArray(settings)) {
        settings = getDefaultSettings();
      } else {
        settings = { ...getDefaultSettings(), ...settings };
      }
      return sendJson(res, settings);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    try {
      const body = await readBody(req);
      const database = await connectDb();
      const current = (useLocalStorage ? readJsonFile('settings.json', null) : await database.collection('settings').findOne({ _id: 'app_settings' })) || getDefaultSettings();
      const updated = {
        ...(Array.isArray(current) ? getDefaultSettings() : current),
        ...body,
        updatedAt: new Date().toISOString()
      };
      if (useLocalStorage) {
        writeJsonFile('settings.json', updated);
      } else {
        await database.collection('settings').replaceOne({ _id: 'app_settings' }, { _id: 'app_settings', ...updated }, { upsert: true });
      }
      return sendJson(res, updated);
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Reset / Clear All Business Data ──
  if (req.method === 'POST' && pathname === '/api/system/reset-data') {
    try {
      const body = await readBody(req);
      const pin = String(body.pin || '').trim();
      const settings = (useLocalStorage ? readJsonFile('settings.json', null) : await (await connectDb()).collection('settings').findOne({ _id: 'app_settings' })) || getDefaultSettings();
      const validPin = String(settings.settingsPin || '8181').trim();
      if (pin !== validPin) {
        return sendJson(res, { error: 'Invalid Security PIN' }, 403);
      }

      const database = await connectDb();
      await database.collection('consignments').deleteMany({});
      await database.collection('sales').deleteMany({});
      await database.collection('settlements').deleteMany({});
      await database.collection('payments').deleteMany({});
      await database.collection('daybook').deleteMany({});
      await database.collection('treasury_transactions').deleteMany({});
      await database.collection('contacts').deleteMany({});

      writeJsonFile('consignments.json', []);
      writeJsonFile('sales.json', []);
      writeJsonFile('settlements.json', []);
      writeJsonFile('payments.json', []);
      writeJsonFile('daybook.json', []);
      writeJsonFile('treasury_transactions.json', []);
      writeJsonFile('contacts.json', []);

      return sendJson(res, { ok: true, message: 'All business records wiped successfully' });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Backup Export API ──
  if (req.method === 'GET' && pathname === '/api/backup/export') {
    try {
      const database = await connectDb();
      const consignments = await database.collection('consignments').find({}).toArray();
      const contacts = await database.collection('contacts').find({}).toArray();
      const sales = await database.collection('sales').find({}).toArray();
      const settlements = await database.collection('settlements').find({}).toArray();
      const payments = await database.collection('payments').find({}).toArray();
      const daybook = await database.collection('daybook').find({}).toArray();
      const products = await database.collection('products').find({}).toArray();
      const bank_accounts = useLocalStorage ? readJsonFile('bank_accounts.json', getDefaultBankAccounts()) : await database.collection('bank_accounts').find({}).toArray();
      const treasury_transactions = useLocalStorage ? readJsonFile('treasury_transactions.json', []) : await database.collection('treasury_transactions').find({}).toArray();
      const settings = useLocalStorage ? readJsonFile('settings.json', getDefaultSettings()) : (await database.collection('settings').findOne({ _id: 'app_settings' }) || getDefaultSettings());
      return sendJson(res, {
        app: 'Billify',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        data: {
          consignments,
          contacts,
          sales,
          settlements,
          payments,
          daybook,
          products,
          bank_accounts,
          treasury_transactions,
          settings
        }
      });
    } catch (err) {
      return sendJson(res, { error: err.message }, 500);
    }
  }

  // ── Static Files Fallback ──
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fish Brokerage ERP Server running at http://localhost:${PORT}`);
  });
}

module.exports = { server, connectDb };
