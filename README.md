# Cargo Flow Console

Cargo Flow Console is a multi-template Excel import system for shipment/order creation. It is built with Next.js App Router, TypeScript, Prisma, and PostgreSQL, and focuses on converting heterogeneous Excel templates into a unified order workflow.

The app supports automatic template recognition, manual field mapping, template memory, inline data validation, editable preview tables, batch submission, and historical shipment lookup.

## Features

- Upload Excel files with drag and drop or file picker
- Support `.xlsx` and `.xls` formats
- Automatically detect different header names and column orders
- Handle templates with extra title rows or multiple sheets
- Manual field mapping when auto recognition is not confident enough
- Remember mapping rules by header fingerprint for future imports
- Show import progress while parsing Excel files
- Preview imported rows in an editable spreadsheet-like table
- Validate required fields, phone numbers, weight, quantity, and temperature zone in real time
- Show all validation errors at once with row number and field details
- Detect duplicate external codes within the current batch and against database records
- Add empty rows or delete rows before submission
- Export current preview data back to Excel
- Submit valid records to PostgreSQL in batches
- View historical shipment records with keyword search, date filtering, and pagination

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Prisma
- PostgreSQL
- `xlsx`
- `lucide-react`

## Screens and Workflow

### 1. Import Workspace

Users can upload an Excel file by dragging it into the upload area or selecting it manually. The system parses the file, detects the most likely data sheet, identifies the header row, and tries to map Excel columns to system fields automatically.

### 2. Mapping Memory

If the system cannot confidently map required fields, a manual mapping dialog is shown. Once the user confirms the mapping, the rule is stored in the database and reused next time for the same template structure.

### 3. Editable Preview

Imported rows are displayed in a spreadsheet-style preview. Cells can be edited inline, and validation runs in real time. Invalid cells are highlighted and a full error summary is shown above the table.

### 4. Batch Submission

Valid rows can be submitted in chunks to the database. Submission progress is displayed, and the UI returns success/fail totals after completion.

### 5. Shipment History

Submitted records can be viewed in the history section, with support for:

- search by external code
- search by receiver name
- filter by submission date range
- paginated browsing

## Built-in Field Rules

The system normalizes imported data around these fields:

- External Code
- Sender Name
- Sender Phone
- Sender Address
- Receiver Name
- Receiver Phone
- Receiver Address
- Weight (kg)
- Quantity
- Temperature Zone
- Remark

Validation rules include:

- required field checks
- phone number format checks
- positive weight checks
- positive integer quantity checks
- allowed temperature zone values: `常温` / `冷藏` / `冷冻`
- duplicate external code detection

## Project Structure

```text
.
├─ prisma/
│  └─ schema.prisma
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ mappings/
│  │  │  └─ orders/
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  ├─ components/
│  │  ├─ EditableGrid.tsx
│  │  ├─ OperationsWorkbench.tsx
│  │  ├─ ShipmentHistory.tsx
│  │  └─ TemplateMappingDialog.tsx
│  ├─ lib/
│  │  └─ prisma.ts
│  └─ utils/
│     └─ excel-tools.ts
├─ excel/
├─ package.json
└─ README.md
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL=your_postgresql_connection_string
```

### 3. Sync the database schema

```bash
npx prisma db push
```

### 4. Start the development server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## API Overview

### `GET /api/mappings`

Fetch a saved mapping rule by header fingerprint.

### `POST /api/mappings`

Create or update a template mapping rule.

### `GET /api/orders`

Fetch shipment history with pagination and filters.

### `POST /api/orders`

Submit a batch of orders into the database.

### `POST /api/orders/check-duplicates`

Check whether external codes already exist in the database.

## Database Models

### `Order`

Stores submitted shipment/order records.

### `TemplateMapping`

Stores remembered Excel mapping rules keyed by header fingerprint.

## Notes

- This project is designed around multi-template Excel import scenarios.
- Business logic is focused on shipment order ingestion and validation.
- The UI is intentionally distinct from a generic admin dashboard, while the import workflow remains practical and fast to use.

## License

This project is for learning and demonstration purposes.
