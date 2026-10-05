// Observed + forecast fan chart, drawn as SVG.
// data = { observed: [{year, hm}], forecast: [{year, lo95, lo50, median, hi50, hi95}] }

const SVG = "http://www.w3.org/2000/svg";
const M = { top: 16, right: 14, bottom: 26, left: 38 };
const X0 = 1988, X1 = 2042, DIVIDE = 2022.5;

const fmt = (v) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(3));

export function renderChart(container, data) {
  container.replaceChildren();
  const { width, height } = container.getBoundingClientRect();
  const w = width - M.left - M.right;
  const h = height - M.top - M.bottom;

  const all = [...data.observed.map((d) => d.hm), ...data.forecast.map((d) => d.hi95)].filter(Number.isFinite);
  const yMax = Math.min(1, niceCeil(Math.max(0.05, ...all) * 1.12)); // HM is bounded at 1
  const x = (yr) => M.left + ((yr - X0) / (X1 - X0)) * w;
  const y = (v) => M.top + h - (v / yMax) * h;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, tabindex: 0, role: "img",
    "aria-label": "Human modification index over time. Use left and right arrow keys to read values by year." });
  container.append(svg);

  // grid + y axis
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    svg.append(el("line", { x1: M.left, x2: M.left + w, y1: y(v), y2: y(v), stroke: "var(--line)" }));
    svg.append(text(M.left - 8, y(v) + 4, trimZeros(v.toFixed(3)), { "text-anchor": "end" }));
  }
  // x axis
  for (const yr of [1990, 2000, 2010, 2020, 2030, 2040]) {
    svg.append(text(x(yr), M.top + h + 18, yr, { "text-anchor": "middle" }));
  }

  // observed | forecast divider
  svg.append(el("line", { x1: x(DIVIDE), x2: x(DIVIDE), y1: M.top - 6, y2: M.top + h,
    stroke: "var(--muted)", "stroke-dasharray": "2 4", "stroke-opacity": 0.6 }));
  svg.append(text(x(DIVIDE) - 8, M.top - 4, "observed", { "text-anchor": "end" }));
  svg.append(text(x(DIVIDE) + 8, M.top - 4, "forecast", { "text-anchor": "start" }));

  const fc = data.forecast.filter((d) => Number.isFinite(d.median));
  const obs = data.observed.filter((d) => Number.isFinite(d.hm));

  // uncertainty bands, widest first
  if (fc.length) {
    svg.append(band(fc, "lo95", "hi95", x, y, 0.16));
    svg.append(band(fc, "lo50", "hi50", x, y, 0.42));
  }

  // bridge from the last observation to the first forecast
  if (obs.length && fc.length) {
    const a = obs.at(-1), b = fc[0];
    svg.append(el("line", { x1: x(a.year), y1: y(a.hm), x2: x(b.year), y2: y(b.median),
      stroke: "var(--muted)", "stroke-width": 1.5, "stroke-dasharray": "3 3" }));
  }

  if (fc.length) {
    svg.append(el("path", { d: line(fc.map((d) => [x(d.year), y(d.median)])), fill: "none",
      stroke: "var(--accent)", "stroke-width": 2, "stroke-dasharray": "5 3", "stroke-linejoin": "round" }));
    // open markers distinguish the forecast from the filled observed markers in greyscale
    for (const d of fc) {
      svg.append(el("circle", { cx: x(d.year), cy: y(d.median), r: 4, fill: "var(--paper)",
        stroke: "var(--accent)", "stroke-width": 1.5 }));
    }
  }
  if (obs.length) {
    svg.append(el("path", { d: line(obs.map((d) => [x(d.year), y(d.hm)])), fill: "none",
      stroke: "var(--ink)", "stroke-width": 2, "stroke-linejoin": "round" }));
    for (const d of obs) svg.append(dot(x(d.year), y(d.hm), "var(--ink)"));
  }

  // ---- hover / keyboard layer ----
  const rows = [
    ...obs.map((d) => ({ year: d.year, kind: "obs", d })),
    ...fc.map((d) => ({ year: d.year, kind: "fc", d })),
  ].sort((a, b) => a.year - b.year);
  if (!rows.length) return;

  const cross = el("line", { y1: M.top, y2: M.top + h, stroke: "var(--ink)", "stroke-opacity": 0.35, visibility: "hidden" });
  const ring = el("circle", { r: 6, fill: "none", stroke: "var(--ink)", "stroke-width": 2, visibility: "hidden" });
  svg.append(cross, ring);
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  container.append(tip);

  let active = -1;
  const show = (i) => {
    active = i;
    const r = rows[i];
    const cx = x(r.year);
    const cy = y(r.kind === "obs" ? r.d.hm : r.d.median);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
    ring.setAttribute("cx", cx); ring.setAttribute("cy", cy);
    cross.setAttribute("visibility", "visible"); ring.setAttribute("visibility", "visible");
    tip.innerHTML = r.kind === "obs"
      ? `<strong>${r.year} observed</strong><div class="row">HM index <b>${fmt(r.d.hm)}</b></div>`
      : `<strong>${r.year} forecast</strong>
         <div class="row">Median <b>${fmt(r.d.median)}</b></div>
         <div class="row">50% interval <b>${fmt(r.d.lo50)} – ${fmt(r.d.hi50)}</b></div>
         <div class="row">95% interval <b>${fmt(r.d.lo95)} – ${fmt(r.d.hi95)}</b></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${cx + 14 + tw > width ? cx - 14 - tw : cx + 14}px`;
  };
  const hide = () => {
    active = -1;
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    ring.setAttribute("visibility", "hidden");
  };
  const nearest = (px) => {
    let best = 0;
    rows.forEach((r, i) => { if (Math.abs(x(r.year) - px) < Math.abs(x(rows[best].year) - px)) best = i; });
    return best;
  };

  const hit = el("rect", { x: M.left, y: 0, width: w, height: M.top + h, fill: "transparent" });
  svg.append(hit);
  hit.addEventListener("pointermove", (e) => {
    const pt = svg.getBoundingClientRect();
    show(nearest(((e.clientX - pt.left) / pt.width) * width));
  });
  hit.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(Math.min(rows.length - 1, active + 1));
    else if (e.key === "ArrowLeft") show(Math.max(0, active < 0 ? rows.length - 1 : active - 1));
    else if (e.key === "Escape") hide();
    else return;
    e.preventDefault();
  });
  svg.addEventListener("blur", hide);
}

export function renderMessage(container, message, { loading = false } = {}) {
  const box = document.createElement("div");
  box.className = "msg";
  const inner = document.createElement("span");
  if (loading) {
    const spin = document.createElement("span");
    spin.className = "spinner";
    inner.append(spin);
  }
  inner.append(message);
  box.append(inner);
  container.replaceChildren(box);
}

function band(rows, lo, hi, x, y, opacity) {
  const top = rows.map((d) => [x(d.year), y(d[hi])]);
  const bottom = rows.map((d) => [x(d.year), y(d[lo])]).reverse();
  return el("path", { d: `${line(top)}L${line(bottom).slice(1)}Z`, fill: "var(--accent)", "fill-opacity": opacity });
}

function dot(cx, cy, fill) {
  // 8px marker with a 2px surface ring so it separates from lines and bands
  return el("circle", { cx, cy, r: 4, fill, stroke: "var(--panel-solid)", "stroke-width": 2, "paint-order": "stroke" });
}

function line(points) {
  return points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
}

function text(x, y, content, attrs = {}) {
  const t = el("text", { x, y, fill: "var(--muted)", "font-size": 11, ...attrs });
  t.textContent = content;
  return t;
}

function el(name, attrs) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function niceCeil(v) {
  const steps = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1];
  return steps.find((s) => s >= v) ?? Math.ceil(v * 10) / 10;
}

function trimZeros(s) {
  return s.replace(/\.?0+$/, "");
}
