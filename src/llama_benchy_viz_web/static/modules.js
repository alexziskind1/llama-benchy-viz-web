// One render_<kind>(spec) function per ModuleSpec kind, plus a
// disposeStaleCharts helper so uPlot instances don't leak when a chart
// module leaves the view-model.

import {
  makeOrUpdateChart,
  disposeChart,
  knownChartIds,
  getChartWrapper,
  setChartWrapper,
} from "/static/chart.js";

// ─── format helpers ───────────────────────────────────────────────────

function formatMetric(m) {
  if (!m || m.value === null || m.value === undefined) return "—";
  const fmt = m.fmt || "{:.1f}";
  const match = /{:\.(\d+)f}/.exec(fmt);
  const digits = match ? Number(match[1]) : 1;
  const value = Number(m.value).toFixed(digits);
  return m.unit ? `${value} ${m.unit}` : value;
}

function splitValueUnit(m) {
  if (!m || m.value === null || m.value === undefined) return ["—", ""];
  const fmt = m.fmt || "{:.1f}";
  const match = /{:\.(\d+)f}/.exec(fmt);
  const digits = match ? Number(match[1]) : 1;
  return [Number(m.value).toFixed(digits), m.unit || ""];
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        // CSS custom properties (--x) don't flow through style object
        // assignment; use setProperty explicitly.
        if (prop.startsWith("--")) n.style.setProperty(prop, val);
        else n.style[prop] = val;
      }
    }
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}

function svgEl(tag, attrs = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    n.setAttribute(k, v);
  }
  return n;
}

function sparklineSVG(values, color) {
  // Line + area fill, sized to fill its container via viewBox.
  if (!values || values.length < 2) return el("span");
  const w = 200, h = 42, pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pointsArr = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return [x, y];
  });
  const linePts = pointsArr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = [
    `M ${pointsArr[0][0].toFixed(1)},${(h - pad).toFixed(1)}`,
    ...pointsArr.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`),
    `L ${pointsArr[pointsArr.length - 1][0].toFixed(1)},${(h - pad).toFixed(1)} Z`,
  ].join(" ");
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none" });
  const area = svgEl("path", { class: "sparkline-area", d: areaPath });
  const line = svgEl("polyline", { class: "sparkline-line", points: linePts });
  svg.appendChild(area);
  svg.appendChild(line);
  return svg;
}

// ─── per-kind renderers ───────────────────────────────────────────────

function renderHeader(s) {
  const stats = el("span", { class: "stats" });
  if (s.benchmark_name) stats.appendChild(el("span", {}, s.benchmark_name));
  if (s.configured_count != null) {
    if (stats.children.length) stats.appendChild(el("span", { class: "dot" }));
    stats.appendChild(el("span", {}, `${s.active_count ?? 0}/${s.configured_count} active`));
  }

  return el("div", { class: "header" }, [
    el("span", { class: "title" }, [
      el("span", {}, s.title || "LLM BENCH"),
      " ",
      el("span", { class: "accent" }, s.accent || "VIZ"),
    ]),
    stats,
    s.elapsed_s != null ? el("span", { class: "elapsed" }, `${s.elapsed_s.toFixed(1)}s elapsed`) : null,
    el("span", { class: `mode-badge ${s.is_live ? "live" : "frozen"}` }, s.mode_label || ""),
  ]);
}

function renderSummaryStrip(s) {
  const strip = el("div", { class: "summary-strip" });
  for (const c of s.cards || []) {
    strip.appendChild(el("div", { class: "summary-card" }, [
      el("div", { class: "title" }, [
        c.icon ? el("span", { style: c.icon_color ? { color: c.icon_color } : {} }, c.icon) : null,
        el("span", {}, c.title || ""),
      ]),
      el("div", { class: "primary", style: c.primary_color ? { color: c.primary_color } : {} }, c.primary || "—"),
      el("div", { class: "secondary" }, c.secondary || ""),
    ]));
  }
  return strip;
}

function renderStreamCard(s) {
  const stream = s.stream || {};
  const [bigVal, bigUnit] = splitValueUnit(s.big_metric);

  const metricsCells = [];
  for (const row of s.metrics_grid || []) {
    for (const m of row) {
      metricsCells.push(el("div", { class: "metric-cell" }, [
        el("span", { class: "metric-label" }, m.label || ""),
        el("span", { class: "metric-value" }, formatMetric(m)),
      ]));
    }
  }

  return el("div", {
    class: "stream-card",
    style: stream.color ? { "--stream-color": stream.color } : {},
  }, [
    el("div", { class: "name-row" }, [
      el("span", { class: "name" }, stream.label || `slot ${stream.slot_index ?? "?"}`),
      (s.show_phase && s.phase) ? el("span", { class: `phase ${s.phase}` }, s.phase) : null,
    ]),
    el("div", { class: "hero" }, [
      el("span", { class: "big-metric" }, bigVal),
      el("span", { class: "big-metric-unit" }, bigUnit),
    ]),
    (s.sparkline && s.sparkline.length > 1)
      ? el("div", { class: "sparkline" }, [sparklineSVG(s.sparkline, stream.color)])
      : null,
    // Snippet goes ABOVE the metrics block — it flex-grows to absorb
    // whatever vertical slack the card has, so a tall race card
    // becomes a live "reading pane" of the model's output rather than
    // a strip of text pinned to the bottom.
    (s.show_output && s.output_snippet) ? el("div", { class: "snippet" }, s.output_snippet) : null,
    metricsCells.length ? el("div", { class: "metrics-grid" }, metricsCells) : null,
  ]);
}

function renderStreamGrid(s) {
  const n = (s.cards || []).length;
  const shape = s.grid_shape === "auto"
    ? (n <= 1 ? "1x1" : n === 2 ? "1x2" : n <= 4 ? "2x2" : "1xN")
    : (s.grid_shape || "auto");
  const grid = el("div", { class: `stream-grid grid-${shape}` });
  for (const c of s.cards || []) grid.appendChild(renderStreamCard(c));
  return grid;
}

function renderChart(s) {
  let wrap = getChartWrapper(s.id);
  if (!wrap) {
    wrap = el("div", { class: "card chart-card" }, [
      el("h2", {}, [
        s.title || "",
        s.unit ? el("span", { class: "subtitle" }, `(${s.unit})`) : null,
      ]),
      el("div", { class: "chart-mount", dataset: { moduleId: s.id } }),
    ]);
    setChartWrapper(s.id, wrap);
  } else {
    // Just refresh the title if it changed.
    const h2 = wrap.querySelector("h2");
    if (h2) {
      h2.replaceChildren(
        document.createTextNode(s.title || ""),
        ...(s.unit ? [el("span", { class: "subtitle" }, `(${s.unit})`)] : []),
      );
    }
  }
  queueMicrotask(() => {
    const mount = wrap.querySelector(".chart-mount");
    if (mount && mount.isConnected) makeOrUpdateChart(s, mount);
  });
  return wrap;
}

function renderRankingTable(s) {
  const [_, unit] = splitValueUnit(s.rows?.[0]?.primary_metric || {});
  const rows = [];
  for (const r of s.rows || []) {
    const delta = r.delta_to_leader;
    let deltaCell;
    if (delta === null || delta === undefined || r.rank === 1) {
      deltaCell = el("td", { class: "num delta" }, r.rank === 1 ? "leader" : "—");
    } else {
      const sign = delta >= 0 ? "+" : "";
      const cls = (s.higher_is_better === false ? delta <= 0 : delta >= 0) ? "good" : "bad";
      deltaCell = el("td", { class: `num delta ${cls}` }, `${sign}${delta.toFixed(1)}`);
    }
    rows.push(el("tr", { class: `rank-${r.rank}` }, [
      el("td", { class: "rank" }, [el("span", { class: "rank-badge" }, String(r.rank))]),
      el("td", { class: "name", style: r.stream?.color ? { color: r.stream.color } : {} }, r.stream?.label || ""),
      el("td", { class: "num" }, formatMetric(r.primary_metric)),
      deltaCell,
    ]));
  }
  return el("div", { class: "card" }, [
    el("h2", {}, [s.title || "RANKING", el("span", { class: "subtitle" }, s.subtitle || "")]),
    el("table", { class: "ranking-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, "#"),
        el("th", {}, "model"),
        el("th", { style: { textAlign: "right" } }, unit || "value"),
        el("th", { style: { textAlign: "right" } }, "Δ leader"),
      ])]),
      el("tbody", {}, rows),
    ]),
  ]);
}

function renderEventLog(s) {
  const list = el("div", { class: "events" });
  for (const e of s.entries || []) {
    list.appendChild(el("div", { class: "event-row" }, [
      el("span", { class: "event-ts" }, e.ts != null ? `${e.ts.toFixed(1)}s` : ""),
      el("span", { class: "event-label", style: e.stream_color ? { color: e.stream_color } : {} }, e.label || ""),
      el("span", { class: "event-text" }, e.text || ""),
    ]));
  }
  return el("div", { class: "card" }, [
    el("h2", {}, [s.title || "EVENTS", el("span", { class: "subtitle" }, s.subtitle || "")]),
    list,
  ]);
}

function renderCellsTable(s) {
  const rows = [];
  for (const r of s.rows || []) {
    const empty = r.runs_empty > 0 && r.runs_done === 0;
    const err   = r.runs_errored > 0 && r.runs_done === 0;
    const inflight = r.runs_in_flight > 0;
    const statusClass = err ? "err" : empty ? "empty" : "ok";
    const statusGlyph = err ? "✗" : empty ? "⚠" : inflight ? "…" : "✓";
    rows.push(el("tr", {}, [
      el("td", { class: `status ${statusClass}` }, statusGlyph),
      el("td", { class: "name", style: r.stream?.color ? { color: r.stream.color } : {} }, r.stream?.label || ""),
      el("td", {}, String(r.pp)),
      el("td", {}, String(r.tg)),
      el("td", {}, String(r.depth)),
      el("td", {}, String(r.concurrency)),
      el("td", {}, r.pp_tps != null ? r.pp_tps.toFixed(1) : "—"),
      el("td", {}, r.tg_tps != null ? r.tg_tps.toFixed(1) : "—"),
      el("td", {}, r.peak_tg != null ? r.peak_tg.toFixed(1) : "—"),
      el("td", {}, r.ttfr_ms != null ? r.ttfr_ms.toFixed(0) : "—"),
      el("td", {}, r.est_ppt_ms != null ? r.est_ppt_ms.toFixed(0) : "—"),
      el("td", {}, r.e2e_ttft_ms != null ? r.e2e_ttft_ms.toFixed(0) : "—"),
      el("td", {}, `${r.runs_done}/${r.runs_done + r.runs_in_flight + r.runs_empty + r.runs_errored}`),
    ]));
  }
  return el("div", { class: "card" }, [
    el("h2", {}, s.title || "CELLS"),
    el("table", { class: "cells-table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ""), el("th", { class: "name" }, "model"),
        el("th", {}, "pp"), el("th", {}, "tg"), el("th", {}, "depth"), el("th", {}, "conc"),
        el("th", {}, "pp tok/s"), el("th", {}, "tg tok/s"), el("th", {}, "peak tg"),
        el("th", {}, "ttfr ms"), el("th", {}, "est_ppt ms"), el("th", {}, "e2e_ttft ms"),
        el("th", {}, "runs"),
      ])]),
      el("tbody", {}, rows),
    ]),
  ]);
}

function renderRunMetadata(s) {
  const rows = [];
  const kv = (k, v) => rows.push(el("div", { class: "kv" }, [
    el("span", { class: "k" }, k),
    el("span", { class: "v" }, v),
  ]));
  kv("producer",   s.producer_version || "—");
  kv("schema",     s.schema_version   || "—");
  if (s.latency_ms !== null && s.latency_ms !== undefined) {
    kv("latency",  `${s.latency_ms.toFixed(2)} ms (${s.latency_mode || "?"})`);
  }
  if (s.started_ts)  kv("started",  new Date(s.started_ts * 1000).toLocaleTimeString());
  if (s.finished_ts) kv("finished", new Date(s.finished_ts * 1000).toLocaleTimeString());
  return el("div", { class: "card" }, [
    el("h2", {}, "RUN METADATA"),
    el("div", { class: "run-metadata" }, rows),
  ]);
}

function renderModelMetricsCard(s) {
  // Same layout as StreamCard — sizes are governed by the parent region.
  return renderStreamCard(s);
}

function renderFooter(s) {
  const parts = [
    el("span", { class: `badge ${s.status}` }, s.status || ""),
    el("span", {}, s.mode_label || ""),
    el("span", { class: "dot" }),
    el("span", { class: "mono" }, `schema ${s.schema_version || "?"}`),
    el("span", { class: "dot" }),
    el("span", { class: "mono" }, `producer ${s.producer_version || "?"}`),
    el("span", { class: "hint" }, `press ${s.quit_hint || "Ctrl+C"} in server terminal to quit`),
  ];
  return el("div", { class: "footer" }, parts);
}

const DISPATCH = {
  header:              renderHeader,
  summary_strip:       renderSummaryStrip,
  model_metrics_card:  renderModelMetricsCard,
  stream_card:         renderStreamCard,
  stream_grid:         renderStreamGrid,
  chart:               renderChart,
  ranking_table:       renderRankingTable,
  event_log:           renderEventLog,
  cells_table:         renderCellsTable,
  run_metadata:        renderRunMetadata,
  footer:              renderFooter,
};

export function renderModule(spec) {
  const fn = DISPATCH[spec.kind];
  if (!fn) {
    return el("div", { class: "card" }, [
      el("h2", {}, `unknown module: ${spec.kind}`),
      el("pre", { style: { color: "var(--fg-3)", whiteSpace: "pre-wrap" } }, JSON.stringify(spec, null, 2)),
    ]);
  }
  return fn(spec);
}

export function disposeStaleCharts(activeIds) {
  for (const id of Array.from(knownChartIds())) {
    if (!activeIds.has(id)) disposeChart(id);
  }
}
