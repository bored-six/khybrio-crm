# Money tab (expenses + ledger) spec

Money OUT = new Expenses table. Money IN = Invoices with status "Paid". All math in integer centavos. Dates are Asia/Manila (fixed UTC+8, no DST).

## 1. Expenses table (base `app6fRankhuL6LyjF`, Khybrio Records). Do NOT create in code.
User (or Airtable MCP, with consent) creates it, then pastes the table id + field ids into `T.EX` (section 6) and `api/records.js`.

| Field | Type | Notes |
|---|---|---|
| Description | singleLineText (primary) | required |
| Date | date (ISO, no time) | required. Date the money left |
| Amount | currency, symbol ₱, precision 2 | required. Positive = spent. Negative = vendor refund back to us |
| Category | singleSelect | options below, exact spelling |
| Method | singleSelect | `GCash, Bank transfer, Cash, Maya, PayPal, Other` (same as `CH.method`) |
| Vendor | singleLineText | optional |
| Client | link to Clients & Leads | optional, for client-specific costs |
| Receipt | multipleAttachments | attach in Airtable (same as PDFs today) |
| Notes | multilineText | optional |

Category options (`CH.ecat`, order = display order):
`Software & subscriptions, Ads & marketing, Contractors & freelancers, Salaries & wages, Office & rent, Utilities & internet, Equipment, Transport & travel, Meals & client entertainment, Bank & payment fees, Taxes & government, Client refund, Other`
("Taxes & government" covers BIR, SSS, PhilHealth, Pag-IBIG. "Client refund" is money returned to a client: it is an expense, not a negative invoice.)

## 2. What counts as money IN (Invoices `tblS66t7fb8lBerx3`, read via `norm("IN")`)
| Key | Field id | Rule |
|---|---|---|
| status | `fldeMCURqiU3XvEcO` | IN only if `status === "Paid"` (raw status, NOT `payStatus()`). Draft/Sent/Overdue/Void never count |
| paid | `fldlLuammqqCFduNd` | ledger date. **No fallback** to issue/due date |
| amount | `fldiWiKSZPWUKhzMT` | `norm` gives Number or null |
| no / client / method | `fldHGOnJLM5iUOqVp` / `fldkXxrm7x6c912xK` / `fldDXt0AoizW0avf1` | display only |

Paid invoice with missing `paid` date or null/invalid amount: excluded from ledger and returned in `problems` (UI shows "2 paid invoices need a paid date / amount" linking to the invoice form). Pushback: guessing a date silently mis-buckets months; flagging is cheaper than a wrong report.
Partial payments: no such status exists. Out of scope (see section 8).

## 3. `api/records.js`
- Add `"tblEXPENSES_TODO", // Expenses` to `TABLES`.
- For the Expenses table only, on POST/PATCH call `validateExpenseFields(fields, FID)` from `../public/money.js` per record; on any error return `400 {error:"bad_fields", message}`. `FID` = map of key to field id (same ids as `T.EX.f`), defined once in records.js.
- Rules: Amount (if present) must pass `toCentavos` and be non-null; Date (if present) must match `/^\d{4}-\d{2}-\d{2}$/` and be a real calendar date; Category (if present) must be in `EXPENSE_CATEGORIES` (because `typecast:true` would otherwise silently create new select options). POST additionally requires Description, Date, Amount.
- No DELETE endpoint added.

## 4. `public/money.js` (ESM, no deps, pure, no DOM, no `Date.now()` inside: callers pass `today`)
```js
export const EXPENSE_CATEGORIES   // array above, frozen
export function toCentavos(v)           // -> integer | null
export function fromCentavos(c)         // -> Number pesos (c / 100), for writing to Airtable
export function formatPeso(c)           // -> "₱1,234.50" | "-₱500.00" | "–" for null
export function manilaDate(v)           // -> "YYYY-MM-DD" | null
export function monthKey(v)             // -> "YYYY-MM" | null  (= manilaDate(v).slice(0,7))
export function buildLedger(invoices, expenses, opts) // -> {entries, problems}
export function totals(entries)         // -> {in, out, net}  (centavos)
export function byMonth(entries)        // -> [{month, in, out, net}] month DESC
export function byCategory(entries)     // -> [{category, out, count, share}] out DESC, then name ASC
export function balanceAsOf(entries, today) // -> centavos
export function filterEntries(entries, {month, category}) // -> entries (keeps .balance)
export function validateExpenseFields(fields, fid, {create}) // -> string[] errors, [] = ok
```
Contracts:
- **toCentavos**: accepts number or string. String: trim, strip `₱`, spaces and `,`; must match `/^-?\d+(\.\d+)?$/` else null. Round to 2 dp **on the decimal string, half away from zero** (`"1.005"` -> 101, `"-1.005"` -> -101). Number: `Number.isFinite` else null, then `toCentavos(String(v))` (so `1.005` -> 101, `0.1+0.2` -> 30). `""`, null, undefined, NaN, Infinity, `"1e3"`, `"12abc"` -> null. `|result| > 1e13` -> null.
- **manilaDate**: `"YYYY-MM-DD"` returned as-is (Airtable date-only fields carry no tz). Full ISO datetime: parse, add 8h, take UTC date (`"2026-01-31T16:30:00Z"` -> `"2026-02-01"`). Invalid -> null.
- **buildLedger(invoices, expenses, {today, opening = 0})**: inputs are `norm()`ed records. Entry shape:
  `{id, kind:"in"|"out", date, month, amount, signed, category, label, ref, created, future, balance}`
  `amount` = centavos as stored; `signed` = `+amount` for in, `-amount` for out. IN: `category:"Client payment"`, `label: no + client name` (caller passes `clientName` fn in opts, default id), `ref:"IN"`. OUT: category from record (blank -> "Other"), `label` = description, `ref:"EX"`.
  Expense with null date or null amount -> into `problems` too. `problems: [{ref, id, reason:"no_date"|"no_amount"}]`.
  **Sort ascending** by: date, then kind (`in` before `out`, so a same-day payment funds same-day spend), then `created` (record createdTime), then `id`. `balance` = opening + cumulative `signed` in that order. Return entries **descending** (newest first, exact reverse).
  `future` = `date > today`. Future rows stay in entries and in their month bucket.
- **balanceAsOf(entries, today)**: opening + sum of `signed` where `date <= today` (= balance of latest non-future row; opening if none).
- **totals**: `in` = sum of in amounts, `out` = sum of out amounts (vendor refunds reduce it), `net = in - out`. Empty -> all 0.
- **byMonth**: only months that have entries; no gap-filling.
- **byCategory**: out entries only. `share` = `out / totalOut` as Number rounded to 4 dp; 0 when totalOut <= 0. Categories with net 0 still listed if count > 0.
- **filterEntries**: `month` matches `entry.month`; `category` matches `entry.category` ("Client payment" selects income). Never recomputes `balance`: running balance is a property of the full ledger.

## 5. Edge cases (each one is a test)
| Case | Expected |
|---|---|
| no invoices, no expenses | entries `[]`, totals 0/0/0, byMonth `[]`, byCategory `[]`, balanceAsOf = opening |
| invoice Sent/Overdue/Void/Draft with paid date | excluded, not a problem |
| Paid, paid date null | excluded, problem `no_date` |
| Paid, amount null | excluded, problem `no_amount` |
| expense amount -500 (vendor refund) | signed +500, out total drops by 500 |
| "Client refund" expense 1,000 | out +1,000, category Client refund |
| same date IN and OUT | IN row's balance computed first |
| same date, same kind | earlier `created` first; equal created -> id ASC |
| future-dated expense | in entries with `future:true`, in its month, excluded from balanceAsOf |
| invoice paid `2026-01-31T16:30:00Z` | month `2026-02` |
| 0.1 + 0.2 pesos summed | 30 centavos exactly |
| category filter | balance values unchanged from unfiltered ledger |

## 6. Front end (`public/index.html`)
- Keep the inline classic script. Load the module lazily inside it: `let M=null; import("/money.js").then(m=>{M=m;if(tab==="money")render()}).catch(()=>{});` `viewMoney` shows the existing skeleton card while `M` is null.
- Add `T.EX={id:"tblEXPENSES_TODO",f:{desc,date,amount,category,method,vendor,client,receipt,notes}}`, `S.EX=[]`, `loaded.EX=false`, `CH.ecat=EXPENSE_CATEGORIES` (copy literal, it must exist before M loads), `norm` branch: `category/method=selName`, `client=linkIds`, `receipt=atts`.
- `loadAll`: fetch EX separately with its own catch so a missing/unallowed Expenses table shows a banner on the Money tab only, and never breaks the other 5 tables.
- `SPECS.expense` (tbl "EX"): Description*, Date* (default `todayStr()`), Amount (₱)*, Category (select `CH.ecat`, noBlank), Method, Vendor, Client (link), Notes. Amount sent as `fromCentavos(toCentavos(v))`; reject in form if null.
- Tab button `data-tab="money"` "Money" after Quotes & billing; `VIEWS.money=viewMoney`; filters in `fx.money={month:"",category:""}`.
- `viewMoney` layout (Designer owns visuals): KPIs (Balance today, In / Out / Net for selected month or all-time), problems notice, month table from `byMonth`, category breakdown from `byCategory`, ledger table (Date, Description, Category, In, Out, Balance; balance column hidden when a category filter is active), "+ Expense" button. IN rows open the invoice form, OUT rows the expense form.

## 7. Files
| File | Change |
|---|---|
| `public/money.js` | new, section 4 |
| `test/money.test.js` | new, `node:test` + `node:assert/strict`, section 5 cases + toCentavos/manilaDate table tests |
| `api/records.js` | allowlist + validation |
| `public/index.html` | section 6 |
| `package.json` | `"scripts":{"test":"node --test test/"}` |

Tests first: write `test/money.test.js` against section 4/5, confirm red, then implement.

## 8. Not specified (on purpose)
- Partial payments / multi-payment invoices: Invoices has one amount and one paid date; needs a schema change. Treat as a later migration.
- Deleting expenses: no DELETE in the API today; delete in Airtable. Adding DELETE is a contract change for all tables.
- Opening balance storage: `opts.opening` defaults 0; no UI. Add a setting only if the user asks.
- VAT/withholding tax split, multi-currency, CSV export: not requested.
- Visual design of the tab: Designer.
- Tests for rendering/CSS: skipped per test-proportionality rule.
