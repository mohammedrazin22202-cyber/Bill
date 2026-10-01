# Billify – Unified Billing & ERP System
**Al Haseena Exports**

Billify combines full Sales billing & customer management with purchase bill processing, supplier tracking, inventory stock ledger, and business reports into a single, cohesive ERP application.

---

## Key Modules & Features

### 1. Sales Module
- **Sales Bills**: Comprehensive invoice management with multi-status tracking (`Paid`, `Outstanding`, `Partially Paid`, `Due`, `Draft`), date range filters (`From` - `To`), search, print, edit, and PDF exports.
- **New Sales Bill**: Fast invoice generator with line items, units, rates, delivery charges, discounts, taxes, customer auto-complete, WhatsApp order message link, and automatic stock deduction upon payment.
- **Customer Directory**: Customer profiles with phone, invoice counts, running outstanding balance, status filters (`All`, `Due`, `Settled`), customer ledger modal, and branded PDF directory export.
- **Customer Collections**: Record customer payments with option to link directly to unpaid/partially-paid invoices or general collections, payment modes (Cash, Bank Transfer, UPI, Cheque, Card), and PDF export.

### 2. Purchases Module
- **Purchase Bills**: Supplier purchase entry featuring box-by-box breakdown (Gross weight, Ice allowance, Box tare, Water tare, Net weight, Rate/Kg), transport/coolie/discount adjustments, invoice preview, print, and PDF generation. Automatically updates inventory stock and generates Lot records.
- **Supplier Directory**: Supplier records with contact info, total purchases, outstanding balances, credit limits, credit periods, and full supplier ledger views.
- **Supplier Payments**: Record payments made to suppliers against balances, payment mode tracking, and payment history PDF exports.

### 3. Inventory & Stock Management
- **Stock Ledger**: Product catalog with SKU, Unit, Purchase Price, Selling Price, Current Stock, and Low Stock alerts.
- **Stock Adjustments**: Manual stock adjustment (IN / OUT) with reasons and audit history.
- **Lot Tracking**: Lot-wise batch and purchase price tracking for inventory valuation.
- **Product History Export**: Export detailed stock movement and history per product as PDF.

### 4. Business Reports & Analytics
- **Analytics Dashboard**: Overview of total revenue, purchases, gross margin, customer collections, supplier payments, and stock valuation.
- **Export Reports**: Generate comprehensive business summary reports to PDF.

---

## Storage & Configuration

Billify supports dual-mode storage:
1. **Local Mode (Default)**: Fast, serverless JSON files stored in `db/`. No external dependencies or internet connection required.
2. **MongoDB Atlas Mode**: Live cloud database synchronization with local JSON fallback.

To configure, edit `.env`:
```env
PORT=8000
DB_TYPE=local
# For MongoDB Atlas, set DB_TYPE=mongodb and configure MONGODB_URI:
# MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/Billify
```

---

## Quick Start

### Windows Launcher
Double-click `start_billforge.bat`. It will automatically check for Node.js, install dependencies if needed, start the unified server, and open your browser at:
```text
http://127.0.0.1:8000
```

### Manual Start
```bash
npm install
node server.js
```
Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.
