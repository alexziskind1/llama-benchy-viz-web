// uPlot wrapper. Each ChartSpec module has a stable `id`; we keep the
// uPlot instance alive across frames so panning/tooltip state doesn't
// flicker, and just call setData() when new points arrive.

const INSTANCES = new Map(); // id → { plot, mountEl }

export function knownChartIds() {
  return INSTANCES.keys();
}

export function disposeChart(id) {
  const entry = INSTANCES.get(id);
  if (!entry) return;
  try { entry.plot.destroy(); } catch (_) {}
  INSTANCES.delete(id);
}

function buildAlignedData(series) {
  // Series are typically emitted with a shared time axis by the domain
  // layer (all charts share the run's clock). Build a merged sorted x
  // axis, then fill each series' y-array with nulls where absent.
  const xSet = new Set();
  for (const s of series) {
    for (const [t, _] of s.points || []) xSet.add(t);
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);
  const xIndex = new Map(xs.map((t, i) => [t, i]));
  const rows = [xs];
  for (const s of series) {
    const ys = new Array(xs.length).fill(null);
    for (const [t, v] of s.points || []) ys[xIndex.get(t)] = v;
    rows.push(ys);
  }
  return rows;
}

function chartOptsFor(spec, mountEl) {
  const seriesOpts = [{ label: "t (s)" }].concat(
    (spec.series || []).map((s) => ({
      label: s.label,
      stroke: s.color || "#7aa2f7",
      width: 1.5,
      spanGaps: true,
      points: { show: false },
    }))
  );
  const opts = {
    width: mountEl.clientWidth || 400,
    height: mountEl.clientHeight || 200,
    scales: {
      x: { time: false },
      y: {
        auto: spec.y_max == null,
        range: spec.y_max != null ? [0, spec.y_max] : undefined,
      },
    },
    axes: [
      { stroke: "#a1a3ad", grid: { stroke: "#2b2d38" } },
      { stroke: "#a1a3ad", grid: { stroke: "#2b2d38" }, label: spec.unit || "" },
    ],
    series: seriesOpts,
    legend: { show: true },
  };
  return opts;
}

export function makeOrUpdateChart(spec, mountEl) {
  const data = buildAlignedData(spec.series || []);
  const existing = INSTANCES.get(spec.id);
  const seriesCount = (spec.series || []).length;

  if (existing) {
    // If the mount element or the series shape changed, rebuild.
    if (existing.mountEl !== mountEl || (existing.plot.series.length - 1) !== seriesCount) {
      disposeChart(spec.id);
    } else {
      // Fast path: just update the data. Also resize if the container did.
      try {
        const w = mountEl.clientWidth  || existing.plot.width;
        const h = mountEl.clientHeight || existing.plot.height;
        if (w !== existing.plot.width || h !== existing.plot.height) {
          existing.plot.setSize({ width: w, height: h });
        }
        existing.plot.setData(data);
        return;
      } catch (err) {
        console.warn("chart update failed, rebuilding", err);
        disposeChart(spec.id);
      }
    }
  }

  // Fresh instance. Wait for uPlot global.
  if (typeof uPlot === "undefined") return;
  mountEl.innerHTML = "";
  const plot = new uPlot(chartOptsFor(spec, mountEl), data, mountEl);
  INSTANCES.set(spec.id, { plot, mountEl });

  // Handle container resize (window resize etc.) — poll cheaply via RO.
  if (typeof ResizeObserver !== "undefined" && !mountEl.dataset.roAttached) {
    const ro = new ResizeObserver(() => {
      const entry = INSTANCES.get(spec.id);
      if (!entry) return;
      try {
        entry.plot.setSize({
          width: mountEl.clientWidth,
          height: mountEl.clientHeight,
        });
      } catch (_) {}
    });
    ro.observe(mountEl);
    mountEl.dataset.roAttached = "1";
  }
}
