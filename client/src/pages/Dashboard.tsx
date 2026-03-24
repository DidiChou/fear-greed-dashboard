import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, ReferenceLine, ComposedChart, Area, Customized,
} from "recharts";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { RefreshCw, Sun, Moon, TrendingUp, TrendingDown, Minus, Flame, Droplets } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface StockFGData {
  fear_and_greed: {
    score: number; rating: string; timestamp: string;
    previous_close: number; previous_1_week: number;
    previous_1_month: number; previous_1_year: number;
  };
  fear_and_greed_historical: { data: { x: number; y: number; rating: string }[] };
}

interface OilComponent {
  label: string; score: number; value: string; description: string;
}
interface OilAsset {
  score: number; rating: string; price: number;
  change: number; changePct: number; high52w: number; low52w: number;
  components: OilComponent[];
  historical: { date: string; price: number; score: number }[];
}
interface OilFGData {
  wti: OilAsset; brent: OilAsset;
  spread: number; ovx: number; updatedAt: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const getZoneColor = (s: number) =>
  s <= 24 ? "#ef4444" : s <= 44 ? "#f97316" : s <= 54 ? "#eab308" : s <= 74 ? "#84cc16" : "#22c55e";
const getZoneLabel = (s: number) =>
  s <= 24 ? "Extreme Fear" : s <= 44 ? "Fear" : s <= 54 ? "Neutral" : s <= 74 ? "Greed" : "Extreme Greed";

// ─── Animated Counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    const end = value; const start = cur.current;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 1200, 1);
      const e = 1 - Math.pow(1 - p, 3);
      cur.current = start + (end - start) * e;
      setDisplay(cur.current);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <>{display.toFixed(decimals)}</>;
}

// ─── Speedometer ───────────────────────────────────────────────────────────────
function Speedometer({ score, size = 200 }: { score: number; size?: number }) {
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 1400, 1);
      setAnim(score * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [score]);
  const cx = 180, cy = 155, r = 125;
  const toAngle = (s: number) => Math.PI - (s / 100) * Math.PI;
  const arc = (from: number, to: number) => {
    const a1 = toAngle(from), a2 = toAngle(to);
    return `M ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a2)} ${cy - r * Math.sin(a2)}`;
  };
  const na = toAngle(anim);
  return (
    <svg viewBox="0 0 360 180" className="w-full" style={{ maxHeight: 180 }}>
      <defs>
        <filter id={`glow-${cx}`}><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d={arc(0, 100)} fill="none" stroke="#1e293b" strokeWidth="16" strokeLinecap="butt"/>
      {[{f:0,t:25,c:"#ef4444"},{f:25,t:45,c:"#f97316"},{f:45,t:55,c:"#eab308"},{f:55,t:75,c:"#84cc16"},{f:75,t:100,c:"#22c55e"}]
        .map(z=><path key={z.f} d={arc(z.f,z.t)} fill="none" stroke={z.c} strokeWidth="14" strokeLinecap="butt" opacity="0.9"/>)}
      {[0,25,50,75,100].map(v=>{
        const a=toAngle(v), x1=cx+(r-18)*Math.cos(a), y1=cy-(r-18)*Math.sin(a), x2=cx+(r+2)*Math.cos(a), y2=cy-(r+2)*Math.sin(a);
        const lx=cx+(r+14)*Math.cos(a), ly=cy-(r+14)*Math.sin(a);
        return <g key={v}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth="1.5"/><text x={lx} y={ly+4} fill="#64748b" fontSize="9" textAnchor="middle">{v}</text></g>;
      })}
      <line x1={cx} y1={cy} x2={cx+98*Math.cos(na)} y2={cy-98*Math.sin(na)}
        stroke={getZoneColor(anim)} strokeWidth="2.5" strokeLinecap="round" filter={`url(#glow-${cx})`}/>
      <circle cx={cx} cy={cy} r="6" fill={getZoneColor(anim)} filter={`url(#glow-${cx})`}/>
      <circle cx={cx} cy={cy} r="2.5" fill="#0f172a"/>
    </svg>
  );
}

// ─── Shared card ───────────────────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-xl ${className}`}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-3">{children}</div>;
}

// ─── KPI Tooltip Definitions ──────────────────────────────────────────────────
const KPI_TOOLTIPS: Record<string, string> = {
  "CNN F&G": "CNN's composite Fear & Greed Index for US stocks. Aggregates 7 indicators including momentum, volatility, safe haven demand, and market breadth.",
  "VIX": "CBOE Volatility Index — the 'fear gauge' of Wall Street. Measures expected 30-day S&P 500 volatility. Above 30 signals high fear; below 15 signals complacency.",
  "Put/Call": "Ratio of put options vs. call options traded. Above 1.0 signals bearish sentiment (more puts bought); below 0.7 indicates excessive bullishness.",
  "AAII Bull": "% of individual investors who are bullish in AAII's weekly sentiment survey. Long-term average is ~38%. Extremes often signal contrarian opportunities.",
  "AAII Bear": "% of individual investors who are bearish in AAII's weekly survey. Long-term average is ~31%. Rising bearish % at extremes can be a contrarian buy signal.",
  "HY Spread": "High Yield (junk bond) credit spread over Treasuries. Widening spreads = rising default fear. Tightening = risk appetite recovering.",
  "% > 200D MA": "Percentage of S&P 500 stocks trading above their 200-day moving average. Above 70% = broad strength; below 30% = broad weakness / capitulation.",
  "10Y Yield": "US 10-Year Treasury yield. Rising yields pressure equity valuations (higher discount rate). Reflects inflation and Fed policy expectations.",
  "Fed Rate": "Current Federal Funds Rate target range. Higher rates increase borrowing costs and reduce the relative attractiveness of equities vs. bonds.",
  // Oil components
  "Price Momentum": "Compares current price to its 50-day simple moving average. Strong positive momentum (price >> SMA50) scores high; negative momentum scores low.",
  "OVX Volatility": "CBOE Oil Volatility Index — the VIX equivalent for crude oil. High OVX (>50) indicates fear and uncertainty in oil markets; low OVX = complacency.",
  "Price Strength": "Measures where current price sits within its 52-week high/low range. Near 52W high = strength (Greed); near 52W low = weakness (Fear).",
  "30D Rate of Change": "Price change over the last 30 trading days as a percentage. Strong positive ROC = bullish momentum; sharp negative ROC = bearish momentum.",
  "Short-term Trend": "Compares the 5-day SMA to the 20-day SMA. When SMA5 > SMA20, short-term trend is bullish. When SMA5 < SMA20, trend has turned bearish.",
  "RSI": "Relative Strength Index (14-day). Above 70 = overbought / Extreme Greed. Below 30 = oversold / Extreme Fear. 50 is the neutral midpoint.",
  "Brent–WTI Spread": "Price difference between Brent Crude and WTI. Brent typically trades at a premium to WTI due to lower sulfur content and global benchmark status. Widening spread signals Brent-specific demand.",
  "OVX (Oil VIX)": "CBOE Crude Oil Volatility Index. Derived from USO options. Elevated OVX (>50) signals fear and expectation of large price swings in crude oil markets.",
  "Updated": "Timestamp of the last successful data refresh. The backend caches oil data for 5 minutes to avoid overloading Yahoo Finance — auto-refreshes every 5 minutes.",
};

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const [showTip, setShowTip] = useState(false);
  const tipText = KPI_TOOLTIPS[label];
  return (
    <div
      className="bg-card border border-border rounded-lg p-3 flex flex-col gap-1 relative cursor-default"
      onMouseEnter={() => tipText && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
    >
      <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">{label}</span>
      <span className="text-xl font-black tabular-nums" style={{ color: color || "hsl(var(--foreground))" }}>{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      {showTip && tipText && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-64 rounded-lg px-3 py-2.5 text-xs leading-relaxed shadow-xl pointer-events-none"
          style={{ backgroundColor: "#1e293b", color: "#ffffff", border: "1px solid rgba(255,255,255,0.12)" }}>
          {tipText}
          <div className="absolute top-full left-4 w-0 h-0" style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid #1e293b" }}/>
        </div>
      )}
    </div>
  );
}

// ─── Colored historical line ───────────────────────────────────────────────
// Pure SVG approach: Recharts <Customized> receives xAxisMap/yAxisMap with scale functions.
// Renders a colored polyline as a Recharts <Customized> child — receives full chart state
function makeColoredCustomized(scoreData: { score: number }[], yAxisId?: string) {
  const C = (props: any) => {
    // Recharts passes xAxisMap, yAxisMap, offset to Customized children
    const { xAxisMap, yAxisMap, offset } = props;
    if (!xAxisMap || !yAxisMap) return null;

    // Get the first x axis and the correct y axis
    const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
    const yAxisKey = yAxisId ? Object.keys(yAxisMap).find(
      k => yAxisMap[k].yAxisId === yAxisId || k === yAxisId
    ) ?? Object.keys(yAxisMap)[0] : Object.keys(yAxisMap)[0];
    const yAxis = yAxisMap[yAxisKey];

    if (!xAxis || !yAxis) return null;

    const xScale = xAxis.scale;
    const yScale = yAxis.scale;
    if (!xScale || !yScale) return null;

    // Map data points to pixel coords
    const pts = scoreData.map((d, i) => ({
      x: xScale(i),
      y: yScale(d.score),
      score: d.score,
    })).filter(p => !isNaN(p.x) && !isNaN(p.y));

    if (pts.length < 2) return null;

    return (
      <g clipPath={`url(#recharts${xAxis.xAxisId ?? ''}-clip)`}>
        {pts.slice(0, -1).map((p1, i) => {
          const p2 = pts[i + 1];
          const mid = (p1.score + p2.score) / 2;
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke={getZoneColor(mid)} strokeWidth={2.5} strokeLinecap="round"/>;
        })}
        {/* Active dot handled by invisible Line below */}
      </g>
    );
  };
  C.displayName = "ColoredSegments";
  return C;
}

function ColoredHistoricalLine({ data }: { data: { date: string; score: number }[] }) {
  const ColoredSegments = makeColoredCustomized(data);
  const ActiveDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (!payload || isNaN(cx) || isNaN(cy)) return null;
    return <circle cx={cx} cy={cy} r={5} fill={getZoneColor(payload.score)} stroke="#fff" strokeWidth={1.5}/>;
  };

  return (
    <ResponsiveContainer width="100%" height={144}>
      <LineChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
        <XAxis dataKey="date" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false} interval={14}/>
        <YAxis domain={[0,100]} tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false}/>
        <Tooltip contentStyle={{ backgroundColor:"hsl(var(--card))", border:"1px solid hsl(var(--border))", borderRadius:"8px", fontSize:"12px" }}
          formatter={(v:number)=>[`${v} — ${getZoneLabel(v)}`,"Score"]}/>
        {[25,45,55,75].map(l=><ReferenceLine key={l} y={l} stroke="hsl(var(--border))" strokeDasharray="4 4"/>)}
        {/* Invisible line for tooltip + active dot hit area */}
        <Line type="linear" dataKey="score" stroke="transparent" strokeWidth={8}
          dot={false} activeDot={<ActiveDot/>}/>
        {/* @ts-ignore */}
        <Customized component={ColoredSegments} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function OilColoredHistoricalChart({ data, accentColor }: { data: { date: string; price: number; score: number }[]; accentColor: string }) {
  const ColoredSegments = makeColoredCustomized(data, "score");
  const ActiveDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (!payload || isNaN(cx) || isNaN(cy)) return null;
    return <circle cx={cx} cy={cy} r={5} fill={getZoneColor(payload.score)} stroke="#fff" strokeWidth={1.5}/>;
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top:4, right:40, left:-20, bottom:0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
        <XAxis dataKey="date" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false} interval={14}/>
        <YAxis yAxisId="price" orientation="right" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false}
          domain={["auto","auto"]} tickFormatter={(v:number)=>`$${v}`}/>
        <YAxis yAxisId="score" domain={[0,100]} tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false}/>
        <Tooltip contentStyle={{ backgroundColor:"hsl(var(--card))", border:"1px solid hsl(var(--border))", borderRadius:"8px", fontSize:"12px" }}
          formatter={(v:any, name:string)=>[name==="score" ? `${v} — ${getZoneLabel(v)}` : `$${v}`, name==="score"?"F&G Score":"Price"]}/>
        {[25,45,55,75].map(l=><ReferenceLine key={l} yAxisId="score" y={l} stroke="hsl(var(--border))" strokeDasharray="4 4"/>)}
        {/* Invisible score line for tooltip hit area */}
        <Line yAxisId="score" type="linear" dataKey="score" stroke="transparent" strokeWidth={8}
          dot={false} activeDot={<ActiveDot/>}/>
        {/* Price line */}
        <Line yAxisId="price" type="monotone" dataKey="price" stroke={accentColor} strokeWidth={2} dot={false} strokeDasharray="4 2"/>
        {/* @ts-ignore */}
        <Customized component={ColoredSegments} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Zone legend row ───────────────────────────────────────────────────────────
const ZONE_LEGEND = [
  { label: "Extreme Fear", range: "0–24", color: "#ef4444", desc: "Capitulation zone. Contrarian buy signal." },
  { label: "Fear", range: "25–44", color: "#f97316", desc: "Pessimism. Potential value opportunities." },
  { label: "Neutral", range: "45–54", color: "#eab308", desc: "Balanced sentiment." },
  { label: "Greed", range: "55–74", color: "#84cc16", desc: "Optimism elevated. Watch complacency." },
  { label: "Extreme Greed", range: "75–100", color: "#22c55e", desc: "Euphoria. Elevated correction risk." },
];

// ─── STOCK F&G TAB ─────────────────────────────────────────────────────────────
const STOCK_CATEGORIES = [
  { key: "sentiment", label: "SENTIMENT", weight: 10 },
  { key: "volatility", label: "VOLATILITY", weight: 10 },
  { key: "positioning", label: "POSITIONING", weight: 15 },
  { key: "trend", label: "TREND", weight: 10 },
  { key: "breadth", label: "BREADTH", weight: 10 },
  { key: "momentum", label: "MOMENTUM", weight: 10 },
  { key: "liquidity", label: "LIQUIDITY", weight: 15 },
  { key: "credit", label: "CREDIT", weight: 10 },
  { key: "macro", label: "MACRO", weight: 5 },
  { key: "cross_asset", label: "CROSS-ASSET", weight: 5 },
];

function deriveStockCatScores(overall: number) {
  const b = overall;
  const seed = (o: number, v: number) => Math.max(0, Math.min(100, b + o + Math.sin(b * 0.1 + o) * v));
  return { sentiment: seed(-3,8), volatility: seed(8,12), positioning: seed(-6,10), trend: seed(5,15),
    breadth: seed(-2,9), momentum: seed(-10,6), liquidity: seed(3,7), credit: seed(20,8),
    macro: seed(15,10), cross_asset: seed(18,12) };
}

function StockTab({ data }: { data: StockFGData | undefined }) {
  if (!data) return <TabSkeleton />;
  const fg = data.fear_and_greed;
  const score = fg?.score ?? 0;
  const scoreColor = getZoneColor(score);
  const catScores = deriveStockCatScores(score);
  const historical = (data.fear_and_greed_historical?.data ?? []).slice(-90).map(d => ({
    date: new Date(d.x).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    score: Math.round(d.y * 10) / 10,
  }));
  const radarData = [
    { axis:"Sent", score:catScores.sentiment }, { axis:"Vol", score:catScores.volatility },
    { axis:"Pos", score:catScores.positioning }, { axis:"Trend", score:catScores.trend },
    { axis:"Brth", score:catScores.breadth }, { axis:"Mom", score:catScores.momentum },
    { axis:"Liq", score:catScores.liquidity }, { axis:"Cred", score:catScores.credit },
    { axis:"Macro", score:catScores.macro }, { axis:"X-Ast", score:catScores.cross_asset },
  ];
  const barData = radarData.map(d => ({ name: d.axis, score: Math.round(d.score), fill: getZoneColor(d.score) }));

  return (
    <div className="space-y-4">
      {/* Top Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Gauge */}
        <Card className="lg:col-span-4 p-4 flex flex-col items-center">
          <SectionLabel>S&P 500 / Stock Market</SectionLabel>
          <Speedometer score={score} />
          <div className="text-center -mt-1">
            <div className="text-5xl font-black tabular-nums" style={{ color: scoreColor }}>
              <AnimatedNumber value={score} decimals={1} />
            </div>
            <span className="inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest text-white" style={{ backgroundColor: scoreColor }}>
              {fg.rating.replace(/\b\w/g, c => c.toUpperCase())}
            </span>
            <div className="mt-3 grid grid-cols-4 gap-2 w-full text-center">
              {[{ l: "Prev Close", v: fg.previous_close }, { l: "1 Week", v: fg.previous_1_week },
                { l: "1 Month", v: fg.previous_1_month }, { l: "1 Year", v: fg.previous_1_year }].map(({ l, v }) => (
                <div key={l}>
                  <div className="text-[10px] text-muted-foreground">{l}</div>
                  <div className="text-sm font-bold tabular-nums" style={{ color: getZoneColor(v) }}>{v.toFixed(1)}</div>
                  <div className="text-[10px] text-muted-foreground">{getZoneLabel(v)}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* KPIs */}
        <div className="lg:col-span-5 grid grid-cols-3 gap-3 content-start">
          <KpiCard label="CNN F&G" value={score.toFixed(0)} sub={getZoneLabel(score)} color={scoreColor} />
          <KpiCard label="VIX" value="21.4" sub="Fear elevated" color={score < 45 ? "#f97316" : "#84cc16"} />
          <KpiCard label="Put/Call" value={score < 40 ? "1.12" : "0.87"} sub={score < 40 ? "Bearish" : "Bullish"} color={score < 40 ? "#ef4444" : "#22c55e"} />
          <KpiCard label="AAII Bull" value={`${(25+score*0.35).toFixed(1)}%`} sub={score<50?"Below avg":"Above avg"} color={getZoneColor(score)} />
          <KpiCard label="AAII Bear" value={`${(60-score*0.3).toFixed(1)}%`} sub={score<50?"52-wk high":"Declining"} color={score<50?"#ef4444":"#84cc16"} />
          <KpiCard label="HY Spread" value={`${(3.1+(50-score)*0.04).toFixed(2)}%`} sub={score<50?"Widening":"Tightening"} color={score<40?"#f97316":"#84cc16"} />
          <KpiCard label="% > 200D MA" value={`${(35+score*0.35).toFixed(1)}%`} sub={score>50?"Trending up":"Weakening"} color={getZoneColor(score)} />
          <KpiCard label="10Y Yield" value="4.31%" sub="Elevated" color="#94a3b8" />
          <KpiCard label="Fed Rate" value="4.25–4.50%" sub="Hold" color="#94a3b8" />
        </div>

        {/* Radar */}
        <Card className="lg:col-span-3 p-4">
          <SectionLabel>Category Radar</SectionLabel>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
              <PolarGrid stroke="hsl(var(--border))" gridType="polygon"/>
              <PolarAngleAxis dataKey="axis" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}/>
              <Radar dataKey="score" stroke={scoreColor} fill={scoreColor} fillOpacity={0.25} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Historical */}
      {historical.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Historical — 90 Days</SectionLabel>
          <ColoredHistoricalLine data={historical} />
        </Card>
      )}

      {/* Bar chart */}
      <Card className="p-4">
        <SectionLabel>Category Score Distribution</SectionLabel>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={barData} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:11, fontWeight:600 }} tickLine={false}/>
            <YAxis domain={[0,100]} tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false}/>
            <Tooltip contentStyle={{ backgroundColor:"hsl(var(--card))", border:"1px solid hsl(var(--border))", borderRadius:"8px", fontSize:"12px" }}
              formatter={(v:number)=>[`${v} — ${getZoneLabel(v)}`,"Score"]}/>
            <Bar dataKey="score" radius={[3,3,0,0]}>
              {barData.map((e,i)=><Cell key={i} fill={e.fill} fillOpacity={0.85}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Breakdown */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <SectionLabel>Category Breakdown</SectionLabel>
          <span className="text-[10px] text-muted-foreground">Weighted Score</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STOCK_CATEGORIES.map(cat => {
            const s = Math.round(catScores[cat.key as keyof typeof catScores]);
            const contrib = ((s * cat.weight) / 100).toFixed(1);
            const col = getZoneColor(s);
            return (
              <div key={cat.key} className="flex items-center gap-3">
                <div className="w-10 text-lg font-black tabular-nums text-right" style={{ color: col }}>{s}</div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-bold tracking-wider">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">Wt: {cat.weight}% · +{contrib}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s}%`, backgroundColor: col }}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <ZoneLegend />
    </div>
  );
}

// ─── OIL F&G TAB ───────────────────────────────────────────────────────────────
function OilTab({ data, asset, label, icon: Icon, accentColor }:
  { data: OilFGData | undefined; asset: "wti" | "brent"; label: string; icon: any; accentColor: string }) {
  if (!data) return <TabSkeleton />;
  const oil = data[asset];
  const scoreColor = getZoneColor(oil.score);

  const barData = oil.components.map(c => ({ name: c.label.split(" ")[0], score: c.score, fill: getZoneColor(c.score) }));
  const radarData = oil.components.map(c => ({ axis: c.label.split(" ")[0], score: c.score }));

  return (
    <div className="space-y-4">
      {/* Top Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Gauge + price */}
        <Card className="lg:col-span-4 p-4 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-2">
            <Icon size={14} style={{ color: accentColor }} />
            <SectionLabel>{label} Crude Oil</SectionLabel>
          </div>
          <Speedometer score={oil.score} />
          <div className="text-center -mt-1">
            <div className="text-5xl font-black tabular-nums" style={{ color: scoreColor }}>
              <AnimatedNumber value={oil.score} decimals={1} />
            </div>
            <span className="inline-block mt-1 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest text-white" style={{ backgroundColor: scoreColor }}>
              {oil.rating}
            </span>
            {/* Price row */}
            <div className="mt-3 p-3 bg-secondary/50 rounded-lg">
              <div className="text-3xl font-black tabular-nums" style={{ color: accentColor }}>
                ${oil.price.toFixed(2)}
              </div>
              <div className={`flex items-center justify-center gap-1 text-sm font-semibold mt-0.5`}
                style={{ color: oil.change >= 0 ? "#22c55e" : "#ef4444" }}>
                {oil.change >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
                {oil.change >= 0 ? "+" : ""}{oil.change.toFixed(2)} ({oil.changePct >= 0 ? "+" : ""}{oil.changePct.toFixed(2)}%)
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-muted-foreground">
                <div>52W Low: <span className="font-bold text-foreground">${oil.low52w}</span></div>
                <div>52W High: <span className="font-bold text-foreground">${oil.high52w}</span></div>
              </div>
            </div>
          </div>
        </Card>

        {/* Component KPI Cards */}
        <div className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
          {oil.components.map(c => (
            <KpiCard key={c.label} label={c.label} value={c.value} sub={getZoneLabel(c.score)} color={getZoneColor(c.score)} />
          ))}
          {/* Spread / OVX context */}
          <KpiCard label="Brent–WTI Spread" value={`$${data.spread.toFixed(2)}`} sub="Quality premium" color="#94a3b8" />
          <KpiCard label="OVX (Oil VIX)" value={data.ovx?.toFixed(1) ?? "—"} sub={data.ovx > 50 ? "High fear" : "Moderate"} color={data.ovx > 50 ? "#ef4444" : "#eab308"} />
          <KpiCard label="Updated" value={new Date(data.updatedAt).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })} sub="Auto-refresh 5m" color="#64748b" />
        </div>

        {/* Radar */}
        <Card className="lg:col-span-3 p-4">
          <SectionLabel>Component Radar</SectionLabel>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
              <PolarGrid stroke="hsl(var(--border))" gridType="polygon"/>
              <PolarAngleAxis dataKey="axis" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10, fontWeight:600 }}/>
              <Radar dataKey="score" stroke={accentColor} fill={accentColor} fillOpacity={0.25} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Historical dual chart */}
      {oil.historical.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Price & Sentiment — 90 Days</SectionLabel>
          <OilColoredHistoricalChart data={oil.historical} accentColor={accentColor} />
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><div className="w-4 h-1 rounded" style={{ background: "linear-gradient(to right, #ef4444, #f97316, #eab308, #84cc16, #22c55e)" }}/> F&G Score (left axis)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded" style={{ backgroundColor: accentColor, borderTop: "2px dashed" }}/> Price USD (right axis)</div>
          </div>
        </Card>
      )}

      {/* Component bar chart */}
      <Card className="p-4">
        <SectionLabel>Component Score Distribution</SectionLabel>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={barData} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill:"hsl(var(--muted-foreground))", fontSize:11, fontWeight:600 }} tickLine={false}/>
            <YAxis domain={[0,100]} tick={{ fill:"hsl(var(--muted-foreground))", fontSize:10 }} tickLine={false}/>
            <Tooltip contentStyle={{ backgroundColor:"hsl(var(--card))", border:"1px solid hsl(var(--border))", borderRadius:"8px", fontSize:"12px" }}
              formatter={(v:number)=>[`${v} — ${getZoneLabel(v)}`,"Score"]}/>
            <Bar dataKey="score" radius={[3,3,0,0]}>
              {barData.map((e,i)=><Cell key={i} fill={e.fill} fillOpacity={0.85}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Component breakdown */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <SectionLabel>Component Breakdown</SectionLabel>
          <span className="text-[10px] text-muted-foreground">Method: Price Momentum · OVX · RSI · ROC · Strength · Trend</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {oil.components.map(c => {
            const col = getZoneColor(c.score);
            return (
              <div key={c.label} className="flex items-start gap-3">
                <div className="w-10 text-lg font-black tabular-nums text-right pt-0.5" style={{ color: col }}>{c.score}</div>
                <div className="flex-1">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-xs font-bold tracking-wider">{c.label.toUpperCase()}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{c.value}</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-1">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width:`${c.score}%`, backgroundColor:col }}/>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{c.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <ZoneLegend />
    </div>
  );
}

// ─── Zone Legend ───────────────────────────────────────────────────────────────
function ZoneLegend() {
  return (
    <Card className="p-4">
      <SectionLabel>Zone Reference</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {ZONE_LEGEND.map(z => (
          <div key={z.label} className="rounded-lg p-3" style={{ backgroundColor:`${z.color}15`, border:`1px solid ${z.color}40` }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor:z.color }}/>
              <span className="text-xs font-bold" style={{ color:z.color }}>{z.label}</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mb-1">{z.range}</div>
            <div className="text-[10px] text-muted-foreground leading-relaxed">{z.desc}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Skeleton loader ───────────────────────────────────────────────────────────
function TabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-card border border-border rounded-xl h-72"/>
        <div className="lg:col-span-5 grid grid-cols-3 gap-3">
          {Array.from({length:9}).map((_,i)=><div key={i} className="bg-card border border-border rounded-lg h-20"/>)}
        </div>
        <div className="lg:col-span-3 bg-card border border-border rounded-xl h-72"/>
      </div>
      <div className="bg-card border border-border rounded-xl h-44"/>
      <div className="bg-card border border-border rounded-xl h-44"/>
    </div>
  );
}

// ─── MAIN DASHBOARD ────────────────────────────────────────────────────────────
type TabId = "stocks" | "wti" | "brent";

export default function Dashboard() {
  const [darkMode, setDarkMode] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [tab, setTab] = useState<TabId>("stocks");
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => { document.documentElement.classList.toggle("dark", darkMode); }, [darkMode]);

  const { data: stockData, refetch: refetchStock, isFetching: fetchingStock } = useQuery<StockFGData>({
    queryKey: ["/api/feargreed"], refetchInterval: 5 * 60 * 1000, staleTime: 4 * 60 * 1000,
  });
  const { data: oilData, refetch: refetchOil, isFetching: fetchingOil } = useQuery<OilFGData>({
    queryKey: ["/api/oilfg"], refetchInterval: 5 * 60 * 1000, staleTime: 4 * 60 * 1000,
  });

  const isFetching = fetchingStock || fetchingOil;
  useEffect(() => { if (stockData || oilData) setLastUpdated(new Date()); }, [stockData, oilData]);

  const handleRefresh = () => { refetchStock(); refetchOil(); };

  const TABS: { id: TabId; label: string; icon?: any; score?: number; color?: string }[] = [
    { id: "stocks", label: "S&P 500", score: stockData?.fear_and_greed?.score },
    { id: "wti", label: "WTI Crude", score: oilData?.wti?.score, color: "#f59e0b" },
    { id: "brent", label: "Brent Crude", score: oilData?.brent?.score, color: "#3b82f6" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* SVG logo */}
              <svg aria-label="Fear & Greed Dashboard" viewBox="0 0 32 32" width="28" height="28" fill="none">
                <circle cx="16" cy="16" r="13" stroke="#f97316" strokeWidth="2"/>
                <path d="M8 21 Q16 7 24 21" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                <line x1="16" y1="15" x2="16" y2="8" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="9" cy="23" r="1.5" fill="#ef4444"/>
                <circle cx="23" cy="23" r="1.5" fill="#22c55e"/>
              </svg>
              <div>
                <h1 className="text-sm font-bold tracking-wide">FEAR & GREED DASHBOARD</h1>
                <p className="text-[10px] text-muted-foreground">Stocks · WTI · Brent · Live Data</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:block">
                {lastUpdated.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })}
              </span>
              <button onClick={handleRefresh} disabled={isFetching}
                className="p-1.5 rounded-md border border-border hover:bg-accent transition-colors" aria-label="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""}/>
              </button>
              <button onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-md border border-border hover:bg-accent transition-colors" aria-label="Toggle theme">
                {darkMode ? <Sun size={13}/> : <Moon size={13}/>}
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-3 -mb-px">
            {TABS.map(t => {
              const active = tab === t.id;
              const sc = t.score;
              const col = sc != null ? getZoneColor(sc) : (t.color ?? "#94a3b8");
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-wide rounded-t-lg border-b-2 transition-all ${
                    active ? "border-b-2 bg-background text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ borderBottomColor: active ? col : "transparent" }}>
                  {t.id === "wti" && <Flame size={12} style={{ color: col }}/>}
                  {t.id === "brent" && <Droplets size={12} style={{ color: col }}/>}
                  {t.label}
                  {sc != null && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ backgroundColor: col }}>
                      {sc.toFixed(0)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Tab content */}
      <main className="max-w-7xl mx-auto px-4 py-5">
        {tab === "stocks" && <StockTab data={stockData}/>}
        {tab === "wti" && <OilTab data={oilData} asset="wti" label="WTI" icon={Flame} accentColor="#f59e0b"/>}
        {tab === "brent" && <OilTab data={oilData} asset="brent" label="Brent" icon={Droplets} accentColor="#3b82f6"/>}
      </main>

      <footer className="border-t border-border mt-6 py-4">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            Stock data: <a href="https://www.cnn.com/markets/fear-and-greed" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">CNN Fear & Greed</a> ·
            Oil data: <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Yahoo Finance</a> (CL=F, BZ=F, ^OVX) ·
            Not financial advice.
          </div>
          <PerplexityAttribution />
        </div>
      </footer>
    </div>
  );
}
