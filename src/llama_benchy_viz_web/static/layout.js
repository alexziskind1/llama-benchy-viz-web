// LayoutSpec + modules → DOM region tree.
//
// The dashboard div uses CSS grid; every region_id from the layout maps
// to a `[data-region="..."]` child. Rebuilt on every "view" frame — the
// only per-instance state we keep is inside chart mounts (uPlot needs to
// live across frames to avoid teardown-flicker).

import { renderModule, disposeStaleCharts } from "/static/modules.js";

const REGIONS = [
  "header",
  "summary",
  "main_left",
  "main_right",
  "main_right_bottom",
  "detail_band",
  "footer",
];

function ensureRegion(root, regionId) {
  let el = root.querySelector(`[data-region="${regionId}"]`);
  if (!el) {
    el = document.createElement("div");
    el.dataset.region = regionId;
    root.appendChild(el);
  }
  return el;
}

export function renderView(vm, root) {
  root.dataset.mode = vm.mode;

  // Guarantee all region containers exist so CSS grid stays stable.
  const regionEls = new Map();
  for (const r of REGIONS) regionEls.set(r, ensureRegion(root, r));

  // Reset each region we're about to write into. Regions not touched
  // this frame keep their previous content, but layout.regions always
  // enumerates every region a mode uses.
  const usedIds = new Set();

  for (const region of vm.layout.regions) {
    const el = regionEls.get(region.region_id);
    if (!el) continue;
    el.innerHTML = "";
    el.dataset.orientation = region.orientation || "vertical";
    for (const modId of region.module_ids) {
      const spec = vm.modules[modId];
      if (!spec) continue;
      usedIds.add(modId);
      const rendered = renderModule(spec);
      if (rendered) el.appendChild(rendered);
    }
  }

  // Regions declared in REGIONS but not used by this mode → clear.
  const modeRegionIds = new Set(vm.layout.regions.map((r) => r.region_id));
  for (const r of REGIONS) {
    if (!modeRegionIds.has(r)) regionEls.get(r).innerHTML = "";
  }

  disposeStaleCharts(usedIds);
}
