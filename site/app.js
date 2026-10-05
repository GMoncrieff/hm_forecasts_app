import { renderChart, renderMessage } from "./chart.js";

const PROXY = window.HM_CONFIG.proxyUrl.replace(/\/$/, "");
const GROUP = { forecast: "hm_prob_forecast", observed: "hm_observed" };

// Used until the EDR collection metadata arrives (or if it fails).
const FALLBACK = {
  observed: [1990, 1995, 2000, 2005, 2010, 2015, 2020],
  forecast: [2025, 2030, 2035, 2040],
  percentiles: [
    0.024801749889877028, 0.038296188484920536, 0.05836330120038108, 0.08779180991610301, 0.13035213333312026,
    0.19105299940950107, 0.2764294631604578, 0.394852105661, 0.5568407781407838, 0.7753591023511082,
    1.0660586765399767, 1.4474354604237885, 1.9408562378944998, 2.5, 2.5704116209237124, 3.3625549694056613,
    4.345494836203591, 5.548322627404129, 6.9998769515125066, 8.727370649193233, 10.754833890057647,
    13.101454319646555, 15.779919766413691, 18.794886973822557, 22.141707951756857, 25.80554135747783,
    29.76095858353775, 33.972123317768535, 38.393581369234816, 42.97164828236099, 47.64633070471718, 50.0,
    52.353669295283964, 57.02835171764013, 61.60641863076628, 66.02787668223253, 70.23904141646324,
    74.1944586425231, 77.85829204824401, 81.20511302617821, 84.220080233587, 86.89854568035406,
    89.24516610994286, 91.27262935080722, 93.00012304848788, 94.4516773725962, 95.65450516379667,
    96.63744503059456, 97.42958837907646, 97.5, 98.05914376210563, 98.55256453957631, 98.9339413234601,
    99.22464089764895, 99.44315922185926, 99.60514789433903, 99.72357053683957, 99.80894700059052,
    99.8696478666669, 99.9122081900839, 99.94163669879963, 99.96170381151508, 99.97519825011013, 99.99,
  ],
};

// matplotlib magma at 0, 0.1, … 1 — keep in sync with --magma in styles.css
const MAGMA = ["#000004", "#140e36", "#3b0f70", "#641a80", "#8c2981", "#b73779", "#de4968", "#f7705c", "#fe9f6d", "#fecf92", "#fcfdbf"];
const COLORMAP = JSON.stringify(Object.fromEntries(MAGMA.map((c, i) => [Math.round((i * 255) / (MAGMA.length - 1)), c])));

const meta = { ...FALLBACK };
const state = { mode: "forecast", year: 2040, percentile: 50, point: null };

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- globe

const esri = (name) =>
  new Cesium.UrlTemplateImageryProvider({
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`,
    maximumLevel: 16,
    credit: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  });

const viewer = new Cesium.Viewer("globe", {
  baseLayer: new Cesium.ImageryLayer(esri("World_Light_Gray_Base")),
  skyBox: false,
  skyAtmosphere: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: true,
  sceneModePicker: true,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
});
const scene = viewer.scene;
// Plain white page: no stars or blue atmosphere tint (skyBox: false also drops the sun and moon).
scene.globe.baseColor = Cesium.Color.fromCssColorString("#d9d9d9");
scene.globe.showGroundAtmosphere = false;
scene.backgroundColor = Cesium.Color.WHITE;
scene.fog.enabled = false;

const labels = viewer.imageryLayers.addImageryProvider(esri("World_Light_Gray_Reference"));

const home = Cesium.Cartesian3.fromDegrees(20, 8, 19_000_000);
viewer.camera.setView({ destination: home });
viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
  e.cancel = true;
  viewer.camera.flyTo({ destination: home, duration: 1.2 });
});

let hmLayer = null;
let staleLayers = [];

function tileUrl() {
  const q = new URLSearchParams({
    variables: "hm",
    style: "raster/custom",
    colormap: COLORMAP,
    colorscalerange: "0,1",
    width: "256",
    height: "256",
    year: String(state.year),
  });
  if (state.mode === "forecast") q.set("percentile", String(state.percentile));
  return `${PROXY}/tiles/${GROUP[state.mode]}/tiles/WebMercatorQuad/{z}/{y}/{x}?${q}`;
}

function updateLayer() {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: tileUrl(),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(-180, -70, 180, 84),
    minimumLevel: 3, // the service has no overviews below z3
    maximumLevel: 8, // ~0.6 km pixels; Cesium upsamples beyond this
    credit: "Human Modification: The Nature Conservancy",
  });
  if (hmLayer) staleLayers.push(hmLayer);
  hmLayer = viewer.imageryLayers.addImageryProvider(provider, viewer.imageryLayers.indexOf(labels));
  scene.requestRender();
  writeHash();
}

// Keep the previous layer visible until the new one has finished loading.
scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
  if (queued === 0) {
    for (const layer of staleLayers) viewer.imageryLayers.remove(layer, true);
    staleLayers = [];
    setStatus(state.point ? "" : "Click anywhere on land to see how it changes over time.");
  } else {
    setStatus(`Rendering map tiles (${queued} left)`, { loading: true });
  }
});

// ---------------------------------------------------------------- controls

const pctInput = $("percentile");

function renderControls() {
  for (const b of $("mode").querySelectorAll("button")) b.setAttribute("aria-checked", b.dataset.mode === state.mode);

  const years = meta[state.mode];
  $("years").replaceChildren(
    ...years.map((yr) => {
      const b = document.createElement("button");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", yr === state.year);
      b.textContent = yr;
      b.addEventListener("click", () => {
        state.year = yr;
        renderControls();
        updateLayer();
      });
      return b;
    }),
  );

  const forecast = state.mode === "forecast";
  $("percentile-control").setAttribute("aria-disabled", !forecast);
  pctInput.disabled = !forecast;
  pctInput.max = meta.percentiles.length - 1;
  pctInput.value = meta.percentiles.indexOf(state.percentile);
  showPercentile(state.percentile);
}

function showPercentile(p) {
  $("percentile-value").textContent = ordinal(p);
  pctInput.setAttribute("aria-valuetext", `${ordinal(p)} percentile`);
  for (const b of $("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", Number(b.dataset.p) === p);
}

$("mode").addEventListener("click", (e) => {
  const mode = e.target.closest("button")?.dataset.mode;
  if (!mode || mode === state.mode) return;
  state.mode = mode;
  state.year = mode === "forecast" ? meta.forecast.at(-1) : meta.observed.at(-1);
  renderControls();
  updateLayer();
});

// Radio-group arrow-key navigation for the segmented controls.
for (const group of [$("mode"), $("years")]) {
  group.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const buttons = [...group.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    const next = buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    next.click();
    group.querySelectorAll("button")[buttons.indexOf(next)].focus();
  });
}

pctInput.addEventListener("input", () => showPercentile(meta.percentiles[pctInput.value]));
pctInput.addEventListener("change", () => {
  state.percentile = meta.percentiles[pctInput.value];
  updateLayer();
});

$("presets").addEventListener("click", (e) => {
  const p = Number(e.target.closest("button")?.dataset.p);
  if (!p) return;
  state.percentile = p;
  renderControls();
  updateLayer();
});

function ordinal(p) {
  const s = p < 1 ? String(Number(p.toPrecision(2))) : String(Number(p.toFixed(p < 99 ? 1 : 2)));
  if (s.includes(".")) return `${s}th`;
  const n = Number(s);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${s}${suffix}`;
}

function setStatus(message, { loading = false } = {}) {
  const box = $("status");
  box.replaceChildren(message);
  if (loading) {
    const spin = document.createElement("span");
    spin.className = "spinner";
    box.prepend(spin);
  }
}

// ---------------------------------------------------------------- pixel time series

// Lifted slightly off the ellipsoid so it depth-tests cleanly: visible in front, hidden behind the globe.
const MARKER_HEIGHT = 100;
const marker = viewer.entities.add({
  show: false,
  position: Cesium.Cartesian3.fromDegrees(0, 0),
  point: {
    pixelSize: 11,
    color: Cesium.Color.BLACK,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2,
  },
});

new Cesium.ScreenSpaceEventHandler(scene.canvas).setInputAction((e) => {
  const cartesian = viewer.camera.pickEllipsoid(e.position, scene.globe.ellipsoid);
  if (!cartesian) return;
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  selectPoint(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude));
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

$("sheet-close").addEventListener("click", () => {
  $("sheet").hidden = true;
  document.body.classList.remove("sheet-open");
  marker.show = false;
  state.point = null;
  scene.requestRender();
  writeHash();
});

let requestId = 0;

async function selectPoint(lon, lat) {
  const id = ++requestId;
  state.point = [lon, lat];
  writeHash();
  marker.position = Cesium.Cartesian3.fromDegrees(lon, lat, MARKER_HEIGHT);
  marker.show = true;
  scene.requestRender();

  $("sheet").hidden = false;
  document.body.classList.add("sheet-open");
  $("sheet-where").textContent = formatLonLat(lon, lat);
  $("values-table").replaceChildren();
  $("download").removeAttribute("href");
  lastData = null;
  renderMessage($("chart"), "Fetching the time series for this pixel…", { loading: true });

  // One request per percentile is much faster than asking for all 64 at once.
  const bands = { lo95: 2.5, lo50: nearestPct(25), median: 50, hi50: nearestPct(75), hi95: 97.5 };
  const coords = `POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`;
  const edr = (group, extra = {}) =>
    fetchCsv(`${PROXY}/edr/${group}/edr/position?${new URLSearchParams({ f: "csv", "parameter-name": "hm", coords, ...extra })}`);

  const [obsRes, ...bandRes] = await Promise.allSettled([
    edr(GROUP.observed),
    ...Object.values(bands).map((p) => edr(GROUP.forecast, { percentile: String(p) })),
  ]);
  if (id !== requestId) return; // a newer click superseded this one

  const observed = obsRes.status === "fulfilled" ? obsRes.value.map((r) => ({ year: r.year, hm: r.hm })) : [];
  const byYear = new Map();
  Object.keys(bands).forEach((key, i) => {
    if (bandRes[i].status !== "fulfilled") return;
    for (const r of bandRes[i].value) {
      if (!byYear.has(r.year)) byYear.set(r.year, { year: r.year });
      byYear.get(r.year)[key] = r.hm;
    }
  });
  const forecast = [...byYear.values()].sort((a, b) => a.year - b.year);

  const failed = [obsRes, ...bandRes].filter((r) => r.status === "rejected");
  const anyValue = [...observed.map((d) => d.hm), ...forecast.map((d) => d.median)].some(Number.isFinite);

  if (!anyValue) {
    renderMessage($("chart"), failed.length
      ? `The data service didn't respond (${failed[0].reason.message}). Click the point again to retry.`
      : "No data for this pixel. It's probably water or outside the mapped land area; try a nearby spot.");
    return;
  }

  // Snap the marker to the centre of the pixel the service actually used.
  const ref = obsRes.value?.[0] ?? bandRes.find((r) => r.status === "fulfilled")?.value[0];
  if (ref) {
    marker.position = Cesium.Cartesian3.fromDegrees(ref.longitude, ref.latitude, MARKER_HEIGHT);
    $("sheet-where").textContent = `Pixel centred on ${formatLonLat(ref.longitude, ref.latitude)}`;
    scene.requestRender();
  }

  const data = { observed, forecast };
  lastData = data;
  renderChart($("chart"), data);
  renderTable(data, bands);
  if (failed.length) setStatus(`Some of the series failed to load (${failed[0].reason.message}). Click again to retry.`);
}

async function fetchCsv(url, attempts = 2) {
  for (let i = 1; ; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseCsv(await res.text());
    } catch (err) {
      if (i >= attempts) throw err.name === "AbortError" ? new Error("timed out") : err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  if (!cols.includes("hm")) throw new Error("unexpected response from the data service");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] === "" ? NaN : Number(cells[i])]));
  });
}

function nearestPct(p) {
  return meta.percentiles.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
}

function renderTable({ observed, forecast }, bands) {
  const f = (v) => (Number.isFinite(v) ? v.toFixed(4) : "");
  const header = ["Year", "Observed", `P${ordinal(bands.lo95)}`, `P${ordinal(bands.lo50)}`, "Median",
    `P${ordinal(bands.hi50)}`, `P${ordinal(bands.hi95)}`];
  const rows = [
    ...observed.map((d) => [d.year, f(d.hm), "", "", "", "", ""]),
    ...forecast.map((d) => [d.year, "", f(d.lo95), f(d.lo50), f(d.median), f(d.hi50), f(d.hi95)]),
  ];

  const table = document.createElement("table");
  const tr = (cells, tag) => {
    const row = document.createElement("tr");
    for (const c of cells) {
      const cell = document.createElement(tag);
      cell.textContent = c;
      row.append(cell);
    }
    return row;
  };
  table.append(tr(header, "th"), ...rows.map((r) => tr(r, "td")));
  $("values-table").replaceChildren(table);

  const [lon, lat] = state.point;
  const csvHeader = ["year", "observed", ...Object.values(bands).map((p) => `p${p}`)];
  const csv = [`# lon=${lon.toFixed(5)} lat=${lat.toFixed(5)}`, csvHeader.join(","), ...rows.map((r) => r.join(","))].join("\n");
  $("download").href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
}

function formatLonLat(lon, lat) {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
}

// Re-draw the chart at its new size when the window changes.
let lastData = null;
new ResizeObserver(() => {
  if (lastData && $("chart").querySelector("svg")) renderChart($("chart"), lastData);
}).observe($("chart"));

// ---------------------------------------------------------------- URL state

function writeHash() {
  const q = new URLSearchParams({ mode: state.mode, year: state.year });
  if (state.mode === "forecast") q.set("p", state.percentile);
  if (state.point) q.set("pt", state.point.map((v) => v.toFixed(4)).join(","));
  history.replaceState(null, "", `#${q}`);
}

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get("mode") in GROUP) state.mode = q.get("mode");
  const yr = Number(q.get("year"));
  state.year = meta[state.mode].includes(yr) ? yr : meta[state.mode].at(-1);
  const p = Number(q.get("p"));
  if (meta.percentiles.includes(p)) state.percentile = p;
  const pt = q.get("pt")?.split(",").map(Number);
  return pt?.length === 2 && pt.every(Number.isFinite) ? pt : null;
}

// ---------------------------------------------------------------- start

async function loadMetadata() {
  const get = async (group) => {
    const res = await fetch(`${PROXY}/edr/${group}/edr/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).extent;
  };
  try {
    const [fc, obs] = await Promise.all([get(GROUP.forecast), get(GROUP.observed)]);
    meta.forecast = fc.year.values.map(Number);
    meta.observed = obs.year.values.map(Number);
    meta.percentiles = fc.percentile.values.map(Number);
  } catch (err) {
    console.warn("Using built-in dimension values; metadata request failed:", err);
  }
}

await loadMetadata();
const initialPoint = readHash();
renderControls();
updateLayer();
if (initialPoint) {
  // Centre the shared point, nudged so it isn't under the time-series sheet.
  const [lon, lat] = initialPoint;
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon + 12, lat - 8, 12_000_000) });
  selectPoint(lon, lat);
}
