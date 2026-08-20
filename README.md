# Budget Bot // Contractor Expense, Cash Flow & Profit Margin OS

A financial operating system and project expense tracking dashboard designed specifically for trade contractors and handyman professionals.

Built with **Next.js 14**, **React**, and a **Swiss Graphic Design** system featuring high-contrast typography, strict dark mode, and dynamic severity thresholds.

---

## 🎯 Core Features & Financial Capabilities

### 1. Job Costing & Profit Margin Realization
- **Gross Profit Margin Tracking**: Live margin calculation per job:
  $$\text{Gross Margin} = \frac{\text{Revenue} - (\text{Materials} + \text{Labor} + \text{Direct Costs})}{\text{Revenue}} \times 100$$
- **Swiss Severity Indicators**:
  - 🟢 **Healthy**: $\ge 45\%$ margin
  - 🟡 **Caution / Watch**: $25\% - 44\%$ margin
  - 🔴 **Critical / Compressed**: $< 25\%$ margin
- **Net Hourly Realization Rate**: Actual $\$ /\text{hr}$ earned on jobs after subtracting all materials, disposals, and subcontractors vs. quoted billable targets ($85–$120/hr).
- **Materials Markup %**: Track materials markup pass-through (15–25% standard).

### 2. Credit Card Ingestion & Smart Triage
- **Connected Business Card Profile**: Direct visibility into Capital One Spark / Chase / Amex card balances and available credit.
- **Smart Auto-Categorizer**: Automatically recognizes trade suppliers (*The Home Depot, Lowe's, Sherwin-Williams, Ferguson Plumbing, Fastenal, Harbor Freight, Shell/Exxon*).
- **1-Click Job Matcher**: Triage hardware store receipts and assign them directly to active jobs with one click.
- **Live Swipe Simulator & CSV Import**: Test live card swipes or paste bank statement CSVs.

### 3. Day-to-Day & Weekly Cash Flow Waterfall
- Week-to-week cash inflows (deposits, invoice payments) vs. outflows (materials, fuel, subs).
- **Liquidity Cushion & Burn Runway**: Calculates weekly burn rate and available weeks of cash runway.
- **Receivables Aging**: Invoice tracking with overdue alerts.

---

## 🛠️ DevOps & Deployment Guide

### Prerequisites
- Node.js LTS (v22+)
- Git

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Vercel Deployment
The project includes a ready-to-deploy `vercel.json` configuration.
```bash
# Login to Vercel
npx vercel login

# Deploy to preview
npx vercel

# Deploy to production
npx vercel --prod
```

### GitHub Setup
```bash
git init
git add .
git commit -m "feat: initial commit for Budget Bot Trade Financial OS"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/budget-bot.git
git push -u origin main
```
