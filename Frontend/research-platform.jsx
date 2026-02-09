import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

// ─── Demo Data ──────────────────────────────────────────────
const COMPANIES = {
  "삼성전자": { code: "005930", sector: "반도체", price: "71,800", change: "+2.3%", marketCap: "428조" },
  "SK하이닉스": { code: "000660", sector: "반도체", price: "198,500", change: "+1.8%", marketCap: "144조" },
  "네이버": { code: "035420", sector: "플랫폼", price: "214,000", change: "-0.5%", marketCap: "35조" },
  "카카오": { code: "035720", sector: "플랫폼", price: "42,300", change: "+0.9%", marketCap: "19조" },
  "셀트리온": { code: "068270", sector: "바이오", price: "185,200", change: "+3.1%", marketCap: "25조" },
};

// Generate realistic stock data
function generateStockData() {
  const data = [];
  let price = 65000;
  const start = new Date("2024-07-01");
  for (let i = 0; i < 120; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const volatility = (Math.random() - 0.48) * 2500;
    price = Math.max(55000, Math.min(78000, price + volatility));
    const open = price + (Math.random() - 0.5) * 800;
    const high = Math.max(price, open) + Math.random() * 600;
    const low = Math.min(price, open) - Math.random() * 600;
    const vol = Math.floor(8000000 + Math.random() * 12000000);
    data.push({
      date: `${d.getMonth()+1}/${d.getDate()}`,
      fullDate: d.toISOString().slice(0, 10),
      close: Math.round(price),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      volume: vol,
    });
  }
  return data;
}

const STOCK_DATA = generateStockData();

// Events overlaid on chart
const CHART_EVENTS = [
  { date: "8/14", type: "earnings", label: "Q2 실적 발표", detail: "매출 74조 / 영업이익 10.4조" },
  { date: "9/3", type: "note", label: "IR 미팅 메모", detail: "HBM3E 양산 가속화 논의" },
  { date: "9/20", type: "news", label: "美 수출규제 완화 보도", detail: "일부 장비 수출 허가 발급" },
  { date: "10/8", type: "telegram", label: "텔레그램 급등 언급", detail: "3개 채널에서 동시 매수 언급" },
  { date: "10/28", type: "note", label: "Q3 실적 분석 노트", detail: "영업이익 9.18조, 컨센서스 상회" },
  { date: "10/31", type: "earnings", label: "Q3 실적 발표", detail: "매출 79.1조 / 영업이익 9.18조" },
  { date: "10/31", type: "news", label: "실적 관련 기사 클러스터", detail: "어닝 서프라이즈 보도 5건" },
  { date: "10/31", type: "telegram", label: "실적 발표 후 TG 급증", detail: "4개 채널 매수 언급 31건" },
  { date: "10/31", type: "report", label: "목표가 상향 리포트", detail: "NH투자증권 88,000원 → 매수" },
  { date: "9/20", type: "report", label: "수출규제 분석 리포트", detail: "미래에셋 반도체 수혜 분석" },
];

const EVENT_COLORS = {
  note: { bg: "#10b981", label: "노트" },
  news: { bg: "#3b82f6", label: "뉴스" },
  telegram: { bg: "#f59e0b", label: "텔레그램" },
  earnings: { bg: "#ef4444", label: "실적" },
  report: { bg: "#a78bfa", label: "리포트" },
};

const DEMO_NOTES = [
  { id: 1, title: "Q3 실적 분석", date: "2024-10-28", tags: ["실적", "반도체"], preview: "매출 79.1조원 (YoY +17.4%), 영업이익 9.18조원 (YoY +274%). HBM 매출 비중 확대...", source: "Evernote" },
  { id: 2, title: "HBM 경쟁력 비교 메모", date: "2024-09-03", tags: ["HBM", "경쟁분석"], preview: "SK하이닉스 HBM3E 12H 양산 vs 삼성 수율 이슈. NVIDIA 납품 점유율 격차 확대 중...", source: "Evernote" },
  { id: 3, title: "파운드리 GAA 기술 리뷰", date: "2024-08-20", tags: ["파운드리", "기술"], preview: "2nm GAA 공정 로드맵 점검. TSMC 대비 수율 격차 및 고객사 확보 현황...", source: "Evernote" },
];

// News with price impact scoring + clustering
const DEMO_NEWS_CLUSTERS = [
  {
    id: "c1",
    topic: "HBM3E 양산·납품",
    keyword: "HBM",
    date: "2024-11-08",
    priceImpact: +3.2, // % change within 2 days
    impactScore: 92, // 0-100
    sentiment: "positive",
    articles: [
      { id: 1, title: "삼성전자, HBM3E 12단 양산 본격화…엔비디아 납품 '초읽기'", source: "한국경제", date: "2024-11-08" },
      { id: 2, title: "삼성 HBM3E, 엔비디아 품질 테스트 통과 임박", source: "전자신문", date: "2024-11-08" },
      { id: 3, title: "HBM 전쟁 2라운드…삼성, SK하이닉스 추격 본격화", source: "매일경제", date: "2024-11-07" },
      { id: 4, title: "삼성전자 HBM3E 수율 80% 돌파…양산 자신감", source: "디지털타임스", date: "2024-11-07" },
    ],
  },
  {
    id: "c2",
    topic: "파운드리 2nm GAA",
    keyword: "파운드리",
    date: "2024-11-05",
    priceImpact: +1.8,
    impactScore: 68,
    sentiment: "positive",
    articles: [
      { id: 5, title: "삼성 파운드리, 2nm GAA 시험 양산 돌입…TSMC 추격", source: "매일경제", date: "2024-11-05" },
      { id: 6, title: "삼성전자, GAA 기술로 퀄컴·엔비디아 수주전", source: "한국경제", date: "2024-11-04" },
    ],
  },
  {
    id: "c3",
    topic: "중국 CXMT 메모리 증설",
    keyword: "경쟁",
    date: "2024-11-01",
    priceImpact: -2.1,
    impactScore: 78,
    sentiment: "negative",
    articles: [
      { id: 7, title: "中 CXMT, 메모리 증설 가속…삼성·하이닉스 긴장", source: "조선비즈", date: "2024-11-01" },
      { id: 8, title: "중국 반도체 굴기 재점화…DRAM 자급률 10% 돌파", source: "서울경제", date: "2024-11-01" },
      { id: 9, title: "美 추가 제재에도…CXMT 레거시 DRAM 양산 확대", source: "아시아경제", date: "2024-10-31" },
    ],
  },
  {
    id: "c4",
    topic: "Q3 실적 발표",
    keyword: "실적",
    date: "2024-10-31",
    priceImpact: +4.5,
    impactScore: 95,
    sentiment: "positive",
    articles: [
      { id: 10, title: "삼성전자 3분기 영업이익 9.18조…'어닝 서프라이즈'", source: "연합뉴스", date: "2024-10-31" },
      { id: 11, title: "삼성전자, 반도체 호황에 3Q 영업익 274% 급증", source: "한국경제", date: "2024-10-31" },
      { id: 12, title: "삼성전자 실적 발표…메모리 회복·HBM이 이끌었다", source: "매일경제", date: "2024-10-31" },
      { id: 13, title: "증권가 '삼성전자 목표가 상향 릴레이'…10만원 전망도", source: "머니투데이", date: "2024-10-31" },
      { id: 14, title: "[컨센서스] 삼성전자, 4분기 영업익 더 늘어난다", source: "이데일리", date: "2024-11-01" },
    ],
  },
  {
    id: "c5",
    topic: "갤럭시 AI 스마트폰",
    keyword: "모바일",
    date: "2024-10-25",
    priceImpact: +0.4,
    impactScore: 25,
    sentiment: "positive",
    articles: [
      { id: 15, title: "갤럭시 AI 기능 확대…프리미엄 스마트폰 시장 주도", source: "디지털타임스", date: "2024-10-25" },
      { id: 16, title: "삼성, 갤럭시 S25에 '온디바이스 AI' 대폭 강화", source: "ZDNet", date: "2024-10-24" },
    ],
  },
  {
    id: "c6",
    topic: "배당·주주환원 정책",
    keyword: "배당",
    date: "2024-10-22",
    priceImpact: +0.2,
    impactScore: 18,
    sentiment: "neutral",
    articles: [
      { id: 17, title: "삼성전자, 연간 배당 9.8조 유지…주주환원 기조 지속", source: "한국경제", date: "2024-10-22" },
    ],
  },
];

const NEWS_KEYWORDS = ["HBM", "파운드리", "실적", "경쟁", "모바일", "배당"];

const DEMO_TELEGRAM = [
  { id: 1, channel: "반도체투자연구소", date: "2024-11-09", mentions: 12, sentiment: "bullish", snippet: "HBM3E 양산 뉴스 긍정적. 목표가 상향 가능성" },
  { id: 2, channel: "주식고수모임", date: "2024-11-07", mentions: 8, sentiment: "neutral", snippet: "실적은 좋으나 파운드리 수율 우려 잔존" },
  { id: 3, channel: "AI반도체포럼", date: "2024-11-04", mentions: 23, sentiment: "bullish", snippet: "NVIDIA 차세대 GPU에 삼성 HBM 채택 기대감" },
  { id: 4, channel: "데일리마켓", date: "2024-10-31", mentions: 31, sentiment: "bullish", snippet: "Q3 실적 서프라이즈! 반도체 슈퍼사이클 진입 신호" },
];

const DEMO_FINANCIALS = {
  annual: [
    { year: "2022", revenue: "302.2", op: "43.4", np: "55.6", roe: "16.4" },
    { year: "2023", revenue: "258.9", op: "6.6", np: "15.5", roe: "4.3" },
    { year: "2024E", revenue: "310.0", op: "35.0", np: "28.0", roe: "8.8" },
    { year: "2025E", revenue: "352.0", op: "52.0", np: "42.0", roe: "12.1" },
  ],
  ratios: { per: "18.2", pbr: "1.4", div: "2.1%", eps: "3,945" },
};

const DEMO_REPORTS = [
  { id: 1, title: "삼성전자: HBM이 바꾸는 게임", broker: "미래에셋증권", date: "2024-11-06", target: "92,000", rating: "매수" },
  { id: 2, title: "3Q24 Review: 반도체 회복 본궤도", broker: "NH투자증권", date: "2024-11-01", target: "88,000", rating: "매수" },
  { id: 3, title: "파운드리 우려에도 반도체가 이끈다", broker: "삼성증권", date: "2024-10-15", target: "85,000", rating: "매수" },
];

const TELEGRAM_CHART = [
  { week: "9월 1주", mentions: 15 }, { week: "9월 2주", mentions: 22 },
  { week: "9월 3주", mentions: 18 }, { week: "9월 4주", mentions: 28 },
  { week: "10월 1주", mentions: 35 }, { week: "10월 2주", mentions: 20 },
  { week: "10월 3주", mentions: 42 }, { week: "10월 4주", mentions: 68 },
  { week: "11월 1주", mentions: 54 }, { week: "11월 2주", mentions: 38 },
];

// ─── Candlestick Chart Component ────────────────────────────
function CandlestickChart({ data, eventDots, visibleEvents, eventColors, onDotClick, indicators }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 400 });
  const [viewRange, setViewRange] = useState([0, data.length - 1]);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [hoveredDot, setHoveredDot] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const pad = { top: 20, right: 16, bottom: 28, left: 52 };
  const volumeH = 40; // height reserved for volume bars at bottom

  // Calculate Moving Averages over full data
  const maData = useMemo(() => {
    const calcMA = (period) => {
      return data.map((_, i) => {
        if (i < period - 1) return null;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
        return sum / period;
      });
    };
    return {
      ma5: indicators?.ma5?.enabled ? calcMA(5) : [],
      ma20: indicators?.ma20?.enabled ? calcMA(20) : [],
      ma60: indicators?.ma60?.enabled ? calcMA(60) : [],
      ma120: indicators?.ma120?.enabled ? calcMA(120) : [],
    };
  }, [data, indicators?.ma5?.enabled, indicators?.ma20?.enabled, indicators?.ma60?.enabled, indicators?.ma120?.enabled]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleData = useMemo(() => {
    const [s, e] = viewRange;
    return data.slice(s, e + 1);
  }, [data, viewRange]);

  const { minPrice, maxPrice, chartW, chartH, candleW } = useMemo(() => {
    const lows = visibleData.map(d => d.low);
    const highs = visibleData.map(d => d.high);
    // also account for event dot offsets
    const dotMaxes = eventDots
      .filter(ev => {
        const idx = data.findIndex(d => d.date === ev.date);
        return idx >= viewRange[0] && idx <= viewRange[1];
      })
      .map(ev => ev.yOffset);
    const allHighs = [...highs, ...dotMaxes];
    const min = Math.min(...lows) - 500;
    const max = Math.max(...allHighs) + 800;
    const cw = dims.w - pad.left - pad.right;
    const ch = dims.h - pad.top - pad.bottom;
    const candle = Math.max(2, Math.min(14, (cw / visibleData.length) * 0.7));
    return { minPrice: min, maxPrice: max, chartW: cw, chartH: ch, candleW: candle };
  }, [visibleData, dims, eventDots, data, viewRange]);

  const priceToY = useCallback((p) => {
    return pad.top + chartH - ((p - minPrice) / (maxPrice - minPrice)) * chartH;
  }, [chartH, minPrice, maxPrice]);

  const idxToX = useCallback((i) => {
    if (visibleData.length <= 1) return pad.left;
    return pad.left + (i / (visibleData.length - 1)) * chartW;
  }, [visibleData.length, chartW]);

  const xToIdx = useCallback((x) => {
    const ratio = (x - pad.left) / chartW;
    return Math.round(ratio * (visibleData.length - 1));
  }, [visibleData.length, chartW]);

  // Scroll zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const localIdx = xToIdx(mouseX);
    const globalIdx = viewRange[0] + Math.max(0, Math.min(localIdx, visibleData.length - 1));
    const [s, end] = viewRange;
    const range = end - s;
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
    const newRange = Math.max(10, Math.min(data.length - 1, Math.round(range * zoomFactor)));
    const ratio = (globalIdx - s) / Math.max(range, 1);
    let newStart = Math.round(globalIdx - ratio * newRange);
    let newEnd = newStart + newRange;
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd >= data.length) { newStart -= (newEnd - data.length + 1); newEnd = data.length - 1; }
    newStart = Math.max(0, newStart);
    setViewRange([newStart, newEnd]);
  }, [viewRange, visibleData.length, data.length, xToIdx]);

  // Drag selection
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setDragStart(x);
    setDragEnd(x);
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const localIdx = xToIdx(x);
    if (localIdx >= 0 && localIdx < visibleData.length) setHoverIdx(localIdx);
    else setHoverIdx(null);
    if (isDragging) setDragEnd(x);
  }, [isDragging, xToIdx, visibleData.length]);

  const handleMouseUp = useCallback(() => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const startLocal = xToIdx(Math.min(dragStart, dragEnd));
      const endLocal = xToIdx(Math.max(dragStart, dragEnd));
      if (endLocal - startLocal >= 3) {
        const globalStart = viewRange[0] + Math.max(0, startLocal);
        const globalEnd = viewRange[0] + Math.min(endLocal, visibleData.length - 1);
        setViewRange([Math.max(0, globalStart), Math.min(data.length - 1, globalEnd)]);
      }
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  }, [isDragging, dragStart, dragEnd, xToIdx, viewRange, visibleData.length, data.length]);

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    }
  }, [isDragging]);

  // Reset zoom
  const resetZoom = useCallback(() => {
    setViewRange([0, data.length - 1]);
  }, [data.length]);

  // Price grid lines
  const gridLines = useMemo(() => {
    const step = Math.ceil((maxPrice - minPrice) / 5 / 500) * 500;
    const lines = [];
    let p = Math.ceil(minPrice / step) * step;
    while (p < maxPrice) {
      lines.push(p);
      p += step;
    }
    return lines;
  }, [minPrice, maxPrice]);

  // X axis labels
  const xLabels = useMemo(() => {
    const count = Math.min(8, visibleData.length);
    const step = Math.max(1, Math.floor(visibleData.length / count));
    const labels = [];
    for (let i = 0; i < visibleData.length; i += step) {
      labels.push({ idx: i, label: visibleData[i].date });
    }
    return labels;
  }, [visibleData]);

  // Hover data
  const hoverData = hoverIdx !== null && hoverIdx < visibleData.length ? visibleData[hoverIdx] : null;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", cursor: isDragging ? "col-resize" : "crosshair" }}>
      {/* Zoom reset button */}
      {viewRange[0] > 0 || viewRange[1] < data.length - 1 ? (
        <button onClick={resetZoom} style={{
          position: "absolute", top: 6, right: 6, zIndex: 10,
          padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(0,0,0,0.1)",
          background: "rgba(0,0,0,0.05)", color: "#64748b", cursor: "pointer",
          fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
        }}>전체보기</button>
      ) : null}

      {/* OHLC tooltip overlay */}
      {hoverData && !isDragging && (
        <div style={{
          position: "absolute", top: 4, left: pad.left, zIndex: 10,
          display: "flex", gap: 14, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
          pointerEvents: "none",
        }}>
          <span style={{ color: "#1e293b", fontWeight: 600 }}>{hoverData.fullDate}</span>
          <span style={{ color: "#94a3b8" }}>시 <span style={{ color: "#334155" }}>{hoverData.open.toLocaleString()}</span></span>
          <span style={{ color: "#94a3b8" }}>고 <span style={{ color: "#ef4444" }}>{hoverData.high.toLocaleString()}</span></span>
          <span style={{ color: "#94a3b8" }}>저 <span style={{ color: "#3b82f6" }}>{hoverData.low.toLocaleString()}</span></span>
          <span style={{ color: "#94a3b8" }}>종 <span style={{ color: hoverData.close >= hoverData.open ? "#ef4444" : "#3b82f6", fontWeight: 700 }}>{hoverData.close.toLocaleString()}</span></span>
          <span style={{ color: "#94a3b8" }}>량 <span style={{ color: "#64748b" }}>{(hoverData.volume / 10000).toFixed(0)}만</span></span>
        </div>
      )}

      <svg
        ref={svgRef}
        width={dims.w}
        height={dims.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ display: "block", userSelect: "none" }}
      >
        {/* Grid */}
        {gridLines.map((p, i) => (
          <g key={`grid-${i}`}>
            <line x1={pad.left} x2={dims.w - pad.right} y1={priceToY(p)} y2={priceToY(p)} stroke="rgba(0,0,0,0.1)" strokeDasharray="2 3" />
            <text x={pad.left - 6} y={priceToY(p) + 3} textAnchor="end" fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono', monospace">{(p / 1000).toFixed(0)}K</text>
          </g>
        ))}

        {/* X axis labels + vertical time lines (solid) */}
        {xLabels.map(({ idx, label }) => (
          <g key={`xl-${idx}`}>
            <line x1={idxToX(idx)} x2={idxToX(idx)} y1={pad.top} y2={dims.h - pad.bottom} stroke="rgba(0,0,0,0.08)" />
            <text x={idxToX(idx)} y={dims.h - 6} textAnchor="middle" fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono', monospace">{label}</text>
          </g>
        ))}

        {/* X axis line */}
        <line x1={pad.left} x2={dims.w - pad.right} y1={dims.h - pad.bottom} y2={dims.h - pad.bottom} stroke="rgba(0,0,0,0.12)" />

        {/* Event reference lines (one per date) */}
        {[...new Set(visibleEvents.map(ev => ev.date))].map((date, i) => {
          const localIdx = visibleData.findIndex(d => d.date === date);
          if (localIdx < 0) return null;
          return <line key={`evl-${i}`} x1={idxToX(localIdx)} x2={idxToX(localIdx)} y1={pad.top} y2={dims.h - pad.bottom} stroke="rgba(0,0,0,0.08)" strokeDasharray="3 4" />;
        })}

        {/* Candlesticks */}
        {visibleData.map((d, i) => {
          const x = idxToX(i);
          const isUp = d.close >= d.open;
          const color = isUp ? "#ef4444" : "#3b82f6";
          const bodyTop = priceToY(Math.max(d.open, d.close));
          const bodyBot = priceToY(Math.min(d.open, d.close));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          return (
            <g key={`candle-${i}`}>
              {/* Wick */}
              <line x1={x} x2={x} y1={priceToY(d.high)} y2={priceToY(d.low)} stroke={color} strokeWidth={1} strokeOpacity={0.7} />
              {/* Body */}
              <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={isUp ? color : color} rx={1} stroke={color} strokeWidth={0.5} fillOpacity={isUp ? 0.9 : 0.9} />
            </g>
          );
        })}

        {/* Moving Average Lines */}
        {Object.entries(maData).map(([key, values]) => {
          if (!values.length) return null;
          const color = indicators?.[key]?.color || "#888";
          const points = visibleData
            .map((_, i) => {
              const globalIdx = viewRange[0] + i;
              const val = values[globalIdx];
              if (val === null) return null;
              return `${idxToX(i)},${priceToY(val)}`;
            })
            .filter(Boolean)
            .join(" ");
          return points ? (
            <polyline key={`ma-${key}`} points={points} fill="none" stroke={color} strokeWidth={1.2} strokeOpacity={0.8} />
          ) : null;
        })}

        {/* Volume Bars */}
        {indicators?.volume?.enabled && (() => {
          const maxVol = Math.max(...visibleData.map(d => d.volume));
          const volBottom = dims.h - pad.bottom;
          const volMaxH = volumeH;
          return visibleData.map((d, i) => {
            const x = idxToX(i);
            const h = (d.volume / maxVol) * volMaxH;
            const isUp = d.close >= d.open;
            return (
              <rect key={`vol-${i}`} x={x - candleW / 2} y={volBottom - h} width={candleW} height={h}
                fill={isUp ? "#ef4444" : "#3b82f6"} fillOpacity={0.2} rx={0.5} />
            );
          });
        })()}

        {/* Event dots */}
        {eventDots.map((ev, i) => {
          const localIdx = visibleData.findIndex(d => d.date === ev.date);
          if (localIdx < 0) return null;
          const x = idxToX(localIdx);
          const y = priceToY(ev.yOffset);
          const isHovered = hoveredDot === i;
          return (
            <g key={`evdot-${i}`}
              onMouseEnter={() => setHoveredDot(i)}
              onMouseLeave={() => setHoveredDot(null)}
              onClick={(e) => { e.stopPropagation(); onDotClick?.(ev); }}
              style={{ cursor: "pointer" }}
            >
              {/* Hover ring */}
              {isHovered && (
                <circle cx={x} cy={y} r={11} fill="none" stroke={ev.color} strokeWidth={1.5} strokeOpacity={0.5}>
                  <animate attributeName="r" from="8" to="13" dur="0.8s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" from="0.6" to="0" dur="0.8s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Outer glow on hover */}
              {isHovered && (
                <circle cx={x} cy={y} r={8} fill={ev.color} fillOpacity={0.15} />
              )}
              {/* Main dot */}
              <circle cx={x} cy={y} r={isHovered ? 6 : 5.2} fill={ev.color} stroke="#ffffff" strokeWidth={2} style={{ transition: "r 0.15s" }} />
            </g>
          );
        })}

        {/* Hover crosshair */}
        {hoverIdx !== null && !isDragging && hoverIdx < visibleData.length && (
          <g>
            <line x1={idxToX(hoverIdx)} x2={idxToX(hoverIdx)} y1={pad.top} y2={dims.h - pad.bottom} stroke="rgba(0,0,0,0.15)" strokeDasharray="2 2" />
            <line x1={pad.left} x2={dims.w - pad.right} y1={priceToY(visibleData[hoverIdx].close)} y2={priceToY(visibleData[hoverIdx].close)} stroke="rgba(0,0,0,0.1)" strokeDasharray="2 2" />
            {/* Price label on Y axis */}
            <rect x={0} y={priceToY(visibleData[hoverIdx].close) - 9} width={pad.left - 4} height={18} rx={3} fill="rgba(0,0,0,0.08)" />
            <text x={pad.left - 6} y={priceToY(visibleData[hoverIdx].close) + 4} textAnchor="end" fill="#1e293b" fontSize={10} fontWeight={600} fontFamily="'JetBrains Mono', monospace">
              {(visibleData[hoverIdx].close / 1000).toFixed(1)}K
            </text>
          </g>
        )}

        {/* Drag selection overlay */}
        {isDragging && dragStart !== null && dragEnd !== null && (
          <rect
            x={Math.min(dragStart, dragEnd)}
            y={pad.top}
            width={Math.abs(dragEnd - dragStart)}
            height={chartH}
            fill="rgba(59,130,246,0.08)"
            stroke="rgba(59,130,246,0.3)"
            strokeWidth={1}
            rx={2}
          />
        )}
      </svg>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────
export default function ResearchPlatform() {
  const [selectedCompany, setSelectedCompany] = useState("삼성전자");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeTab, setActiveTab] = useState("notes");
  const [activeEvents, setActiveEvents] = useState({ note: true, news: true, telegram: true, earnings: true, report: true });
  const [selectedNote, setSelectedNote] = useState(null);
  const [newsFilter, setNewsFilter] = useState("impact"); // impact | all | keyword
  const [newsKeyword, setNewsKeyword] = useState(null);
  const [expandedClusters, setExpandedClusters] = useState({});
  const [newsMinImpact, setNewsMinImpact] = useState(0);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [indicators, setIndicators] = useState({
    ma5: { enabled: true, color: "#f59e0b", label: "MA 5" },
    ma20: { enabled: true, color: "#8b5cf6", label: "MA 20" },
    ma60: { enabled: false, color: "#06b6d4", label: "MA 60" },
    ma120: { enabled: false, color: "#ec4899", label: "MA 120" },
    bollinger: { enabled: false, period: 20, std: 2, color: "#6366f1", label: "볼린저밴드" },
    volume: { enabled: true, label: "거래량" },
    rsi: { enabled: false, period: 14, label: "RSI (14)" },
    macd: { enabled: false, label: "MACD" },
    stochastic: { enabled: false, label: "스토캐스틱" },
  });
  const toggleIndicator = (key) => {
    setIndicators(prev => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } }));
  };
  const [highlightedEvent, setHighlightedEvent] = useState(null); // { type, date }
  const searchRef = useRef(null);

  // Map event type to tab key
  const EVENT_TAB_MAP = { note: "notes", news: "news", telegram: "telegram", earnings: "financials", report: "reports" };

  // Convert chart date "10/31" to match data date "2024-10-31"
  const matchEventDate = useCallback((evDate, itemDate) => {
    if (!evDate || !itemDate) return false;
    const [m, d] = evDate.split("/");
    const suffix = `-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return itemDate.endsWith(suffix);
  }, []);

  const handleDotClick = useCallback((ev) => {
    const tab = EVENT_TAB_MAP[ev.type];
    if (tab) {
      setActiveTab(tab);
      setHighlightedEvent({ type: ev.type, date: ev.date });
      // For news, switch to "all" so matching cluster is visible
      if (ev.type === "news") { setNewsFilter("all"); setNewsKeyword(null); }
      // Auto-clear highlight after 3 seconds
      setTimeout(() => setHighlightedEvent(null), 3000);
    }
  }, []);

  const company = COMPANIES[selectedCompany];

  const searchResults = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return Object.keys(COMPANIES).filter(c => c.toLowerCase().includes(q) || COMPANIES[c].code.includes(q));
  }, [searchQuery]);

  const visibleEvents = useMemo(() =>
    CHART_EVENTS.filter(e => activeEvents[e.type]),
  [activeEvents]);

  // Compute dot positions: match event dates to stock close prices
  const eventDots = useMemo(() => {
    const priceMap = {};
    STOCK_DATA.forEach(d => { priceMap[d.date] = d.close; });
    const dots = visibleEvents
      .filter(ev => priceMap[ev.date] !== undefined)
      .map(ev => ({
        ...ev,
        close: priceMap[ev.date],
        color: EVENT_COLORS[ev.type].bg,
      }));
    // Offset same-date dots vertically so they stack instead of overlap
    const dateGroups = {};
    dots.forEach(dot => {
      if (!dateGroups[dot.date]) dateGroups[dot.date] = [];
      dateGroups[dot.date].push(dot);
    });
    const result = [];
    Object.values(dateGroups).forEach(group => {
      group.forEach((dot, idx) => {
        result.push({
          ...dot,
          yOffset: dot.close + (idx * 350), // stack upward, 350원 간격
        });
      });
    });
    return result;
  }, [visibleEvents]);

  const toggleEvent = (type) => {
    setActiveEvents(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const toggleCluster = (id) => {
    setExpandedClusters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredNewsClusters = useMemo(() => {
    let clusters = [...DEMO_NEWS_CLUSTERS];
    if (newsKeyword) {
      clusters = clusters.filter(c => c.keyword === newsKeyword);
    }
    if (newsFilter === "impact") {
      clusters = clusters.filter(c => c.impactScore >= 50);
      clusters.sort((a, b) => b.impactScore - a.impactScore);
    }
    if (newsMinImpact > 0) {
      clusters = clusters.filter(c => Math.abs(c.priceImpact) >= newsMinImpact);
    }
    return clusters;
  }, [newsFilter, newsKeyword, newsMinImpact]);

  const sentimentColor = (s) => s === "positive" || s === "bullish" ? "#10b981" : s === "negative" || s === "bearish" ? "#ef4444" : "#64748b";

  // CSS
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-primary: #080b12;
      --bg-secondary: #0c1019;
      --bg-tertiary: #111827;
      --bg-card: rgba(17,24,39,0.6);
      --border: rgba(255,255,255,0.06);
      --border-hover: rgba(255,255,255,0.12);
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #475569;
      --accent-green: #10b981;
      --accent-red: #ef4444;
      --accent-blue: #3b82f6;
      --accent-amber: #f59e0b;
      --accent-purple: #a78bfa;
    }

    body { background: var(--bg-primary); color: var(--text-primary); font-family: 'IBM Plex Sans KR', sans-serif; }

    .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg-primary); }

    /* Header */
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 56px; border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(12,16,25,1), rgba(8,11,18,1));
      flex-shrink: 0;
    }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-mark {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
      display: flex; align-items: center; justify-content: center;
      font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 15px; color: #fff;
    }
    .logo-text { font-size: 15px; font-weight: 700; letter-spacing: -0.5px; color: var(--text-primary); }
    .logo-sub { font-size: 10px; color: var(--text-muted); font-weight: 500; letter-spacing: 0.5px; }

    /* Search */
    .search-area { position: relative; width: 360px; }
    .search-box {
      display: flex; align-items: center; gap: 8px; padding: 7px 14px;
      border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border);
      transition: all 0.2s;
    }
    .search-box:focus-within { border-color: rgba(16,185,129,0.4); background: rgba(255,255,255,0.05); }
    .search-box input {
      flex: 1; background: none; border: none; outline: none; color: var(--text-primary);
      font-size: 13px; font-family: inherit;
    }
    .search-box input::placeholder { color: var(--text-muted); }
    .search-dropdown {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: var(--bg-tertiary); border: 1px solid var(--border-hover);
      border-radius: 10px; overflow: hidden; z-index: 200;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .search-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; cursor: pointer; transition: background 0.1s;
    }
    .search-item:hover { background: rgba(16,185,129,0.08); }

    /* Company Bar */
    .company-bar {
      display: flex; align-items: center; gap: 20px; padding: 12px 24px;
      border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0;
    }
    .company-name { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .company-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted); }
    .price-display { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .price-change { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; padding: 3px 8px; border-radius: 4px; }
    .tag-chip {
      padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;
      background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text-secondary);
    }

    /* Main Layout */
    .main { display: flex; flex: 1; overflow: hidden; }
    .chart-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .side-panel { width: 380px; border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; background: var(--bg-secondary); }

    /* Chart Section */
    .chart-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 24px; border-bottom: 1px solid var(--border);
    }
    .chart-container { flex: 1; padding: 8px 16px 0 8px; min-height: 0; background: #ffffff; border-radius: 8px; margin: 4px 8px; }
    .event-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
    .event-toggle {
      display: flex; align-items: center; gap: 5px; padding: 4px 10px;
      border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;
      transition: all 0.15s; border: 1px solid transparent; user-select: none;
    }
    .event-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .range-btns { display: flex; gap: 2px; }
    .range-btn {
      padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;
      border: none; cursor: pointer; font-family: 'JetBrains Mono', monospace;
      transition: all 0.15s; background: transparent; color: var(--text-muted);
    }
    .range-btn.active { background: rgba(16,185,129,0.15); color: #10b981; }

    /* Event markers on chart */
    .chart-events {
      display: flex; gap: 6px; padding: 6px 24px 10px; flex-wrap: wrap;
      border-bottom: 1px solid var(--border); max-height: 100px; overflow-y: auto;
    }
    .chart-event-pill {
      display: flex; align-items: center; gap: 5px; padding: 4px 10px;
      border-radius: 5px; font-size: 11px; cursor: pointer; transition: all 0.15s;
      background: rgba(255,255,255,0.03); border: 1px solid var(--border);
    }
    .chart-event-pill:hover { background: rgba(255,255,255,0.06); border-color: var(--border-hover); }

    /* Side Panel Tabs */
    .side-tabs {
      display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .side-tab {
      flex: 1; padding: 10px 0; text-align: center; font-size: 12px; font-weight: 600;
      color: var(--text-muted); cursor: pointer; transition: all 0.15s;
      border-bottom: 2px solid transparent; background: none; border-top: none; border-left: none; border-right: none;
      font-family: inherit;
    }
    .side-tab.active { color: #10b981; border-bottom-color: #10b981; }
    .side-tab:hover:not(.active) { color: var(--text-secondary); background: rgba(255,255,255,0.02); }

    .side-content { flex: 1; overflow-y: auto; padding: 12px; }

    /* Cards */
    .card {
      padding: 12px 14px; border-radius: 8px; margin-bottom: 8px;
      background: var(--bg-card); border: 1px solid var(--border);
      cursor: pointer; transition: all 0.15s;
    }
    .card:hover { border-color: var(--border-hover); background: rgba(17,24,39,0.8); }
    .card-title { font-size: 13px; font-weight: 600; color: var(--text-primary); line-height: 1.5; margin-bottom: 4px; }
    .card-meta { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; }
    .card-preview { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-tag { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: rgba(255,255,255,0.05); color: var(--text-secondary); }
    .source-badge { padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 600; }

    /* Financial table */
    .fin-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .fin-table th {
      text-align: right; padding: 6px 10px; color: var(--text-muted); font-weight: 600;
      border-bottom: 1px solid var(--border); font-size: 11px;
    }
    .fin-table th:first-child { text-align: left; }
    .fin-table td { text-align: right; padding: 7px 10px; color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .fin-table td:first-child { text-align: left; font-family: inherit; color: var(--text-primary); font-weight: 500; }
    .fin-table tr:hover td { background: rgba(255,255,255,0.02); }
    .fin-table .estimate { color: var(--accent-blue); }

    /* Report card */
    .report-target { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--accent-green); }
    .report-rating { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; }

    /* Telegram card */
    .tg-mentions { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 16px; }

    /* Bottom stats */
    .bottom-bar {
      display: flex; gap: 1px; border-top: 1px solid var(--border); flex-shrink: 0;
      background: var(--border);
    }
    .bottom-stat {
      flex: 1; padding: 10px 16px; background: var(--bg-secondary); text-align: center;
    }
    .bottom-stat-num { font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .bottom-stat-label { font-size: 10px; color: var(--text-muted); font-weight: 600; margin-top: 2px; letter-spacing: 0.3px; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

    /* Animations */
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.3s ease forwards; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes highlightPulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); } 70% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    .card-highlight { border-color: rgba(16,185,129,0.5) !important; background: rgba(16,185,129,0.06) !important; animation: highlightPulse 1s ease 2; }
  `;

  return (
    <div className="app">
      <style>{css}</style>

      {/* ─── Header ─── */}
      <header className="header">
        <div className="logo">
          <div className="logo-mark">R</div>
          <div>
            <div className="logo-text">ResearchDB</div>
            <div className="logo-sub">CORPORATE INTELLIGENCE</div>
          </div>
        </div>

        <div className="search-area" ref={searchRef}>
          <div className="search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              placeholder="기업명 또는 종목코드 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            />
            {searchQuery && (
              <span style={{ cursor: "pointer", color: "#475569" }} onClick={() => setSearchQuery("")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            )}
          </div>
          {searchFocused && (searchQuery ? searchResults : Object.keys(COMPANIES)).length > 0 && (
            <div className="search-dropdown">
              {(searchQuery ? searchResults : Object.keys(COMPANIES)).map(name => (
                <div key={name} className="search-item" onMouseDown={() => { setSelectedCompany(name); setSearchQuery(""); }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{name}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>{COMPANIES[name].code} · {COMPANIES[name].sector}</div>
                  </div>
                  <div style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{COMPANIES[name].price}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button style={{
            padding: "7px 14px", borderRadius: "7px", border: "1px solid rgba(16,185,129,0.3)",
            background: "rgba(16,185,129,0.1)", color: "#10b981", cursor: "pointer",
            fontSize: "12px", fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            .enex 가져오기
          </button>
        </div>
      </header>

      {/* ─── Company Bar ─── */}
      <div className="company-bar">
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span className="company-name">{selectedCompany}</span>
          <span className="company-code">{company.code}.KS</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="price-display">{company.price}</span>
          <span className="price-change" style={{
            background: company.change.startsWith("+") ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
            color: company.change.startsWith("+") ? "#10b981" : "#ef4444",
          }}>{company.change}</span>
        </div>
        <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
          <span className="tag-chip">시가총액 {company.marketCap}</span>
          <span className="tag-chip">{company.sector}</span>
          <span className="tag-chip" style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981" }}>Evernote 연동</span>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div className="main">
        {/* Chart Area */}
        <div className="chart-area">
          <div className="chart-header">
            <div className="event-toggles">
              {Object.entries(EVENT_COLORS).map(([key, val]) => (
                <div
                  key={key}
                  className="event-toggle"
                  onClick={() => toggleEvent(key)}
                  style={{
                    background: activeEvents[key] ? `${val.bg}15` : "transparent",
                    borderColor: activeEvents[key] ? `${val.bg}40` : "transparent",
                    color: activeEvents[key] ? val.bg : "#475569",
                  }}
                >
                  <div className="event-dot" style={{ background: activeEvents[key] ? val.bg : "#334155" }} />
                  {val.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Active MA legend */}
              {Object.entries(indicators).filter(([k, v]) => v.enabled && v.color).map(([k, v]) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: v.color, fontWeight: 600 }}>
                  <span style={{ width: 12, height: 2, background: v.color, borderRadius: 1 }} />
                  {v.label}
                </span>
              ))}
              <span style={{ fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono', monospace", marginLeft: 4 }}>
                스크롤: 줌 · 드래그: 기간 선택
              </span>
              {/* Indicator settings button */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowIndicatorPanel(!showIndicatorPanel)} style={{
                  padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.08)",
                  background: showIndicatorPanel ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)",
                  color: showIndicatorPanel ? "#a78bfa" : "#94a3b8", cursor: "pointer",
                  fontSize: 11, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                  보조지표
                </button>

                {/* Indicator Panel Dropdown */}
                {showIndicatorPanel && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
                    width: 280, background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10, padding: 0, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                    overflow: "hidden",
                  }}>
                    {/* Header */}
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>📊 보조지표 설정</span>
                      <span style={{ fontSize: 10, color: "#475569" }}>DB 연결 시 활성화</span>
                    </div>

                    {/* Moving Averages */}
                    <div style={{ padding: "8px 14px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>이동평균선</div>
                      {["ma5", "ma20", "ma60", "ma120"].map(key => (
                        <div key={key} onClick={() => toggleIndicator(key)} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 5, cursor: "pointer",
                          background: indicators[key].enabled ? "rgba(255,255,255,0.04)" : "transparent",
                          marginBottom: 2,
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: `1.5px solid ${indicators[key].enabled ? indicators[key].color : "rgba(255,255,255,0.15)"}`,
                            background: indicators[key].enabled ? indicators[key].color : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {indicators[key].enabled && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                          <div style={{ width: 20, height: 2, background: indicators[key].color, borderRadius: 1, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: indicators[key].enabled ? "#e2e8f0" : "#64748b", fontWeight: 500 }}>{indicators[key].label}</span>
                        </div>
                      ))}
                    </div>

                    {/* Overlays */}
                    <div style={{ padding: "4px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>오버레이</div>
                      {["bollinger", "volume"].map(key => (
                        <div key={key} onClick={() => toggleIndicator(key)} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 5, cursor: "pointer",
                          background: indicators[key].enabled ? "rgba(255,255,255,0.04)" : "transparent",
                          marginBottom: 2,
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: `1.5px solid ${indicators[key].enabled ? "#10b981" : "rgba(255,255,255,0.15)"}`,
                            background: indicators[key].enabled ? "#10b981" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {indicators[key].enabled && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                          <span style={{ fontSize: 12, color: indicators[key].enabled ? "#e2e8f0" : "#64748b", fontWeight: 500 }}>{indicators[key].label}</span>
                          {key === "bollinger" && indicators[key].enabled && (
                            <span style={{ fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>20, 2σ</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Sub-chart indicators */}
                    <div style={{ padding: "4px 14px 10px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>보조 차트</div>
                      {["rsi", "macd", "stochastic"].map(key => (
                        <div key={key} onClick={() => toggleIndicator(key)} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 5, cursor: "pointer",
                          background: indicators[key].enabled ? "rgba(255,255,255,0.04)" : "transparent",
                          marginBottom: 2, opacity: 0.5,
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: `1.5px solid rgba(255,255,255,0.15)`,
                            background: "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }} />
                          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>{indicators[key].label}</span>
                          <span style={{ fontSize: 9, color: "#334155", marginLeft: "auto", background: "rgba(255,255,255,0.04)", padding: "1px 5px", borderRadius: 3 }}>DB 연결 필요</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Event Timeline Pills */}
          <div className="chart-events">
            {visibleEvents.map((ev, i) => (
              <div key={i} className="chart-event-pill fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="event-dot" style={{ background: EVENT_COLORS[ev.type].bg, width: 6, height: 6 }} />
                <span style={{ color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{ev.date}</span>
                <span style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 500 }}>{ev.label}</span>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="chart-container">
            <CandlestickChart
              data={STOCK_DATA}
              eventDots={eventDots}
              visibleEvents={visibleEvents}
              eventColors={EVENT_COLORS}
              onDotClick={handleDotClick}
              indicators={indicators}
            />
          </div>
        </div>

        {/* ─── Side Panel ─── */}
        <div className="side-panel">
          <div className="side-tabs">
            {[
              { key: "notes", label: "노트", count: 3 },
              { key: "news", label: "뉴스", count: 6 },
              { key: "reports", label: "리포트", count: 3 },
              { key: "telegram", label: "TG", count: 4 },
              { key: "financials", label: "재무" },
            ].map(t => (
              <button key={t.key} className={`side-tab ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>
                {t.label}{t.count ? <span style={{ marginLeft: 3, fontSize: 10, opacity: 0.6 }}>{t.count}</span> : null}
              </button>
            ))}
          </div>

          <div className="side-content">
            {/* ── Notes Tab ── */}
            {activeTab === "notes" && (
              <div>
                {DEMO_NOTES.map((note, i) => {
                  const isHighlighted = highlightedEvent?.type === "note" && matchEventDate(highlightedEvent.date, note.date);
                  return (
                  <div key={note.id} className={`card fade-in ${isHighlighted ? "card-highlight" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="card-title">{note.title}</div>
                    <div className="card-meta">
                      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{note.date}</span>
                      <span className="source-badge" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>Evernote</span>
                      {note.tags.map(t => <span key={t} className="card-tag">{t}</span>)}
                    </div>
                    <div className="card-preview">{note.preview}</div>
                  </div>
                  );
                })}
                <div style={{ textAlign: "center", padding: "12px", fontSize: "12px", color: "#475569" }}>
                  Evernote 공유 노트북에서 자동 동기화됩니다
                </div>
              </div>
            )}

            {/* ── News Tab ── */}
            {activeTab === "news" && (
              <div>
                {/* Filter Controls */}
                <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Mode Toggle */}
                  <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: 3 }}>
                    {[
                      { key: "impact", label: "📈 주가영향순" },
                      { key: "all", label: "📋 전체" },
                    ].map(m => (
                      <button key={m.key} onClick={() => setNewsFilter(m.key)} style={{
                        flex: 1, padding: "5px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s",
                        background: newsFilter === m.key ? "rgba(16,185,129,0.15)" : "transparent",
                        color: newsFilter === m.key ? "#10b981" : "#475569",
                      }}>{m.label}</button>
                    ))}
                  </div>
                  {/* Keyword Chips */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span onClick={() => setNewsKeyword(null)} style={{
                      padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                      background: !newsKeyword ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                      color: !newsKeyword ? "#10b981" : "#64748b",
                      border: `1px solid ${!newsKeyword ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"}`,
                    }}>전체</span>
                    {NEWS_KEYWORDS.map(kw => (
                      <span key={kw} onClick={() => setNewsKeyword(newsKeyword === kw ? null : kw)} style={{
                        padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
                        background: newsKeyword === kw ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                        color: newsKeyword === kw ? "#60a5fa" : "#64748b",
                        border: `1px solid ${newsKeyword === kw ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.06)"}`,
                      }}>{kw}</span>
                    ))}
                  </div>
                </div>

                {/* Impact threshold slider (only in impact mode) */}
                {newsFilter === "impact" && (
                  <div style={{ marginBottom: 10, padding: "6px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#475569", fontWeight: 600 }}>최소 주가 변동폭</span>
                      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: newsMinImpact > 0 ? "#f59e0b" : "#475569" }}>
                        {newsMinImpact > 0 ? `±${newsMinImpact}% 이상` : "필터 없음"}
                      </span>
                    </div>
                    <input type="range" min="0" max="5" step="0.5" value={newsMinImpact}
                      onChange={(e) => setNewsMinImpact(parseFloat(e.target.value))}
                      style={{ width: "100%", accentColor: "#10b981", height: 4 }} />
                  </div>
                )}

                {/* Cluster Cards */}
                {filteredNewsClusters.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, color: "#475569", fontSize: 12 }}>
                    조건에 맞는 뉴스가 없습니다. 필터를 조정해보세요.
                  </div>
                ) : filteredNewsClusters.map((cluster, i) => {
                  const isExpanded = expandedClusters[cluster.id];
                  const impactAbs = Math.abs(cluster.priceImpact);
                  const impactPositive = cluster.priceImpact > 0;
                  const isHighlighted = highlightedEvent?.type === "news" && matchEventDate(highlightedEvent.date, cluster.date);
                  return (
                    <div key={cluster.id} className={`card fade-in ${isHighlighted ? "card-highlight" : ""}`} style={{ animationDelay: `${i * 60}ms`, padding: 0, overflow: "hidden" }}>
                      {/* Impact Bar - visual strength indicator */}
                      <div style={{
                        height: 3, borderRadius: "8px 8px 0 0",
                        background: `linear-gradient(90deg, ${impactPositive ? "#10b981" : "#ef4444"} ${Math.min(cluster.impactScore, 100)}%, transparent ${cluster.impactScore}%)`,
                      }} />

                      {/* Main cluster info */}
                      <div style={{ padding: "10px 14px" }} onClick={() => toggleCluster(cluster.id)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>{cluster.topic}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#475569" }}>{cluster.date}</span>
                              <span style={{
                                padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                                fontFamily: "'JetBrains Mono', monospace",
                                background: impactPositive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                                color: impactPositive ? "#10b981" : "#ef4444",
                              }}>
                                주가 {impactPositive ? "+" : ""}{cluster.priceImpact}%
                              </span>
                              <span style={{
                                padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600,
                                background: "rgba(255,255,255,0.04)", color: "#64748b",
                              }}>
                                기사 {cluster.articles.length}건
                              </span>
                            </div>
                          </div>
                          {/* Impact Score Circle */}
                          <div style={{
                            width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: cluster.impactScore >= 80 ? "rgba(16,185,129,0.12)" : cluster.impactScore >= 50 ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.04)",
                            border: `1.5px solid ${cluster.impactScore >= 80 ? "rgba(16,185,129,0.3)" : cluster.impactScore >= 50 ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)"}`,
                          }}>
                            <span style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700,
                              color: cluster.impactScore >= 80 ? "#10b981" : cluster.impactScore >= 50 ? "#f59e0b" : "#475569",
                            }}>{cluster.impactScore}</span>
                          </div>
                        </div>

                        {/* Representative headline */}
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                          {cluster.articles[0].title}
                        </div>

                        {/* Expand indicator */}
                        {cluster.articles.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, color: "#475569", fontSize: 11, cursor: "pointer" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                            {isExpanded ? "접기" : `관련 기사 ${cluster.articles.length - 1}건 더보기`}
                          </div>
                        )}
                      </div>

                      {/* Expanded articles */}
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "4px 14px 8px" }}>
                          {cluster.articles.slice(1).map((article, j) => (
                            <div key={article.id} style={{
                              padding: "7px 0", borderBottom: j < cluster.articles.length - 2 ? "1px solid rgba(255,255,255,0.03)" : "none",
                              display: "flex", gap: 8, alignItems: "flex-start",
                            }}>
                              <div style={{ width: 2, height: 16, borderRadius: 1, background: sentimentColor(cluster.sentiment), flexShrink: 0, marginTop: 3 }} />
                              <div>
                                <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{article.title}</div>
                                <div style={{ fontSize: 10, color: "#475569", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
                                  {article.source} · {article.date}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Summary */}
                <div style={{
                  marginTop: 8, padding: "8px 12px", borderRadius: 6,
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                  fontSize: 11, color: "#475569", lineHeight: 1.6,
                }}>
                  💡 <strong style={{ color: "#64748b" }}>주가영향순</strong>: 기사 발행 후 48시간 내 주가 변동과 연관된 뉴스 클러스터만 표시합니다. 영향도 점수(0-100)는 주가 변동폭, 거래량 변화, 기사 수를 종합합니다.
                </div>
              </div>
            )}

            {/* ── Reports Tab ── */}
            {activeTab === "reports" && (
              <div>
                {DEMO_REPORTS.map((r, i) => {
                  const isHighlighted = highlightedEvent?.type === "report" && matchEventDate(highlightedEvent.date, r.date);
                  return (
                  <div key={r.id} className={`card fade-in ${isHighlighted ? "card-highlight" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="card-title">{r.title}</div>
                    <div className="card-meta" style={{ marginBottom: 6 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.date}</span>
                      <span className="source-badge" style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}>{r.broker}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: "#64748b" }}>목표가</span>
                      <span className="report-target">{r.target}원</span>
                      <span className="report-rating" style={{
                        background: r.rating === "매수" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                        color: r.rating === "매수" ? "#10b981" : "#f59e0b",
                      }}>{r.rating}</span>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}

            {/* ── Telegram Tab ── */}
            {activeTab === "telegram" && (
              <div>
                <div style={{ marginBottom: 12, padding: "8px 0" }}>
                  <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 8 }}>주간 언급 추이</div>
                  <div style={{ height: 80 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={TELEGRAM_CHART} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tgGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="mentions" stroke="#f59e0b" strokeWidth={1.5} fill="url(#tgGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {DEMO_TELEGRAM.map((tg, i) => {
                  const isHighlighted = highlightedEvent?.type === "telegram" && matchEventDate(highlightedEvent.date, tg.date);
                  return (
                  <div key={tg.id} className={`card fade-in ${isHighlighted ? "card-highlight" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{tg.channel}</span>
                      <span className="tg-mentions" style={{ color: sentimentColor(tg.sentiment) }}>{tg.mentions}</span>
                    </div>
                    <div className="card-meta" style={{ marginBottom: 4 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{tg.date}</span>
                      <span style={{ color: sentimentColor(tg.sentiment), fontSize: 10, fontWeight: 600 }}>
                        {tg.sentiment === "bullish" ? "🟢 Bullish" : tg.sentiment === "bearish" ? "🔴 Bearish" : "⚪ Neutral"}
                      </span>
                    </div>
                    <div className="card-preview">{tg.snippet}</div>
                  </div>
                  );
                })}
              </div>
            )}

            {/* ── Financials Tab ── */}
            {activeTab === "financials" && (
              <div className="fade-in">
                {highlightedEvent?.type === "earnings" && (
                  <div className="card-highlight" style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 10, border: "1px solid rgba(239,68,68,0.3)", fontSize: 11, color: "#f87171", fontWeight: 600 }}>
                    📊 {CHART_EVENTS.find(e => e.type === "earnings" && e.date === highlightedEvent.date)?.label || "실적 발표"} — {CHART_EVENTS.find(e => e.type === "earnings" && e.date === highlightedEvent.date)?.detail || ""}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
                  {[
                    { label: "PER", value: DEMO_FINANCIALS.ratios.per + "x", color: "#e2e8f0" },
                    { label: "PBR", value: DEMO_FINANCIALS.ratios.pbr + "x", color: "#e2e8f0" },
                    { label: "배당률", value: DEMO_FINANCIALS.ratios.div, color: "#10b981" },
                    { label: "EPS", value: DEMO_FINANCIALS.ratios.eps + "원", color: "#e2e8f0" },
                  ].map(item => (
                    <div key={item.label} style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</div>
                      <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, marginTop: 2 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 8 }}>연간 실적 (조원)</div>
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>구분</th>
                      {DEMO_FINANCIALS.annual.map(a => (
                        <th key={a.year} className={a.year.includes("E") ? "estimate" : ""}>{a.year}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "매출", key: "revenue" },
                      { label: "영업이익", key: "op" },
                      { label: "순이익", key: "np" },
                      { label: "ROE (%)", key: "roe" },
                    ].map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        {DEMO_FINANCIALS.annual.map(a => (
                          <td key={a.year} className={a.year.includes("E") ? "estimate" : ""}>{a[row.key]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 10, color: "#334155", marginTop: 8, textAlign: "right" }}>출처: DART / 증권사 컨센서스</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom Status Bar ─── */}
      <div className="bottom-bar">
        <div className="bottom-stat">
          <div className="bottom-stat-num">3</div>
          <div className="bottom-stat-label">EVERNOTE 노트</div>
        </div>
        <div className="bottom-stat">
          <div className="bottom-stat-num">17</div>
          <div className="bottom-stat-label">뉴스 (6클러스터)</div>
        </div>
        <div className="bottom-stat">
          <div className="bottom-stat-num">3</div>
          <div className="bottom-stat-label">증권사 리포트</div>
        </div>
        <div className="bottom-stat">
          <div className="bottom-stat-num" style={{ color: "#f59e0b" }}>74</div>
          <div className="bottom-stat-label">TG 총 언급</div>
        </div>
        <div className="bottom-stat">
          <div className="bottom-stat-num" style={{ color: "#10b981" }}>92,000</div>
          <div className="bottom-stat-label">컨센서스 목표가</div>
        </div>
      </div>
    </div>
  );
}
