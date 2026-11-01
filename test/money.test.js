// Written first against plans/money-ledger-spec.md sections 4 and 5.
// public/money.js does not exist when this is written: red on import is expected.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EXPENSE_CATEGORIES,
  toCentavos,
  fromCentavos,
  formatPeso,
  manilaDate,
  monthKey,
  buildLedger,
  totals,
  byMonth,
  byCategory,
  balanceAsOf,
  filterEntries,
  validateExpenseFields,
} from "../public/money.js";

const TODAY = "2026-06-15";

// norm()ed record builders. Invoice amounts / expense amounts are pesos (Airtable currency).
const inv = (o = {}) => ({
  id: "recI1", created: "2026-01-01T00:00:00.000Z", status: "Paid",
  paid: "2026-06-01", amount: 1000, no: "A-0001", client: "cl1", ...o,
});
const ex = (o = {}) => ({
  id: "recE1", created: "2026-01-01T00:00:00.000Z", desc: "Thing",
  date: "2026-06-01", amount: 100, category: "Other", ...o,
});
const build = (i, e, o = {}) => buildLedger(i, e, { today: TODAY, ...o });

describe("EXPENSE_CATEGORIES", () => {
  test("exact list, order, and frozen", () => {
    assert.deepEqual([...EXPENSE_CATEGORIES], [
      "Software & subscriptions", "Ads & marketing", "Contractors & freelancers",
      "Salaries & wages", "Office & rent", "Utilities & internet", "Equipment",
      "Transport & travel", "Meals & client entertainment", "Bank & payment fees",
      "Taxes & government", "Client refund", "Other",
    ]);
    assert.ok(Object.isFrozen(EXPENSE_CATEGORIES));
  });
});

describe("toCentavos", () => {
  const good = [
    [1.005, 101], ["1.005", 101], ["-1.005", -101], [-1.005, -101],
    [0.1 + 0.2, 30], [1234.5, 123450], ["1234.50", 123450],
    ["₱1,234.50", 123450], ["  ₱ 1,234.5  ", 123450], ["-500", -50000],
    [0, 0], ["0", 0], [0.01, 1], ["0.004", 0], ["0.005", 1], ["2.675", 268],
    [19.99, 1999], [1.1, 110], [100, 10000],
    ["100000000000", 1e13], // exactly at the cap is allowed
  ];
  for (const [input, want] of good) {
    test(`${JSON.stringify(input)} -> ${want}`, () => {
      assert.equal(toCentavos(input), want);
    });
  }

  const bad = [
    "", "   ", null, undefined, NaN, Infinity, -Infinity, "1e3", "12abc", "abc",
    "1.2.3", "--5", "5-", "12.", ".5", "$5", {}, [], true,
    "100000000000.01", 1e12, -1e12, // over the 1e13 centavo cap
  ];
  for (const input of bad) {
    test(`junk ${typeof input === "number" ? String(input) : JSON.stringify(input)} -> null`, () => {
      assert.equal(toCentavos(input), null);
    });
  }

  test("always returns an integer", () => {
    for (const v of [0.1, 0.7, 1.005, 33.333, "9.995", 1e-7, 123456.789]) {
      const r = toCentavos(v);
      assert.ok(r === null || Number.isInteger(r), String(v));
    }
  });

  test("summing 0.1 + 0.2 pesos as centavos is exactly 30", () => {
    assert.equal(toCentavos(0.1) + toCentavos(0.2), 30);
  });
});

describe("fromCentavos", () => {
  test("divides by 100", () => {
    assert.equal(fromCentavos(30), 0.3);
    assert.equal(fromCentavos(123450), 1234.5);
    assert.equal(fromCentavos(-101), -1.01);
    assert.equal(fromCentavos(0), 0);
  });
  test("round trip through toCentavos", () => {
    for (const c of [1, 7, 29, 30, 101, 99999, -250, 1e13]) {
      assert.equal(toCentavos(fromCentavos(c)), c);
    }
  });
});

describe("formatPeso", () => {
  test("formats", () => {
    assert.equal(formatPeso(123450), "₱1,234.50");
    assert.equal(formatPeso(-50000), "-₱500.00");
    assert.equal(formatPeso(0), "₱0.00");
    assert.equal(formatPeso(5), "₱0.05");
    assert.equal(formatPeso(100000000), "₱1,000,000.00");
  });
  test("null -> en dash", () => {
    assert.equal(formatPeso(null), "–");
  });
});

describe("manilaDate / monthKey", () => {
  const cases = [
    ["2026-10-31T17:00:00Z", "2026-11-01"],
    ["2026-10-31T16:00:00Z", "2026-11-01"], // 00:00 Manila exactly
    ["2026-10-31T15:59:59Z", "2026-10-31"],
    ["2026-01-31T16:30:00Z", "2026-02-01"],
    ["2026-12-31T16:00:00Z", "2027-01-01"], // year rollover
    ["2028-02-28T16:00:00Z", "2028-02-29"], // leap day
    ["2026-11-01T00:30:00+08:00", "2026-11-01"], // explicit offset respected
    ["2026-11-01T00:30:00.000Z", "2026-11-01"],
    ["2026-05-09", "2026-05-09"], // date-only returned as is
    ["2026-12-31", "2026-12-31"],
  ];
  for (const [input, want] of cases) {
    test(`manilaDate(${input}) = ${want}`, () => assert.equal(manilaDate(input), want));
    test(`monthKey(${input}) = ${want.slice(0, 7)}`, () => assert.equal(monthKey(input), want.slice(0, 7)));
  }
  for (const bad of [null, undefined, "", "not a date", "2026-13-45T00:00:00Z"]) {
    test(`invalid ${JSON.stringify(bad)} -> null`, () => {
      assert.equal(manilaDate(bad), null);
      assert.equal(monthKey(bad), null);
    });
  }
});

describe("buildLedger: empty and inclusion", () => {
  test("empty input", () => {
    const r = build([], []);
    assert.deepEqual(r.entries, []);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(totals(r.entries), { in: 0, out: 0, net: 0 });
    assert.deepEqual(byMonth(r.entries), []);
    assert.deepEqual(byCategory(r.entries), []);
    assert.equal(balanceAsOf(r.entries, TODAY), 0);
  });

  test("empty input honours opening balance", () => {
    const r = build([], [], { opening: 12345 });
    assert.equal(balanceAsOf(r.entries, TODAY), 12345);
  });

  for (const status of ["Draft", "Sent", "Overdue", "Void"]) {
    test(`${status} invoice with a paid date is excluded and is not a problem`, () => {
      const r = build([inv({ status })], []);
      assert.deepEqual(r.entries, []);
      assert.deepEqual(r.problems, []);
    });
  }

  test("Paid invoice with null paid date: excluded, problem no_date", () => {
    const r = build([inv({ id: "recX", paid: null })], []);
    assert.deepEqual(r.entries, []);
    assert.deepEqual(r.problems, [{ ref: "IN", id: "recX", reason: "no_date" }]);
  });

  test("Paid invoice never falls back to another date", () => {
    const r = build([inv({ paid: null, issue: "2026-05-01", due: "2026-05-15", date: "2026-05-01" })], []);
    assert.equal(r.entries.length, 0);
  });

  test("Paid invoice with null amount: excluded, problem no_amount", () => {
    const r = build([inv({ id: "recY", amount: null })], []);
    assert.deepEqual(r.entries, []);
    assert.deepEqual(r.problems, [{ ref: "IN", id: "recY", reason: "no_amount" }]);
  });

  test("expense with null date / null amount become problems", () => {
    const r = build([], [ex({ id: "recA", date: null }), ex({ id: "recB", amount: null })]);
    assert.deepEqual(r.entries, []);
    const byId = Object.fromEntries(r.problems.map(p => [p.id, p]));
    assert.deepEqual(byId.recA, { ref: "EX", id: "recA", reason: "no_date" });
    assert.deepEqual(byId.recB, { ref: "EX", id: "recB", reason: "no_amount" });
    assert.equal(r.problems.length, 2);
  });

  test("problem rows do not disturb balances of good rows", () => {
    const r = build([inv({ id: "bad", paid: null }), inv({ id: "ok", amount: 50 })], []);
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].balance, 5000);
  });
});

describe("buildLedger: entry shape and amounts", () => {
  test("invoice becomes an IN entry in centavos", () => {
    const r = build([inv({ amount: 1234.5, paid: "2026-06-01", client: "cl9" })], [],
      { clientName: id => "Acme " + id });
    const [e] = r.entries;
    assert.equal(e.id, "recI1");
    assert.equal(e.kind, "in");
    assert.equal(e.date, "2026-06-01");
    assert.equal(e.month, "2026-06");
    assert.equal(e.amount, 123450);
    assert.equal(e.signed, 123450);
    assert.equal(e.category, "Client payment");
    assert.equal(e.ref, "IN");
    assert.equal(e.future, false);
    assert.equal(e.balance, 123450);
    assert.ok(e.label.includes("A-0001"));
    assert.ok(e.label.includes("Acme cl9"));
  });

  test("expense becomes an OUT entry with negative signed", () => {
    const [e] = build([], [ex({ amount: 99.99, category: "Equipment" })]).entries;
    assert.equal(e.kind, "out");
    assert.equal(e.amount, 9999);
    assert.equal(e.signed, -9999);
    assert.equal(e.category, "Equipment");
    assert.equal(e.ref, "EX");
    assert.equal(e.balance, -9999);
  });

  test("blank expense category becomes Other", () => {
    for (const category of ["", null, undefined]) {
      const [e] = build([], [ex({ category })]).entries;
      assert.equal(e.category, "Other");
    }
  });

  test("float pesos are converted without drift", () => {
    const r = build([inv({ amount: 0.1 })], [ex({ amount: 0.2, date: "2026-06-02" })]);
    assert.deepEqual(totals(r.entries), { in: 10, out: 20, net: -10 });
    assert.equal(r.entries[0].balance, -10); // newest first
  });

  test("invoice paid as full ISO datetime is bucketed in Manila time", () => {
    const [e] = build([inv({ paid: "2026-01-31T16:30:00Z" })], []).entries;
    assert.equal(e.date, "2026-02-01");
    assert.equal(e.month, "2026-02");
  });

  test("expense dated at the Manila midnight boundary", () => {
    const [e] = build([], [ex({ date: "2026-10-31T17:00:00Z" })], { today: "2026-12-31" }).entries;
    assert.equal(e.month, "2026-11");
  });
});

describe("buildLedger: ordering and running balance", () => {
  test("returns newest first, exact reverse of ascending order", () => {
    const r = build([], [
      ex({ id: "a", date: "2026-03-01" }),
      ex({ id: "b", date: "2026-05-01" }),
      ex({ id: "c", date: "2026-04-01" }),
    ]);
    assert.deepEqual(r.entries.map(e => e.id), ["b", "c", "a"]);
  });

  test("balance is cumulative in ascending order regardless of input order", () => {
    const i = [inv({ id: "i2", paid: "2026-02-01", amount: 500 }), inv({ id: "i1", paid: "2026-01-01", amount: 1000 })];
    const e = [ex({ id: "e1", date: "2026-01-15", amount: 300 })];
    const r = build(i, e, { opening: 200 });
    // ascending: i1 +1000 -> 1200 ; e1 -300 -> 900 ; i2 +500 -> 1400 (centavos x100)
    assert.deepEqual(r.entries.map(x => [x.id, x.balance]),
      [["i2", 140000], ["e1", 90000], ["i1", 120000]]);
  });

  test("same date: IN is computed before OUT", () => {
    const r = build([inv({ id: "in1", paid: "2026-06-01", amount: 100 })],
      [ex({ id: "out1", date: "2026-06-01", amount: 100 })]);
    const byId = Object.fromEntries(r.entries.map(e => [e.id, e]));
    assert.equal(byId.in1.balance, 10000);
    assert.equal(byId.out1.balance, 0);
    // newest first means OUT listed before IN
    assert.deepEqual(r.entries.map(e => e.id), ["out1", "in1"]);
  });

  test("same date OUT created earlier than IN still sorts after IN", () => {
    const r = build(
      [inv({ id: "in1", paid: "2026-06-01", amount: 50, created: "2026-06-01T09:00:00.000Z" })],
      [ex({ id: "out1", date: "2026-06-01", amount: 50, created: "2026-01-01T00:00:00.000Z" })]);
    const byId = Object.fromEntries(r.entries.map(e => [e.id, e]));
    assert.equal(byId.in1.balance, 5000);
    assert.equal(byId.out1.balance, 0);
  });

  test("same date and kind: earlier created first", () => {
    const r = build([], [
      ex({ id: "late", amount: 10, created: "2026-02-02T00:00:00.000Z" }),
      ex({ id: "early", amount: 20, created: "2026-02-01T00:00:00.000Z" }),
    ]);
    const byId = Object.fromEntries(r.entries.map(e => [e.id, e]));
    assert.equal(byId.early.balance, -2000);
    assert.equal(byId.late.balance, -3000);
    assert.deepEqual(r.entries.map(e => e.id), ["late", "early"]);
  });

  test("same date, kind, created: id ascending", () => {
    const r = build([], [
      ex({ id: "recB", amount: 10 }), ex({ id: "recA", amount: 20 }), ex({ id: "recC", amount: 30 }),
    ]);
    const byId = Object.fromEntries(r.entries.map(e => [e.id, e]));
    assert.equal(byId.recA.balance, -2000);
    assert.equal(byId.recB.balance, -3000);
    assert.equal(byId.recC.balance, -6000);
  });

  test("ordering does not depend on input order", () => {
    const rows = [
      ex({ id: "recB", amount: 10 }), ex({ id: "recA", amount: 20 }),
      ex({ id: "recC", amount: 30, date: "2026-05-01" }),
    ];
    const a = build([], rows);
    const b = build([], [...rows].reverse());
    assert.deepEqual(a.entries, b.entries);
  });

  test("final (top) balance equals opening + sum of signed", () => {
    const r = build([inv({ amount: 70.1 }), inv({ id: "i2", paid: "2026-06-03", amount: 0.2 })],
      [ex({ amount: 33.33 }), ex({ id: "e2", date: "2026-06-04", amount: -5 })], { opening: 999 });
    const sum = r.entries.reduce((s, e) => s + e.signed, 999);
    assert.equal(r.entries[0].balance, sum);
  });

  test("vendor refund (negative expense): signed positive, out total drops", () => {
    const r = build([], [ex({ id: "e1", amount: 1000 }), ex({ id: "e2", date: "2026-06-02", amount: -500 })]);
    const refund = r.entries.find(e => e.id === "e2");
    assert.equal(refund.kind, "out");
    assert.equal(refund.amount, -50000);
    assert.equal(refund.signed, 50000);
    assert.equal(totals(r.entries).out, 50000);
  });

  test("Client refund expense counts as out with its category", () => {
    const r = build([], [ex({ amount: 1000, category: "Client refund" })]);
    assert.equal(totals(r.entries).out, 100000);
    assert.equal(r.entries[0].category, "Client refund");
    assert.deepEqual(byCategory(r.entries)[0].category, "Client refund");
  });
});

describe("future rows and balanceAsOf", () => {
  const mk = () => build(
    [inv({ id: "i1", paid: "2026-06-10", amount: 1000 })],
    [ex({ id: "e1", date: "2026-06-15", amount: 100 }), ex({ id: "e2", date: "2026-06-16", amount: 400 })],
    { opening: 50 });

  test("future flag is date > today (today itself is not future)", () => {
    const byId = Object.fromEntries(mk().entries.map(e => [e.id, e]));
    assert.equal(byId.i1.future, false);
    assert.equal(byId.e1.future, false);
    assert.equal(byId.e2.future, true);
  });

  test("future row stays in entries and in its month bucket", () => {
    const r = build([], [ex({ date: "2026-07-20", amount: 10 })]);
    assert.equal(r.entries.length, 1);
    assert.deepEqual(byMonth(r.entries), [{ month: "2026-07", in: 0, out: 1000, net: -1000 }]);
  });

  test("balanceAsOf excludes future rows", () => {
    // 50 + 1000 - 100 = 950 pesos; opening 50 is centavos
    const r = mk();
    assert.equal(balanceAsOf(r.entries, TODAY), 50 + 100000 - 10000);
  });

  test("balanceAsOf equals balance of latest non-future row", () => {
    const r = mk();
    const latest = r.entries.find(e => !e.future);
    assert.equal(balanceAsOf(r.entries, TODAY), latest.balance);
  });

  test("balanceAsOf moves with the date passed in", () => {
    const r = mk();
    assert.equal(balanceAsOf(r.entries, "2026-06-16"), 50 + 100000 - 10000 - 40000);
    assert.equal(balanceAsOf(r.entries, "2026-06-09"), 50);
  });

  test("balanceAsOf with only future rows is the opening", () => {
    const r = build([], [ex({ date: "2027-01-01" })], { opening: 777 });
    assert.equal(balanceAsOf(r.entries, TODAY), 777);
  });
});

describe("totals", () => {
  test("in, out, net", () => {
    const r = build([inv({ amount: 1000 }), inv({ id: "i2", amount: 250.25 })],
      [ex({ amount: 100 }), ex({ id: "e2", amount: -20 })]);
    assert.deepEqual(totals(r.entries), { in: 125025, out: 8000, net: 117025 });
  });
  test("net can be negative", () => {
    const r = build([], [ex({ amount: 5 })]);
    assert.deepEqual(totals(r.entries), { in: 0, out: 500, net: -500 });
  });
  test("empty", () => {
    assert.deepEqual(totals([]), { in: 0, out: 0, net: 0 });
  });
});

describe("byMonth", () => {
  test("month DESC, no gap filling, sums per month", () => {
    const r = build([inv({ paid: "2026-01-10", amount: 100 })], [
      ex({ id: "e1", date: "2026-04-02", amount: 30 }),
      ex({ id: "e2", date: "2026-04-20", amount: 20 }),
    ]);
    assert.deepEqual(byMonth(r.entries), [
      { month: "2026-04", in: 0, out: 5000, net: -5000 },
      { month: "2026-01", in: 10000, out: 0, net: 10000 },
    ]);
  });
  test("sorts across a year boundary", () => {
    const r = build([], [ex({ id: "a", date: "2025-12-31" }), ex({ id: "b", date: "2026-01-01" })]);
    assert.deepEqual(byMonth(r.entries).map(m => m.month), ["2026-01", "2025-12"]);
  });
  test("Manila boundary moves a payment into the next month", () => {
    const r = build([inv({ paid: "2026-04-30T16:00:00Z", amount: 1 })], [], { today: "2026-12-31" });
    assert.deepEqual(byMonth(r.entries).map(m => m.month), ["2026-05"]);
  });
  test("month in/out/net sum to overall totals", () => {
    const r = build([inv({ amount: 12.34 }), inv({ id: "i2", paid: "2026-03-05", amount: 7.77 })],
      [ex({ amount: 1.11 }), ex({ id: "e2", date: "2026-02-02", amount: 2.22 })]);
    const t = totals(r.entries);
    const m = byMonth(r.entries);
    assert.equal(m.reduce((s, x) => s + x.in, 0), t.in);
    assert.equal(m.reduce((s, x) => s + x.out, 0), t.out);
    assert.equal(m.reduce((s, x) => s + x.net, 0), t.net);
  });
});

describe("byCategory", () => {
  test("out only, out DESC then name ASC, count and share", () => {
    const r = build([inv({ amount: 9999 })], [
      ex({ id: "e1", category: "Equipment", amount: 50 }),
      ex({ id: "e2", category: "Office & rent", amount: 25 }),
      ex({ id: "e3", category: "Ads & marketing", amount: 25 }),
      ex({ id: "e4", category: "Equipment", amount: 100 }),
    ]);
    const c = byCategory(r.entries);
    assert.deepEqual(c.map(x => x.category), ["Equipment", "Ads & marketing", "Office & rent"]);
    assert.deepEqual(c[0], { category: "Equipment", out: 15000, count: 2, share: 0.75 });
    assert.equal(c[1].share, 0.125);
    assert.ok(!c.some(x => x.category === "Client payment"));
  });

  test("share rounded to 4 dp", () => {
    const r = build([], [
      ex({ id: "a", category: "Equipment", amount: 1 }),
      ex({ id: "b", category: "Other", amount: 2 }),
    ]);
    const c = byCategory(r.entries);
    assert.equal(c[0].share, 0.6667);
    assert.equal(c[1].share, 0.3333);
  });

  test("category netting to 0 is still listed when count > 0; shares stay finite", () => {
    const r = build([], [
      ex({ id: "a", category: "Equipment", amount: 100 }),
      ex({ id: "b", category: "Equipment", amount: -100, date: "2026-06-02" }),
      ex({ id: "c", category: "Other", amount: 10 }),
    ]);
    const c = byCategory(r.entries);
    const eq = c.find(x => x.category === "Equipment");
    assert.deepEqual(eq, { category: "Equipment", out: 0, count: 2, share: 0 });
    for (const x of c) assert.ok(Number.isFinite(x.share));
  });

  test("share is 0 when total out <= 0 (no NaN / Infinity)", () => {
    const r = build([], [ex({ category: "Equipment", amount: -50 })]);
    const c = byCategory(r.entries);
    assert.equal(c.length, 1);
    assert.equal(c[0].out, -5000);
    assert.equal(c[0].share, 0);
  });

  test("income-only ledger gives no categories", () => {
    assert.deepEqual(byCategory(build([inv()], []).entries), []);
  });
});

describe("filterEntries", () => {
  const r = build(
    [inv({ id: "i1", paid: "2026-05-02", amount: 1000 }), inv({ id: "i2", paid: "2026-06-02", amount: 200 })],
    [ex({ id: "e1", date: "2026-05-10", amount: 100, category: "Equipment" }),
     ex({ id: "e2", date: "2026-06-10", amount: 50, category: "Other" })]);
  const balances = Object.fromEntries(r.entries.map(e => [e.id, e.balance]));

  test("category filter leaves balances identical to the full ledger", () => {
    const f = filterEntries(r.entries, { category: "Equipment" });
    assert.deepEqual(f.map(e => e.id), ["e1"]);
    for (const e of f) assert.equal(e.balance, balances[e.id]);
    assert.notEqual(f[0].balance, -10000); // not recomputed from the filtered subset
  });

  test("month filter keeps full-ledger balances", () => {
    const f = filterEntries(r.entries, { month: "2026-05" });
    assert.deepEqual(f.map(e => e.id).sort(), ["e1", "i1"]);
    for (const e of f) assert.equal(e.balance, balances[e.id]);
  });

  test("Client payment category selects income", () => {
    const f = filterEntries(r.entries, { category: "Client payment" });
    assert.deepEqual(f.map(e => e.id).sort(), ["i1", "i2"]);
  });

  test("month and category combine", () => {
    const f = filterEntries(r.entries, { month: "2026-06", category: "Other" });
    assert.deepEqual(f.map(e => e.id), ["e2"]);
  });

  test("empty / missing filters return everything, in the same order", () => {
    assert.deepEqual(filterEntries(r.entries, {}), r.entries);
    assert.deepEqual(filterEntries(r.entries, { month: "", category: "" }), r.entries);
  });

  test("no match returns []", () => {
    assert.deepEqual(filterEntries(r.entries, { month: "1999-01" }), []);
  });

  test("does not mutate its input", () => {
    const before = JSON.stringify(r.entries);
    filterEntries(r.entries, { category: "Equipment" });
    assert.equal(JSON.stringify(r.entries), before);
  });
});

describe("validateExpenseFields", () => {
  const fid = { desc: "fldDesc", date: "fldDate", amount: "fldAmt", category: "fldCat" };
  const good = { fldDesc: "Figma", fldDate: "2026-06-01", fldAmt: 12.5, fldCat: "Software & subscriptions" };
  const v = (f, create = false) => validateExpenseFields(f, fid, { create });

  test("valid create and valid patch", () => {
    assert.deepEqual(v(good, true), []);
    assert.deepEqual(v({ fldAmt: 5 }), []);
    assert.deepEqual(v({}), []);
  });

  test("create requires Description, Date, Amount", () => {
    for (const k of ["fldDesc", "fldDate", "fldAmt"]) {
      const f = { ...good };
      delete f[k];
      assert.ok(v(f, true).length > 0, k + " missing on create");
      assert.deepEqual(v(f, false), []);
    }
  });

  test("amount: junk rejected, negative (refund) and string pesos accepted", () => {
    for (const bad of ["abc", null, "", NaN, Infinity, "1e3", 1e12]) {
      assert.ok(v({ fldAmt: bad }).length > 0, String(bad));
    }
    assert.deepEqual(v({ fldAmt: -500 }), []);
    assert.deepEqual(v({ fldAmt: "1,234.50" }), []);
  });

  test("date: format and real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-6-1", "06/01/2026", "2026-06-01T00:00:00Z", "", "2026-00-10", "2026-04-31"]) {
      assert.ok(v({ fldDate: bad }).length > 0, bad);
    }
    assert.deepEqual(v({ fldDate: "2028-02-29" }), []);
    assert.ok(v({ fldDate: "2026-02-29" }).length > 0); // 2026 is not a leap year
  });

  test("category must be in the allowed list (no silent new select options)", () => {
    assert.ok(v({ fldCat: "Snacks" }).length > 0);
    assert.ok(v({ fldCat: "software & subscriptions" }).length > 0); // case-sensitive
    for (const c of EXPENSE_CATEGORIES) assert.deepEqual(v({ fldCat: c }), []);
  });

  test("multiple problems yield multiple errors", () => {
    assert.ok(v({ fldAmt: "x", fldDate: "nope", fldCat: "nope" }).length >= 3);
  });
});
