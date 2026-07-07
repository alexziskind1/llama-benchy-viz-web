// uPlot wrapper. Each ChartSpec module has a stable `id`. We cache BOTH
// the wrapper DOM node and the uPlot instance across frames — otherwise
// layout.js's innerHTML="" reset would destroy the chart mount every
// SSE frame and force a full uPlot rebuild (visible as flicker).

const INSTANCES = new Map(); // id → { plot, mountEl, t0 }
const WRAPPERS = new Map();  // id → wrapper element

export function knownChartIds() {
  return INSTANCES.keys();
}

export function disposeChart(id) {
  const entry = INSTANCES.get(id);
  if (entry) {
    try { entry.plot.destroy(); } catch (_) {}
    INSTANCES.delete(id);
  }
  WRAPPERS.delete(id);
}

export function getChartWrapper(id) {
  return WRAPPERS.get(id);
}

export function setChartWrapper(id, wrapperEl) {
  WRAPPERS.set(id, wrapperEl);
}

// ─── data assembly ────────────────────────────────────────────────────

function computeT0(series) {
  // First timestamp across all series — becomes 0 on the visible axis.
  let t0 = Infinity;
  for (const s of series) {
    for (const [t, _] of s.points || []) {
      if (t < t0) t0 = t;
    }
  }
  return isFinite(t0) ? t0 : 0;
}

function buildAlignedData(series, t0) {
  // Series share the run's clock. Build a merged sorted (relative) x
  // axis and align each series' y-array with nulls where absent.
  const xSet = new Set();
  for (const s of series) {
    for (const [t, _] of s.points || []) xSet.add(t - t0);
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);
  const xIndex = new Map(xs.map((t, i) => [t, i]));
  const rows = [xs];
  for (const s of series) {
    const ys = new Array(xs.length).fill(null);
    for (const [t, v] of s.points || []) ys[xIndex.get(t - t0)] = v;
    rows.push(ys);
  }
  return rows;
}

// ─── axis formatters ──────────────────────────────────────────────────

function formatElapsed(secs) {
  if (!isFinite(secs)) return "";
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m < 60) return `${m}m${s ? ` ${s}s` : ""}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h${mm ? ` ${mm}m` : ""}`;
}

// ─── uPlot options ────────────────────────────────────────────────────

function withAlpha(hex, alpha) {
  if (!hex || hex[0] !== "#" || hex.length !== 7) return `rgba(147,169,255,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function areaFillFactory(color) {
  // Vertical linear gradient from color@0.30 → color@0.00 for area under
  // each line. Wrapped in try/catch so a shape/bbox hiccup can't take
  // out the whole chart draw — we fall back to a solid low-alpha fill.
  return (u, seriesIdx) => {
    try {
      const ctx = u.ctx;
      const b = u.bbox;
      if (!ctx || !b) return withAlpha(color, 0.15);
      const grad = ctx.createLinearGradient(0, b.top, 0, b.top + b.height);
      grad.addColorStop(0, withAlpha(color, 0.30));
      grad.addColorStop(1, withAlpha(color, 0.00));
      return grad;
    } catch (_) {
      return withAlpha(color, 0.15);
    }
  };
}

function chartOptsFor(spec, mountEl) {
  const seriesOpts = [{ label: "elapsed" }];
  const splineFn =
    (typeof uPlot !== "undefined" && uPlot.paths && uPlot.paths.spline)
      ? uPlot.paths.spline()
      : null;
  for (const s of spec.series || []) {
    const color = s.color || "#93a9ff";
    const entry = {
      label: s.label,
      stroke: color,
      width: 1.8,
      spanGaps: true,
      points: { show: false },
      fill: areaFillFactory(color),
    };
    // Only set paths when a spline builder exists — passing `undefined`
    // to a series' paths key can cause some uPlot builds to skip line
    // rendering entirely.
    if (splineFn) entry.paths = splineFn;
    seriesOpts.push(entry);
  }
  return {
    width: mountEl.clientWidth || 400,
    height: mountEl.clientHeight || 200,
    padding: [10, 12, 6, 6],
    scales: {
      x: { time: false },
      y: {
        auto: spec.y_max == null,
        range: spec.y_max != null ? [0, spec.y_max] : undefined,
      },
    },
    axes: [
      {
        stroke: "#b5b7c0",
        grid: { stroke: "rgba(34,36,43,0.9)", width: 1 },
        ticks: { stroke: "rgba(34,36,43,0.9)" },
        space: 60,
        values: (u, splits) => splits.map(formatElapsed),
      },
      {
        stroke: "#b5b7c0",
        grid: { stroke: "rgba(34,36,43,0.9)", width: 1 },
        ticks: { stroke: "rgba(34,36,43,0.9)" },
        label: spec.unit || "",
        labelSize: 24,
        size: 44,
      },
    ],
    series: seriesOpts,
    legend: {
      show: true,
      live: false,   // keep legend static; live values are noisy at high fps
      markers: { width: 2 },
    },
    cursor: {
      points: { size: 6 },
      drag:   { setScale: false },
    },
  };
}

export function makeOrUpdateChart(spec, mountEl) {
  const t0 = computeT0(spec.series || []);
  const data = buildAlignedData(spec.series || [], t0);
  const existing = INSTANCES.get(spec.id);
  const seriesCount = (spec.series || []).length;

  if (existing) {
    // Rebuild only if the mount element changed, the series shape
    // changed, or one of the series colors changed (renderer options
    // are baked into uPlot at construction time).
    const seriesColorsChanged = (spec.series || []).some((s, i) => {
      const cur = existing.plot.series[i + 1];
      return cur && s.color && cur.stroke !== s.color;
    });
    if (
      existing.mountEl !== mountEl ||
      (existing.plot.series.length - 1) !== seriesCount ||
      seriesColorsChanged
    ) {
      disposeChart(spec.id);
    } else {
      try {
        const w = mountEl.clientWidth  || existing.plot.width;
        const h = mountEl.clientHeight || existing.plot.height;
        if (w > 0 && h > 0 &&
            (Math.abs(w - existing.plot.width)  >= 2 ||
             Math.abs(h - existing.plot.height) >= 2)) {
          existing.plot.setSize({ width: w, height: h });
        }
        existing.plot.setData(data);
        existing.t0 = t0;
        return;
      } catch (err) {
        console.warn("chart update failed, rebuilding", err);
        disposeChart(spec.id);
      }
    }
  }

  if (typeof uPlot === "undefined") return;
  mountEl.innerHTML = "";
  let plot;
  try {
    plot = new uPlot(chartOptsFor(spec, mountEl), data, mountEl);
  } catch (err) {
    console.error("uPlot construction failed:", err, { spec });
    mountEl.textContent = `chart error: ${err && err.message ? err.message : err}`;
    return;
  }
  INSTANCES.set(spec.id, { plot, mountEl, t0 });

  if (typeof ResizeObserver !== "undefined" && !mountEl.dataset.roAttached) {
    // 2-pixel tolerance breaks sub-pixel feedback between uPlot's
    // rendered canvas and its flex/grid container.
    const ro = new ResizeObserver(() => {
      const entry = INSTANCES.get(spec.id);
      if (!entry) return;
      const w = mountEl.clientWidth, h = mountEl.clientHeight;
      if (w === 0 || h === 0) return;
      if (Math.abs(w - entry.plot.width) < 2 && Math.abs(h - entry.plot.height) < 2) return;
      try { entry.plot.setSize({ width: w, height: h }); } catch (_) {}
    });
    ro.observe(mountEl);
    mountEl.dataset.roAttached = "1";
  }
}
