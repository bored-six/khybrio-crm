# Money tab: UI brief

**Style in one sentence:** a cream ledger page. Fraunces for the three big figures, Inter tabular numbers everywhere else, hairline `--line` rules, and direction (in/out) shown by *column position and sign* first, colour second.

## Rules (so the next piece can be drawn without guessing)
1. Reuse before inventing. Every block below maps to an existing class. New CSS is capped at the 9 rules in "New CSS".
2. Money in is never red and money out is never green-vs-red. In = `--ok`, Out = `--fg` (plain ink). Spending isn't an error. `--hot` only shows up when Net or the running balance goes below zero.
3. Every amount carries a sign: `+₱12,000` / `−₱3,450`, using U+2212 (the real minus sign, not a hyphen). Signs are always shown in the ledger and in Net. The In/Out KPIs drop the sign because the label already says it.
4. Numbers: `peso()` in tables, `pesoShort()` in KPIs. Same as Overview.
5. Icons: only the two inline SVGs below. 16px viewBox, 1.6 stroke, round caps and joins, `currentColor`, no fill.

## Layout, top to bottom (inside `#view`, wrapper `display:flex;flex-direction:column;gap:16px`, same as Overview)
1. **Header row:** `.section-head` with `h2` "Money", then `.monthnav` (prev button, month label, next button), then `.btn.small.primary` "+ Add expense". Prev/next are `.btn.small.ghost` with `aria-label="Previous month"` / `"Next month"`. Label is `<span class="mono" aria-live="polite">October 2026</span>`. Next is `disabled` on the current month.
2. **Summary:** `.kpis.money` with three `kpi()` calls:
   - `kpi("Money in", pesoShort(in), "N paid invoice(s)")`
   - `kpi("Money out", pesoShort(out), "N expense(s)")`
   - `kpi("Net", signed(net), "In minus out", net<0)`. That last argument is the existing `.kpi.alert`, which turns the value `--hot`. The sign also says it, so colour isn't the only signal.
3. **Where it went:** `.card` > `.section-head` h2 "Where it went" > `.funnel`. One `.frow` per category, sorted by amount descending:
   - label: the category name
   - `.ftrack` > `.ffill` with `style="width:{amt/max*100}%;background:color-mix(in srgb,var(--accent) 45%,transparent)"`
   - `.fcount`: the category's % of out
   - `.fval`: `peso(amt)`
   This is the same component as Overview's "Pipeline by stage". On wide screens, put it in a `.grid2` next to a small `.card` "Biggest expenses" (top 5, `.list` / `.li`). **[optional]** You can drop that card and let the bars go full width.
4. **Ledger:** `.section-head` h2 "Ledger" + `.mono.muted` row count. Under it, `.tablewrap > table.ledger`, columns `Date | Description | Category | In | Out | Balance`. In, Out and Balance get `class="r mono"`.
   - First tbody row is `tr.opening`: "Carried from Sep", with only Balance filled in.
   - Rows are ascending by date, so the running balance reads top to bottom.
   - In cell: `+₱x` in `td.in`. Out cell: `−₱x` in `td.out`. The empty side gets `–` in `.muted`.
   - Balance gets `td.bal`, plus `.neg` when it's below 0.
   - Clicking an invoice row calls `openForm("invoice",r)`. Clicking an expense row calls `openForm("expense",r)`.
   - `tfoot`: "Month total" | blank | blank | `+₱in` | `−₱out` | closing balance.
5. **Add expense:** a modal, not inline. Add `SPECS.expense` so it reuses `openForm`, `.sheet`, `.fld` and the `.formerr` validation. Fields:
   - Date (date, req, default today)
   - Amount ₱ (number, req)
   - Category (select, req)
   - Paid to (text)
   - Method (`CH.method`)
   - Client (link, optional, for billable costs)
   - Notes (textarea, full)

   Footer note: "Receipts: attach in Airtable", same pattern as `filesNote`. **[ASSUMPTION]** Categories: Software, Ads, Contractors, Equipment, Transport, Fees, Other. In = paid invoices whose `paid` date falls in the month, until a separate income table exists.

## In vs out without colour
Three signals stack, so it still reads in greyscale, on a cheap phone screen, or for colour-blind users:
- **Position:** separate In and Out columns, like a paper ledger.
- **Sign:** + or −.
- **Words:** headers and KPI labels say "in" and "out".

Colour (`--ok` for in) is a fourth, extra signal. On mobile, where the columns collapse, the flow glyph replaces position as the signal.

## Custom SVG (inline, `aria-hidden="true"`, `width="14" height="14"`)
- Chevron prev: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8 10 12.5"/></svg>`. Next is `d="M6 3.5 10.5 8 6 12.5"`.
- Flow in (mobile rows only): `<path d="M12 4 5 11M5 6v5h5"/><path d="M3 14h10"/>`. An arrow lands on a baseline, so money arrives.
- Flow out: `<path d="M4 12 11 5M6 5h5v5"/><path d="M3 2h10"/>`. The arrow leaves upward from under a top line.
- **Closest pair: flow-in vs flow-out at 14px.** They're told apart by arrow direction *and* by the rule sitting at the bottom vs the top, so they stay distinct even if the arrowhead blurs. The text amount sits beside them with its sign anyway. The chevrons can't be mistaken for these: no rule line, and they only appear in the header.

## New CSS (the only additions)
```css
.monthnav{display:flex;align-items:center;gap:2px}
.monthnav .mono{min-width:112px;text-align:center;font-weight:600}
.kpis.money .val{white-space:nowrap}
table.ledger td.in{color:var(--ok)}
table.ledger td.bal{font-weight:600}
table.ledger td.bal.neg{color:var(--hot)}
table.ledger tr.opening td{background:var(--sunk);color:var(--muted);font-style:italic;cursor:default}
.ledger-list{display:none}
@media (max-width:560px){table.ledger{display:none}.ledger-list{display:flex}.kpis.money{grid-template-columns:1fr 1fr}.kpis.money .kpi:last-child{grid-column:1/-1}.monthnav{order:3;width:100%;justify-content:space-between}}
```
In that media query, the class `.tablewrap` should only go on the wrapper of the ledger table, so hiding `table.ledger` doesn't leave an empty bordered box. Or hide the wrapper too. The builder can choose either.

## Mobile, 375px (343px content width)
- **Header:** "Money" and "+ Add expense" share line 1. `.monthnav` drops to line 2 at full width, chevrons at the edges and the month centred. That gives 44px-tall tap targets if `.btn.small` gets `min-height:44px` inside `.monthnav`.
- **KPIs:** In and Out sit side by side, about 165px each. Net spans the full width below them, since it's the figure you check.
- **Bars:** the existing `.frow` 520px breakpoint (96px / flexible / 72px) already fits.
- **Ledger:** renders as `.card > .list.ledger-list` using `.li`, built from the same data as the table. Each row:
  - `.t`: the description
  - right cell: the signed amount in `.mono`, with the flow glyph in front of it
  - `.m`: date · category `pill(cat,"s-early")` · `Bal ₱x`

  Opening and closing balances become the first and last `.li` in `.muted`.

## Empty states (reuse `.empty`)
- **Nothing in the month:** KPIs still render at ₱0, so the layout doesn't jump. Bars card text: "No spending recorded for October." Ledger: `.card.empty` reading "Nothing in or out for October 2026. Add an expense, or mark an invoice Paid in Quotes & billing and it shows up here.", with a `.btn.small.primary` "+ Add expense" under it.
- **Opening balance only:** show the `tr.opening` row and the empty message together.
- **Loading:** wrap the view in `loadingOr(["IN","EX"])`.
