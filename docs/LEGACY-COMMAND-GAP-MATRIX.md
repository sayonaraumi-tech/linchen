# Legacy command coverage (static source comparison)

Generated from the *pinned original* geruninn source command branches vs new independent business core. A similarly named command is NOT proof of behavioral parity. Original sources read-only; no historic or production data processed.

| Original command | Original module(s) | New command / adapter | Status |
|---|---|---|---|
| `acceptEstimate` | business-domain.js | `acceptEstimate` | Implemented, targeted regression; original parity ongoing
| `accountingMigrationComplete` | accounting-domain.js | No equivalent | Missing or partial |
| `archiveDocument` | business-domain.js | history archive pending | Missing or partial |
| `backfillCash` | accounting-domain.js | No equivalent | Missing or partial |
| `bankExclude` | accounting-domain.js | `bankExclude` | Implemented, targeted regression; original parity ongoing
| `bankMatch` | accounting-domain.js | matchBankPayment / matchBankExpense | Missing or partial |
| `bankRestoreDuplicate` | accounting-domain.js | No equivalent | Missing or partial |
| `bankUnmatch` | accounting-domain.js | unmatchBank | Missing or partial |
| `calendar` | business-domain.js | saveSchedule / Google sync | Missing or partial |
| `calendarCreated` | business-domain.js | No equivalent | Missing or partial |
| `calendarPatched` | business-domain.js | No equivalent | Missing or partial |
| `calendarPrepareCreate` | business-domain.js | No equivalent | Missing or partial |
| `cashAdjustment` | accounting-domain.js | `cashAdjustment` | Implemented, targeted regression; original parity ongoing
| `cleanTestData` | business-domain.js | No equivalent | Missing or partial |
| `confirmBank` | business-domain.js | No equivalent | Missing or partial |
| `deleteExpense` | accounting-domain.js | No equivalent | Missing or partial |
| `deleteMisregistration` | business-domain.js | No equivalent | Missing or partial |
| `deleteSupplierTransaction` | accounting-domain.js | No equivalent | Missing or partial |
| `documentStatus` | business-domain.js | voidDocument | Missing or partial |
| `expenseFromBank` | business-domain.js, accounting-domain.js | No equivalent | Missing or partial |
| `historicalPdfImport` | business-domain.js | legacy archive pending | Missing or partial |
| `importBank` | business-domain.js, accounting-domain.js | bank-import / importBankTransaction | Missing or partial |
| `migrateAccounting` | accounting-domain.js | No equivalent | Missing or partial |
| `migrateAudit` | business-domain.js | No equivalent | Missing or partial |
| `migrateRecord` | business-domain.js | No equivalent | Missing or partial |
| `migrationComplete` | business-domain.js | No equivalent | Missing or partial |
| `migrationStatus` | business-domain.js | No equivalent | Missing or partial |
| `payment` | business-domain.js | No equivalent | Missing or partial |
| `reconcileReceiptCalendarCash` | business-domain.js | No equivalent | Missing or partial |
| `registerCalendarSale` | business-domain.js | registerScheduleSale | Missing or partial |
| `repairFormalDocument` | business-domain.js | No equivalent | Missing or partial |
| `resolveDuplicateCalendarCash` | business-domain.js | No equivalent | Missing or partial |
| `reviewBankIncome` | accounting-domain.js | No equivalent | Missing or partial |
| `saveBankRule` | accounting-domain.js | No equivalent | Missing or partial |
| `saveDocument` | business-domain.js | issueDocument / reviseDocument | Missing or partial |
| `saveExpense` | business-domain.js, accounting-domain.js | `saveExpense` | Implemented, targeted regression; original parity ongoing
| `saveExpenseCategoryRule` | accounting-domain.js | `saveExpenseCategoryRule` | Implemented, targeted regression; original parity ongoing
| `saveSupplier` | accounting-domain.js | `saveSupplier` | Implemented, targeted regression; original parity ongoing
| `settleSupplierInvoice` | accounting-domain.js | `settleSupplierInvoice` | Implemented, targeted regression; original parity ongoing
| `supplierFromBank` | business-domain.js, accounting-domain.js | recordSupplierTransaction / matchBankSupplier | Missing or partial |
| `supplierTransaction` | accounting-domain.js | No equivalent | Missing or partial |

## Important caveats

This matrix inventories literal `cmd.type` comparisons and `case` dispatch; computed/dynamic commands may not be listed. 'Needs behavioral parity' is NOT a pass. Original test fixtures and old→new ID/field mappings must be checked. New app must not use automatic value/date/customer coincidence to merge historical rows.

## Independent command types (current)

`convertEstimateToInvoice` · `deleteTestRecord` · `importBankTransaction` · `issueDocument` · `issueReceiptForPayment` · `matchBankExpense` · `matchBankPayment` · `matchBankSupplier` · `recordSupplierTransaction` · `registerPayment` · `registerScheduleSale` · `restoreRecord` · `reviseDocument` · `saveCustomer` · `saveExpense` · `saveProject` · `saveSchedule` · `saveSettings` · `saveSupplier` · `unmatchBank` · `voidDocument` · `voidRecord`

## 2026-11-13 implementation update

- New core command count: **27** (old literal commands: **41**; names are not one-to-one).
- Added `acceptEstimate` (undated acceptance, one project and schedule, no automatic sale; invoice reuse), `settleSupplierInvoice` (confirmed monthly invoice and exact prepayment deduction), `bankExclude` (explicit exclusion/re-enable), `cashAdjustment` (explicit adjustment without sales), and `saveExpenseCategoryRule` (future-only learning).
- Added frozen original ledger equivalence tests, old unpaid notice preview, historical PDF import read-only preview, and 15-collection legacy shadow.
- **Not a production-ready parity claim:** legacy command runtime behavior, real old backup samples, complete cloud auth/restoration and unknown historical fields remain separate acceptance gates.
