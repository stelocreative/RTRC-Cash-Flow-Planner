import React, { useEffect, useMemo, useRef, useState } from "react";

type VehicleRow = {
  id: string;
  name: string;
  category: string;
  baseAdr: number; // $
  baseUtilPct: number; // 0-100
  fixedMonthly: number; // $
  variablePerDay: number; // $
  maintenanceReserve: number; // $
  notes: string;
};

type MonthAssumption = {
  label: string; // Jan...
  days: number;
  adrMultPct: number; // e.g. 120 means 1.2x
  utilMultPct: number; // e.g. 110 means 1.1x
};

type GlobalInputs = {
  revenueFeePct: number; // 0-100
  companyOverheadMonthly: number; // $
  salesTaxPct: number; // 0-100
  taxEnabled: boolean;
  taxPassThrough: boolean; // if true, exclude tax from “cash flow”
};

const STORAGE_KEY = "rtrc_fleet_cashflow_v1";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundInt = (v: number) => Math.round(v);
const safeNum = (v: any, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};
const uid = () => Math.random().toString(16).slice(2, 10);

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (n: number) => `${n.toFixed(1)}%`;

function defaultMonths(): MonthAssumption[] {
  return [
    { label: "Jan", days: 31, adrMultPct: 105, utilMultPct: 95 },
    { label: "Feb", days: 28, adrMultPct: 110, utilMultPct: 100 },
    { label: "Mar", days: 31, adrMultPct: 105, utilMultPct: 95 },
    { label: "Apr", days: 30, adrMultPct: 95, utilMultPct: 85 },
    { label: "May", days: 31, adrMultPct: 100, utilMultPct: 90 },
    { label: "Jun", days: 30, adrMultPct: 115, utilMultPct: 105 },
    { label: "Jul", days: 31, adrMultPct: 125, utilMultPct: 115 },
    { label: "Aug", days: 31, adrMultPct: 120, utilMultPct: 110 },
    { label: "Sep", days: 30, adrMultPct: 105, utilMultPct: 95 },
    { label: "Oct", days: 31, adrMultPct: 100, utilMultPct: 90 },
    { label: "Nov", days: 30, adrMultPct: 105, utilMultPct: 95 },
    { label: "Dec", days: 31, adrMultPct: 120, utilMultPct: 110 },
  ];
}

function sampleFleet(): VehicleRow[] {
  return [
    {
      id: uid(),
      name: "Escalade 1",
      category: "Cadillac Escalade (Luxury)",
      baseAdr: 325,
      baseUtilPct: 62,
      fixedMonthly: 1450,
      variablePerDay: 28,
      maintenanceReserve: 180,
      notes: "Flagship executive. Higher ADR + higher turn cost.",
    },
    {
      id: uid(),
      name: "Suburban 1",
      category: "Chevy Suburban (Family)",
      baseAdr: 245,
      baseUtilPct: 66,
      fixedMonthly: 1180,
      variablePerDay: 24,
      maintenanceReserve: 150,
      notes: "High demand; strong all-seasons performer.",
    },
    {
      id: uid(),
      name: "Wrangler 1",
      category: "Jeep Wrangler 4-Door (Go Topless)",
      baseAdr: 265,
      baseUtilPct: 58,
      fixedMonthly: 980,
      variablePerDay: 26,
      maintenanceReserve: 140,
      notes: "Seasonal lift in summer; marketing centerpiece.",
    },
    {
      id: uid(),
      name: "Model Y 1",
      category: "Tesla Model Y (AWD)",
      baseAdr: 210,
      baseUtilPct: 60,
      fixedMonthly: 1120,
      variablePerDay: 18,
      maintenanceReserve: 120,
      notes: "Strong demand with corporate travelers; low variable cost.",
    },
    {
      id: uid(),
      name: "Transit 1",
      category: "Ford Transit Passenger (Group)",
      baseAdr: 295,
      baseUtilPct: 45,
      fixedMonthly: 1350,
      variablePerDay: 32,
      maintenanceReserve: 220,
      notes: "Lower utilization but high revenue per rental day.",
    },
  ];
}

function defaultGlobals(): GlobalInputs {
  return {
    revenueFeePct: 2.9,
    companyOverheadMonthly: 18500,
    salesTaxPct: 8.265,
    taxEnabled: false,
    taxPassThrough: true,
  };
}

function parseCsv(text: string): VehicleRow[] {
  // Minimal CSV parser for simple cases (no embedded newlines).
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const col = {
    name: idx("name"),
    category: idx("category"),
    baseAdr: idx("baseAdr"),
    baseUtilPct: idx("baseUtilPct"),
    fixedMonthly: idx("fixedMonthly"),
    variablePerDay: idx("variablePerDay"),
    maintenanceReserve: idx("maintenanceReserve"),
    notes: idx("notes"),
  };

  const required = ["name", "category", "baseAdr", "baseUtilPct", "fixedMonthly", "variablePerDay"];
  for (const r of required) {
    if ((col as any)[r] === -1) {
      throw new Error(
        `CSV missing required column: ${r}. Expected columns like: name, category, baseAdr, baseUtilPct, fixedMonthly, variablePerDay, maintenanceReserve, notes`
      );
    }
  }

  const rows: VehicleRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    const get = (c: number) => (c >= 0 ? parts[c] ?? "" : "");
    const row: VehicleRow = {
      id: uid(),
      name: String(get(col.name)).trim(),
      category: String(get(col.category)).trim(),
      baseAdr: safeNum(get(col.baseAdr)),
      baseUtilPct: clamp(safeNum(get(col.baseUtilPct)), 0, 100),
      fixedMonthly: safeNum(get(col.fixedMonthly)),
      variablePerDay: safeNum(get(col.variablePerDay)),
      maintenanceReserve: safeNum(get(col.maintenanceReserve)),
      notes: String(get(col.notes)).trim(),
    };
    if (row.name) rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  // Handles quoted fields with commas.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\\"/g, '"'));
}

function toCsv(rows: VehicleRow[]): string {
  const header = [
    "name",
    "category",
    "baseAdr",
    "baseUtilPct",
    "fixedMonthly",
    "variablePerDay",
    "maintenanceReserve",
    "notes",
  ];
  const esc = (s: any) => {
    const str = String(s ?? "");
    if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.name),
        esc(r.category),
        esc(r.baseAdr),
        esc(r.baseUtilPct),
        esc(r.fixedMonthly),
        esc(r.variablePerDay),
        esc(r.maintenanceReserve),
        esc(r.notes),
      ].join(",")
    );
  }
  return lines.join("\n");
}

export default function App() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>(() => sampleFleet());
  const [months, setMonths] = useState<MonthAssumption[]>(() => defaultMonths());
  const [globals, setGlobals] = useState<GlobalInputs>(() => defaultGlobals());

  const [targetMonthlyCashflow, setTargetMonthlyCashflow] = useState<number>(25000);
  const [breakEvenMonthIndex, setBreakEvenMonthIndex] = useState<number>(6); // default Jul

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load persisted state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.vehicles && Array.isArray(parsed.vehicles)) setVehicles(parsed.vehicles);
      if (parsed?.months && Array.isArray(parsed.months)) setMonths(parsed.months);
      if (parsed?.globals) setGlobals(parsed.globals);
    } catch {
      // ignore
    }
  }, []);

  // Persist
  useEffect(() => {
    const payload = { vehicles, months, globals };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [vehicles, months, globals]);

  const computed = useMemo(() => {
    const feeRate = clamp(globals.revenueFeePct, 0, 100) / 100;
    const taxRate = clamp(globals.salesTaxPct, 0, 100) / 100;

    const monthRows = months.map((m) => {
      let totalRevenue = 0;
      let totalFees = 0;
      let totalVariable = 0;
      let totalVehicleFixed = 0;
      let totalContribution = 0;

      // weighted util: sum(rentalDays) / sum(daysInMonth)
      let totalRentalDays = 0;

      const perVehicle = vehicles.map((v) => {
        const adr = safeNum(v.baseAdr) * (safeNum(m.adrMultPct) / 100);
        const utilPct = clamp(safeNum(v.baseUtilPct) * (safeNum(m.utilMultPct) / 100), 0, 100);
        const rentalDays = roundInt(m.days * (utilPct / 100));

        const revenue = rentalDays * adr;
        const fees = revenue * feeRate;
        const variable = rentalDays * safeNum(v.variablePerDay);
        const vehicleFixed = safeNum(v.fixedMonthly) + safeNum(v.maintenanceReserve);
        const contribution = revenue - fees - variable - vehicleFixed;

        totalRevenue += revenue;
        totalFees += fees;
        totalVariable += variable;
        totalVehicleFixed += vehicleFixed;
        totalContribution += contribution;
        totalRentalDays += rentalDays;

        return {
          vehicleId: v.id,
          adr,
          utilPct,
          rentalDays,
          revenue,
          fees,
          variable,
          vehicleFixed,
          contribution,
        };
      });

      const taxCollected = globals.taxEnabled ? totalRevenue * taxRate : 0;
      const overhead = safeNum(globals.companyOverheadMonthly);
      const cashFlow = totalContribution - overhead;

      // If tax is pass-through, exclude it from “cashflow”; if not, include in net.
      const cashFlowAfterTaxHandling = globals.taxEnabled
        ? globals.taxPassThrough
          ? cashFlow
          : cashFlow + taxCollected
        : cashFlow;

      const weightedUtilPct =
        vehicles.length === 0 ? 0 : (totalRentalDays / (vehicles.length * m.days)) * 100;

      return {
        ...m,
        perVehicle,
        totalRevenue,
        totalFees,
        totalVariable,
        totalVehicleFixed,
        totalContribution,
        overhead,
        taxCollected,
        cashFlow: cashFlowAfterTaxHandling,
        weightedUtilPct,
      };
    });

    const annual = monthRows.reduce(
      (acc, r) => {
        acc.revenue += r.totalRevenue;
        acc.fees += r.totalFees;
        acc.variable += r.totalVariable;
        acc.vehicleFixed += r.totalVehicleFixed;
        acc.contribution += r.totalContribution;
        acc.overhead += r.overhead;
        acc.taxCollected += r.taxCollected;
        acc.cashFlow += r.cashFlow;
        return acc;
      },
      {
        revenue: 0,
        fees: 0,
        variable: 0,
        vehicleFixed: 0,
        contribution: 0,
        overhead: 0,
        taxCollected: 0,
        cashFlow: 0,
      }
    );

    let best = monthRows[0];
    let worst = monthRows[0];
    for (const r of monthRows) {
      if (!best || r.cashFlow > best.cashFlow) best = r;
      if (!worst || r.cashFlow < worst.cashFlow) worst = r;
    }

    return { monthRows, annual, best, worst };
  }, [vehicles, months, globals]);

  const breakEven = useMemo(() => {
    // Simple: scale utilization uniformly across the fleet for a chosen month until cashFlow hits target.
    const mi = clamp(breakEvenMonthIndex, 0, months.length - 1);
    const m = months[mi];
    const feeRate = clamp(globals.revenueFeePct, 0, 100) / 100;

    const base = vehicles.map((v) => {
      const adr = safeNum(v.baseAdr) * (safeNum(m.adrMultPct) / 100);
      const utilPct = clamp(safeNum(v.baseUtilPct) * (safeNum(m.utilMultPct) / 100), 0, 100);
      const variablePerDay = safeNum(v.variablePerDay);
      const vehicleFixed = safeNum(v.fixedMonthly) + safeNum(v.maintenanceReserve);
      return { adr, utilPct, variablePerDay, vehicleFixed };
    });

    const overhead = safeNum(globals.companyOverheadMonthly);

    const cashFlowGivenScale = (scale: number) => {
      let totalContribution = 0;
      for (const v of base) {
        const u = clamp(v.utilPct * scale, 0, 100);
        const rentalDays = roundInt(m.days * (u / 100));
        const revenue = rentalDays * v.adr;
        const fees = revenue * feeRate;
        const variable = rentalDays * v.variablePerDay;
        const contribution = revenue - fees - variable - v.vehicleFixed;
        totalContribution += contribution;
      }
      return totalContribution - overhead;
    };

    // If fleet empty, nothing to solve.
    if (vehicles.length === 0) return { scale: 0, impliedAvgUtil: 0, solved: false };

    // Binary search scale between 0 and 2.0 (200% scaling, but clamped per vehicle).
    let lo = 0;
    let hi = 2;
    let mid = 1;
    for (let i = 0; i < 40; i++) {
      mid = (lo + hi) / 2;
      const cf = cashFlowGivenScale(mid);
      if (cf >= targetMonthlyCashflow) hi = mid;
      else lo = mid;
    }

    const solvedCashFlow = cashFlowGivenScale(mid);
    const impliedAvgUtil =
      base.reduce((sum, v) => sum + clamp(v.utilPct * mid, 0, 100), 0) / base.length;

    // Consider it “solved” if target is within $250
    const solved = Math.abs(solvedCashFlow - targetMonthlyCashflow) <= 250;

    return { scale: mid, impliedAvgUtil, solved };
  }, [breakEvenMonthIndex, months, vehicles, globals, targetMonthlyCashflow]);

  const addVehicle = () => {
    setVehicles((prev) => {
      if (prev.length >= 50) return prev;
      return [
        ...prev,
        {
          id: uid(),
          name: `Vehicle ${prev.length + 1}`,
          category: "",
          baseAdr: 200,
          baseUtilPct: 55,
          fixedMonthly: 1000,
          variablePerDay: 20,
          maintenanceReserve: 100,
          notes: "",
        },
      ];
    });
  };

  const duplicateVehicle = (id: string) => {
    setVehicles((prev) => {
      if (prev.length >= 50) return prev;
      const idx = prev.findIndex((v) => v.id === id);
      if (idx === -1) return prev;
      const v = prev[idx];
      const copy: VehicleRow = { ...v, id: uid(), name: `${v.name} (copy)` };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  const deleteVehicle = (id: string) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
  };

  const resetAll = () => {
    setVehicles(sampleFleet());
    setMonths(defaultMonths());
    setGlobals(defaultGlobals());
    setTargetMonthlyCashflow(25000);
    setBreakEvenMonthIndex(6);
  };

  const exportCsv = () => {
    const csv = toCsv(vehicles);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rtrc_vehicles.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) throw new Error("No rows found in CSV.");
    if (rows.length > 50) rows.splice(50);
    setVehicles(rows);
  };

  const styles: Record<string, React.CSSProperties> = {
    app: {
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0b0f18 0%, #070a11 100%)",
      color: "#e8eefc",
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
      padding: 18,
    },
    topRow: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      marginBottom: 14,
    },
    title: {
      fontSize: 20,
      fontWeight: 750,
      letterSpacing: 0.2,
    },
    badge: {
      fontSize: 12,
      opacity: 0.8,
      padding: "6px 10px",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 999,
      background: "rgba(255,255,255,0.04)",
    },
    cardGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(12, 1fr)",
      gap: 12,
      marginBottom: 12,
    },
    card: {
      gridColumn: "span 4",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 14,
      padding: 12,
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      minWidth: 280,
    },
    cardTitle: { fontSize: 12, opacity: 0.85, marginBottom: 6, letterSpacing: 0.2 },
    bigNumber: { fontSize: 18, fontWeight: 750 },
    small: { fontSize: 12, opacity: 0.8 },
    controlsRow: { display: "flex", gap: 8, flexWrap: "wrap" },
    btn: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "#e8eefc",
      padding: "8px 10px",
      borderRadius: 10,
      cursor: "pointer",
      fontWeight: 650,
      fontSize: 12,
    },
    btnPrimary: {
      background: "rgba(120,160,255,0.16)",
      border: "1px solid rgba(120,160,255,0.35)",
    },
    input: {
      background: "rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "#e8eefc",
      borderRadius: 10,
      padding: "8px 10px",
      outline: "none",
      width: "100%",
    },
    label: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
    section: {
      marginTop: 14,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 14,
      padding: 12,
      boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    },
    sectionTitle: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
      marginBottom: 10,
    },
    h2: { fontSize: 14, fontWeight: 750, letterSpacing: 0.2, margin: 0 },
    tableWrap: {
      overflow: "auto",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
    },
    table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 1200 },
    th: {
      position: "sticky" as const,
      top: 0,
      zIndex: 2,
      textAlign: "left" as const,
      fontSize: 12,
      padding: 10,
      background: "rgba(10,14,24,0.98)",
      borderBottom: "1px solid rgba(255,255,255,0.10)",
      whiteSpace: "nowrap" as const,
    },
    td: {
      fontSize: 12,
      padding: 10,
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      verticalAlign: "top" as const,
    },
    tdRight: { textAlign: "right" as const, whiteSpace: "nowrap" as const },
    pillGood: {
      display: "inline-block",
      padding: "3px 8px",
      borderRadius: 999,
      background: "rgba(80, 255, 170, 0.12)",
      border: "1px solid rgba(80, 255, 170, 0.25)",
      fontSize: 12,
      fontWeight: 750,
    },
    pillBad: {
      display: "inline-block",
      padding: "3px 8px",
      borderRadius: 999,
      background: "rgba(255, 90, 90, 0.12)",
      border: "1px solid rgba(255, 90, 90, 0.25)",
      fontSize: 12,
      fontWeight: 750,
    },
    rowGrid: { display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 },
    col3: { gridColumn: "span 3" },
    col4: { gridColumn: "span 4" },
    col6: { gridColumn: "span 6" },
    col12: { gridColumn: "span 12" },
    checkboxRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    checkbox: { transform: "scale(1.05)" },
    help: { fontSize: 12, opacity: 0.8, marginTop: 6 },
  };

  return (
    <div style={styles.app}>
      <div style={styles.topRow}>
        <div>
          <div style={styles.title}>RTRC Fleet Cash Flow Planner</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <div style={styles.badge}>Up to 50 vehicles</div>
            <div style={styles.badge}>12-month forecast</div>
            <div style={styles.badge}>Local autosave</div>
          </div>
        </div>

        <div style={styles.controlsRow}>
          <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={addVehicle}>
            + Add Vehicle
          </button>
          <button style={styles.btn} onClick={exportCsv}>
            Export CSV
          </button>
          <button
            style={styles.btn}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            Import CSV
          </button>
          <button style={styles.btn} onClick={resetAll}>
            Reset (Sample Data)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importCsv(f);
              } catch (err: any) {
                alert(err?.message ?? "CSV import failed.");
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
      </div>

      {/* Summary cards */}
      <div style={styles.cardGrid}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Annual Revenue</div>
          <div style={styles.bigNumber}>${money(computed.annual.revenue)}</div>
          <div style={styles.small}>
            Annual Cash Flow: <b>${money(computed.annual.cashFlow)}</b>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Best vs Worst Month</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={styles.small}>Best</div>
              <div style={styles.bigNumber}>
                {computed.best?.label ?? "-"}: ${money(computed.best?.cashFlow ?? 0)}
              </div>
            </div>
            <div>
              <div style={styles.small}>Worst</div>
              <div style={styles.bigNumber}>
                {computed.worst?.label ?? "-"}: ${money(computed.worst?.cashFlow ?? 0)}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>Break-even Utilization Estimator</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={styles.label}>Month</div>
              <select
                style={styles.input}
                value={breakEvenMonthIndex}
                onChange={(e) => setBreakEvenMonthIndex(parseInt(e.target.value, 10))}
              >
                {months.map((m, i) => (
                  <option key={m.label} value={i}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={styles.label}>Target Cash Flow (Monthly)</div>
              <input
                style={styles.input}
                type="number"
                step={100}
                value={targetMonthlyCashflow}
                onChange={(e) => setTargetMonthlyCashflow(safeNum(e.target.value, 0))}
              />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={styles.small}>
              Implied Avg Utilization: <b>{pct(breakEven.impliedAvgUtil)}</b>{" "}
              {breakEven.solved ? (
                <span style={styles.pillGood}>On Target</span>
              ) : (
                <span style={styles.pillBad}>Approx.</span>
              )}
            </div>
            <div style={styles.help}>
              This scales utilization across the fleet for the selected month (bounded 0–100% per
              vehicle) to approximate your target cash flow.
            </div>
          </div>
        </div>
      </div>

      {/* Global inputs */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <h2 style={styles.h2}>Global Inputs</h2>
          <div style={styles.small}>Company-level assumptions that apply across the model</div>
        </div>

        <div style={styles.rowGrid}>
          <div style={styles.col3}>
            <div style={styles.label}>Revenue Fee %</div>
            <input
              style={styles.input}
              type="number"
              step={0.1}
              value={globals.revenueFeePct}
              onChange={(e) =>
                setGlobals((g) => ({ ...g, revenueFeePct: clamp(safeNum(e.target.value), 0, 100) }))
              }
            />
          </div>

          <div style={styles.col3}>
            <div style={styles.label}>Company Overhead (Monthly)</div>
            <input
              style={styles.input}
              type="number"
              step={100}
              value={globals.companyOverheadMonthly}
              onChange={(e) =>
                setGlobals((g) => ({ ...g, companyOverheadMonthly: safeNum(e.target.value) }))
              }
            />
          </div>

          <div style={styles.col3}>
            <div style={styles.label}>Sales Tax %</div>
            <input
              style={styles.input}
              type="number"
              step={0.001}
              value={globals.salesTaxPct}
              onChange={(e) =>
                setGlobals((g) => ({ ...g, salesTaxPct: clamp(safeNum(e.target.value), 0, 100) }))
              }
              disabled={!globals.taxEnabled}
            />
          </div>

          <div style={styles.col3}>
            <div style={styles.label}>Tax Options</div>
            <div style={styles.checkboxRow}>
              <label style={styles.small}>
                <input
                  style={styles.checkbox}
                  type="checkbox"
                  checked={globals.taxEnabled}
                  onChange={(e) => setGlobals((g) => ({ ...g, taxEnabled: e.target.checked }))}
                />{" "}
                Enable tax
              </label>
              <label style={styles.small}>
                <input
                  style={styles.checkbox}
                  type="checkbox"
                  checked={globals.taxPassThrough}
                  onChange={(e) =>
                    setGlobals((g) => ({ ...g, taxPassThrough: e.target.checked }))
                  }
                  disabled={!globals.taxEnabled}
                />{" "}
                Tax is pass-through
              </label>
            </div>
            <div style={styles.help}>
              If pass-through, tax is shown but not counted in cash flow.
            </div>
          </div>
        </div>
      </div>

      {/* Months assumptions */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <h2 style={styles.h2}>Seasonality Assumptions (Jan–Dec)</h2>
          <div style={styles.small}>ADR + Utilization multipliers and days per month</div>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Month</th>
                <th style={styles.th}>Days</th>
                <th style={styles.th}>ADR Mult %</th>
                <th style={styles.th}>Util Mult %</th>
                <th style={styles.th}>Total Revenue</th>
                <th style={styles.th}>Cash Flow</th>
                <th style={styles.th}>Weighted Util</th>
              </tr>
            </thead>
            <tbody>
              {computed.monthRows.map((m, i) => (
                <tr key={m.label}>
                  <td style={styles.td}>
                    <b>{m.label}</b>
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 90 }}
                      type="number"
                      step={1}
                      value={months[i].days}
                      onChange={(e) => {
                        const v = clamp(safeNum(e.target.value, 0), 0, 31);
                        setMonths((prev) => prev.map((mm, idx) => (idx === i ? { ...mm, days: v } : mm)));
                      }}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 120 }}
                      type="number"
                      step={1}
                      value={months[i].adrMultPct}
                      onChange={(e) => {
                        const v = clamp(safeNum(e.target.value, 100), 0, 300);
                        setMonths((prev) =>
                          prev.map((mm, idx) => (idx === i ? { ...mm, adrMultPct: v } : mm))
                        );
                      }}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 120 }}
                      type="number"
                      step={1}
                      value={months[i].utilMultPct}
                      onChange={(e) => {
                        const v = clamp(safeNum(e.target.value, 100), 0, 300);
                        setMonths((prev) =>
                          prev.map((mm, idx) => (idx === i ? { ...mm, utilMultPct: v } : mm))
                        );
                      }}
                    />
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalRevenue)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>
                    <span style={m.cashFlow >= 0 ? styles.pillGood : styles.pillBad}>
                      ${money(m.cashFlow)}
                    </span>
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>{pct(m.weightedUtilPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vehicles */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <h2 style={styles.h2}>Fleet (Vehicles)</h2>
          <div style={styles.small}>
            Each row is one vehicle. Duplicate vehicles to model multiple identical units.
          </div>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Vehicle</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Base ADR ($)</th>
                <th style={styles.th}>Base Util %</th>
                <th style={styles.th}>Fixed Monthly ($)</th>
                <th style={styles.th}>Var / Day ($)</th>
                <th style={styles.th}>Maint Reserve ($)</th>
                <th style={styles.th}>Notes</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, idx) => (
                <tr key={v.id}>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, minWidth: 140 }}
                      value={v.name}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) => (x.id === v.id ? { ...x, name: e.target.value } : x))
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, minWidth: 180 }}
                      value={v.category}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) =>
                            x.id === v.id ? { ...x, category: e.target.value } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 120 }}
                      type="number"
                      step={1}
                      value={v.baseAdr}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) => (x.id === v.id ? { ...x, baseAdr: safeNum(e.target.value) } : x))
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 120 }}
                      type="number"
                      step={0.5}
                      value={v.baseUtilPct}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) =>
                            x.id === v.id
                              ? { ...x, baseUtilPct: clamp(safeNum(e.target.value), 0, 100) }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 140 }}
                      type="number"
                      step={10}
                      value={v.fixedMonthly}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) =>
                            x.id === v.id ? { ...x, fixedMonthly: safeNum(e.target.value) } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 120 }}
                      type="number"
                      step={1}
                      value={v.variablePerDay}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) =>
                            x.id === v.id ? { ...x, variablePerDay: safeNum(e.target.value) } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, maxWidth: 140 }}
                      type="number"
                      step={10}
                      value={v.maintenanceReserve}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) =>
                            x.id === v.id
                              ? { ...x, maintenanceReserve: safeNum(e.target.value) }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.input, minWidth: 220 }}
                      value={v.notes}
                      onChange={(e) =>
                        setVehicles((prev) =>
                          prev.map((x) => (x.id === v.id ? { ...x, notes: e.target.value } : x))
                        )
                      }
                    />
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={styles.btn} onClick={() => duplicateVehicle(v.id)}>
                        Duplicate
                      </button>
                      <button
                        style={styles.btn}
                        onClick={() => deleteVehicle(v.id)}
                        disabled={vehicles.length <= 1}
                        title={vehicles.length <= 1 ? "Keep at least one row" : "Delete"}
                      >
                        Delete
                      </button>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                      Row {idx + 1} / {vehicles.length}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.help}>
          Tip: Model multiple identical vehicles by duplicating rows (e.g., “Suburban 1”, “Suburban
          2”…). This keeps per-vehicle costs flexible.
        </div>
      </div>

      {/* Forecast totals */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <h2 style={styles.h2}>12-Month Forecast (Company Totals)</h2>
          <div style={styles.small}>Revenue → Fees → Variable → Vehicle Fixed → Overhead → Cash Flow</div>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Month</th>
                <th style={styles.th}>Revenue</th>
                <th style={styles.th}>Fees</th>
                <th style={styles.th}>Variable</th>
                <th style={styles.th}>Vehicle Fixed</th>
                <th style={styles.th}>Contribution</th>
                <th style={styles.th}>Overhead</th>
                <th style={styles.th}>Cash Flow</th>
                {globals.taxEnabled && <th style={styles.th}>Tax Collected</th>}
              </tr>
            </thead>
            <tbody>
              {computed.monthRows.map((m) => (
                <tr key={m.label}>
                  <td style={styles.td}>
                    <b>{m.label}</b>
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalRevenue)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalFees)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalVariable)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalVehicleFixed)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.totalContribution)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.overhead)}</td>
                  <td style={{ ...styles.td, ...styles.tdRight }}>
                    <span style={m.cashFlow >= 0 ? styles.pillGood : styles.pillBad}>
                      ${money(m.cashFlow)}
                    </span>
                  </td>
                  {globals.taxEnabled && (
                    <td style={{ ...styles.td, ...styles.tdRight }}>${money(m.taxCollected)}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...styles.td, fontWeight: 800 }}>Annual</td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.revenue)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.fees)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.variable)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.vehicleFixed)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.contribution)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.overhead)}
                </td>
                <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                  ${money(computed.annual.cashFlow)}
                </td>
                {globals.taxEnabled && (
                  <td style={{ ...styles.td, ...styles.tdRight, fontWeight: 800 }}>
                    ${money(computed.annual.taxCollected)}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={styles.help}>
          Cash Flow here is an “EBITDA-ish” view (Contribution - Overhead). Add more rows or split
          insurance into vehicle fixed vs overhead based on how you track it.
        </div>
      </div>
    </div>
  );
}
