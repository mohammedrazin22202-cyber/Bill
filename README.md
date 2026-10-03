# Billify – Fish Commission Brokerage & Mandi ERP
**Al Haseena Exports**

Billify is a dedicated Commission Brokerage & Consignment ERP tailored for fish wholesale markets and consignment agents (*Arhat*). The company acts as an intermediary broker between dealers (consignors) and market buyers (parties).

---

## Key Workflows & Features

### 1. Inward Consignments (Arrivals)
- **Consignment Tracking**: Record fish crates received from boat owners and dealers with vehicle number, driver details, fish varieties, crate counts, and weight (Kg).
- **Lorry Bhada (Advance Freight)**: Record cash or bank advance freight paid to truck drivers immediately on arrival. Automatically debited in Daybook cash out and accounted for in dealer deductions.
- **Unsold Crate Tracking**: Real-time tracking of unsold crates per dealer.

### 2. Fast Morning Market Sales (Auction & Billing)
- **Rapid Billing Terminal**: Fast-paced item billing directly tied to dealer inward stock.
- **Dynamic Demand Pricing**: Dynamic rate per crate or per kg based on market demand.
- **Credit Limit & Period Control**: Validates buyer credit limit and payment period. Overdue or limit breach triggers a warning with an **Authorize Bypass** option.
- **Instant Sharing**: Export professional A4 PDF invoices and 1-click WhatsApp bill delivery.

### 3. Dealer Daily Settlement (Patiya Builder)
- **Sales Aggregation**: Computes total crates/kg sold and gross sales realized for any dealer.
- **Average Rate Calculation & Overwrite**: Automatically calculates system weighted average realization rate (e.g. ₹116.66) and allows the broker to **overwrite the reported rate** (e.g. to ₹115).
- **Broking Rate Profit Tracking**: Automatically tracks the rate difference gain as company broking profit:
  $$\text{Broking Profit} = \text{Actual Sales Realized} - (\text{Quantity Sold} \times \text{Overwritten Rate})$$
- **Dynamic Expense Deductions**: Itemized custom expense lines (Transport, Ice, Coolie labor, Storage, Box charges).
- **Broker Commission**: Calculates commission as percentage (%) of gross sales, flat rate per crate, or fixed lump sum.
- **Net Payable to Dealer**: Credits dealer account with:
  $$\text{Net Payable} = \text{Reported Gross} - \text{Total Expenses} - \text{Broker Commission}$$
- **Unsold Stock Carry-Forward**: Unsold crates carry forward on dealer's inventory account.
- **A4 PDF Patiya & WhatsApp**: Generates branded A4 PDF settlement sheet and WhatsApp summary.

### 4. Unified Dual-Role Accounts & Ledgers
- **Dual Role (Dealer + Buyer in One Account)**: Supports contacts who supply fish on consignment and also purchase fish as buyers.
- **Dual Balance Ledger**: Tracks both Dealer Payable (what company owes them) and Buyer Receivable (what they owe company), showing true Net Balance.
- **Contra Adjustment**: 1-click contra entries to offset goods purchased against consignment sales credits.
- **Blinking Red Overdue Alerts**: Contacts past their credit period blink in bold red on tables and the dashboard alert widget.
- **Permanent Bad Debt Defaulter Flag**: Defaulters are permanently tagged with a red badge, with losses absorbed by the broker.
- **A4 PDF Statement Exports**: Download statements with filter options:
  - **Combined (Both)**
  - **Consignment Sales Only (Patiya)**
  - **Purchases Only (Goods Bought)**

### 5. Multi-Mode Payments & Settlement Discounts (Kasar)
- **Multi-Mode Support**: Cash, Bank Transfer / NEFT, UPI, Cheque with cheque numbers, bank names, and references.
- **Settlement Discounts (Kasar)**: Dedicated fields to write off agreed round-offs (e.g. paying ₹1,00,000 against ₹1,08,250 to settle balance to ₹8,000).

### 6. Cash & Bank Daybook
- Reconciles physical cash in the drawer.
- Tracks cash sales, buyer cash collections, cash lorry bhada, ice/coolie expenses, and cash dealer payouts.

### 7. Live Stock Board
- Godown inventory organized by Fish Variety with real-time **Dealer Ownership Breakdown** (e.g. Total 100 crates: 20 Dealer X, 30 Dealer Y, 50 Dealer Z).

---

## Quick Start

### Windows Launcher
Double-click `start_billforge.bat`. It will start the server and open your browser at:
```text
http://127.0.0.1:8000
```

### Manual Start
```bash
node server.js
```
Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

---

## Authentication & Default Credentials

| Role / Account | Username | Password |
|---|---|---|
| **Admin** | `admin` | `admin123` |
| **Mobile Account** | `9841021203` | `Msbdeen@21203` |
