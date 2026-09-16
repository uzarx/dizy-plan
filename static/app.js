"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const canvas = $("#canvas"),
  ctx = canvas.getContext("2d");
let project = null,
  selected = null,
  tool = "select",
  view = { x: 0, y: 0, scale: 1 },
  fitScale = 1;
let width = 1,
  height = 1,
  dpr = 1,
  gesture = null,
  draft = null,
  pointer = [0, 0],
  space = false,
  history = [],
  future = [],
  saveTimer,
  toastTimer,
  db = null,
  notePoint = null,
  noteEdit = null,
  loading = false;
const palette = [
  "#465647",
  "#64775b",
  "#89977d",
  "#8b856d",
  "#728a7f",
  "#a2ab95",
];
const layerColor = (name) =>
  /WALL|POCHE/.test(name)
    ? "#425143"
    : /DIM/.test(name)
      ? "#a8aa96"
      : /TEXT|ANNO|NOTE/.test(name)
        ? "#617255"
        : /FURN|FIXT/.test(name)
          ? "#7a8b6c"
          : palette[
              [...name].reduce((a, c) => a + c.charCodeAt(0), 0) %
                palette.length
            ];
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4300);
}
function busy(on, text = "Plan ochilmoqda…") {
  loading = on;
  $("#busy").hidden = !on;
  $("#busy-text").textContent = text;
  for (const s of [
    "#plan-picker",
    "#open-btn",
    "#save-btn",
    "#handoff-btn",
    "#export-btn",
  ])
    $(s).disabled = on;
}
async function api(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw Error((await r.json()).error);
  return r;
}
function editState() {
  return JSON.stringify({
    edits: project.edits,
    additions: project.additions,
    notes: project.notes,
    brief: project.brief,
    layers: project.layers,
  });
}
function checkpoint() {
  if (!project) return;
  history.push(editState());
  if (history.length > 80) history.shift();
  future = [];
  updateHistory();
}
function restore(s) {
  Object.assign(project, JSON.parse(s));
  selected = null;
  draft = null;
  syncUI();
  changed();
}
function undo() {
  if (!history.length) return;
  future.push(editState());
  restore(history.pop());
  updateHistory();
}
function redo() {
  if (!future.length) return;
  history.push(editState());
  restore(future.pop());
  updateHistory();
}
function updateHistory() {
  $("#undo-btn").disabled = !history.length;
  $("#redo-btn").disabled = !future.length;
}
function changed() {
  render();
  renderSelection();
  renderNotes();
  $("#save-state").textContent = "Saqlanmoqda…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autosave, 400);
}
async function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dizy-plan-community", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function autosave() {
  if (!project || !db) return;
  try {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(project, "current");
    tx.objectStore("projects").put(project, "project:" + project.name);
    tx.oncomplete = () =>
      ($("#save-state").textContent = "Shu brauzerda saqlandi");
    tx.onerror = () => {
      $("#save-state").textContent = "Avtosaqlash ishlamadi";
      toast("Loyihani saqlash tugmasi orqali nusxa oling.");
    };
  } catch (e) {
    toast("Avtosaqlash ishlamadi. Loyihani faylga saqlang.");
  }
}
function loadSaved(key = "current") {
  return new Promise((resolve) => {
    const r = db.transaction("projects").objectStore("projects").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}
function validateProject(p) {
  if (
    !p ||
    p.version !== 1 ||
    !p.source ||
    !Array.isArray(p.entities) ||
    !Array.isArray(p.layers) ||
    !Array.isArray(p.notes) ||
    !Array.isArray(p.additions)
  )
    throw Error("Bu Dizy loyiha fayli emas.");
  if (!p.edits || typeof p.edits !== "object")
    throw Error("Loyiha tahrirlari noto‘g‘ri.");
  return p;
}
function adopt(p) {
  clearTimeout(saveTimer);
  project = validateProject(p);
  selected = null;
  history = [];
  future = [];
  draft = null;
  gesture = null;
  $("#empty").hidden = true;
  $("#project-name").textContent = p.name;
  $("#project-name").title = p.name;
  $("#units").textContent = p.units;
  $("#grid-unit").textContent = p.units;
  $("#canvas-subtitle").textContent = "Haqiqiy o‘lchamda · " + p.units;
  project.noteHeight =
    project.noteHeight ||
    Math.max(allBounds()[2] - allBounds()[0], allBounds()[3] - allBounds()[1]) *
      0.009 ||
    150;
  syncUI();
  fit();
  autosave();
  if (p.warnings?.length) toast(p.warnings.join(" "));
}
function syncUI() {
  renderLayers();
  renderSelection();
  renderNotes();
  updateHistory();
  $("#brief").value = project?.brief || "";
  render();
}
function visible(e) {
  return (
    project &&
    !project.edits[e.id]?.deleted &&
    project.layers.find((l) => l.name === e.layer)?.visible !== false
  );
}
function entity(id = selected) {
  return project?.entities.find((e) => e.id === id);
}
function addition(id = selected) {
  return project?.additions.find((e) => e.id === id);
}
function getEdit(e) {
  return (
    project.edits[e.id] || {
      dx: 0,
      dy: 0,
      rotation: 0,
      center: [
        (e.bounds[0] + e.bounds[2]) / 2,
        (e.bounds[1] + e.bounds[3]) / 2,
      ],
    }
  );
}
function transform(p, e) {
  const ed = getEdit(e),
    [cx, cy] = ed.center || [0, 0],
    r = ((ed.rotation || 0) * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  return [
    (p[0] - cx) * c - (p[1] - cy) * s + cx + (ed.dx || 0),
    (p[0] - cx) * s + (p[1] - cy) * c + cy + (ed.dy || 0),
  ];
}
function screen(p) {
  return [p[0] * view.scale + view.x, -p[1] * view.scale + view.y];
}
function world(p) {
  return [(p[0] - view.x) / view.scale, (view.y - p[1]) / view.scale];
}
function snap(p, shift = false, origin = null) {
  const step = Number($("#grid-size").value);
  let v = $("#snap-toggle").checked
    ? p.map((n) => Math.round(n / step) * step)
    : [...p];
  if (shift && origin) {
    if (Math.abs(v[0] - origin[0]) > Math.abs(v[1] - origin[1]))
      v[1] = origin[1];
    else v[0] = origin[0];
  }
  return v;
}
function resize() {
  const r = canvas.getBoundingClientRect();
  width = r.width;
  height = r.height;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  render();
}
function allBounds() {
  const pts = [];
  if (!project) return [0, 0, 10000, 10000];
  for (const e of project.entities.filter(visible)) {
    const [x, y, x2, y2] = e.bounds;
    for (const p of [
      [x, y],
      [x2, y],
      [x2, y2],
      [x, y2],
    ])
      pts.push(transform(p, e));
  }
  for (const a of project.additions) pts.push(...a.points);
  for (const n of project.notes) pts.push(n.p);
  if (!pts.length) return [0, 0, 10000, 10000];
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}
function fit() {
  const [x, y, x2, y2] = allBounds();
  view.scale = Math.min(
    (width - 155) / Math.max(x2 - x, 100),
    (height - 135) / Math.max(y2 - y, 100),
  );
  view.scale = Math.max(view.scale, 0.0001);
  fitScale = view.scale;
  view.x = width / 2 + 22 - ((x + x2) / 2) * view.scale;
  view.y = height / 2 + 5 + ((y + y2) / 2) * view.scale;
  render();
}
function zoom(f, at = [width / 2, height / 2]) {
  const p = world(at);
  view.scale = Math.min(Math.max(view.scale * f, 0.0001), 1000);
  view.x = at[0] - p[0] * view.scale;
  view.y = at[1] + p[1] * view.scale;
  render();
}
function linePath(points, close = false) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const p of points.slice(1)) ctx.lineTo(...p);
  if (close) ctx.closePath();
}
function rectPoints(a) {
  const [p, q] = a.points;
  return a.type === "rect" ? [p, [q[0], p[1]], q, [p[0], q[1]]] : a.points;
}
function drawGrid() {
  if (!$("#grid-toggle").checked) return;
  let step = Number($("#grid-size").value) * view.scale;
  while (step < 18) step *= 5;
  while (step > 100) step /= 5;
  ctx.fillStyle = "#c8cfbf";
  const ox = ((view.x % step) + step) % step,
    oy = ((view.y % step) + step) % step;
  for (let x = ox; x < width; x += step)
    for (let y = oy; y < height; y += step) ctx.fillRect(x, y, 1, 1);
}
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawGrid();
  $("#zoom-value").textContent =
    Math.round((view.scale / fitScale) * 100) + "%";
  if (!project) return;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const e of project.entities) {
    if (!visible(e)) continue;
    const is = e.id === selected;
    ctx.strokeStyle = is ? "#5d8e35" : layerColor(e.layer);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = is ? 1.9 : /WALL/.test(e.layer) ? 1.15 : 0.8;
    for (const s of e.shapes) {
      if (s.kind === "path") {
        const pts = s.points.map((p) => screen(transform(p, e)));
        linePath(pts, s.closed);
        if (s.fill) {
          ctx.globalAlpha = is ? 0.22 : 0.11;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
      } else {
        const p = screen(transform(s.p, e)),
          h = s.height * view.scale;
        if (h < 2.3) continue;
        ctx.save();
        ctx.translate(...p);
        ctx.rotate(
          (-((s.rotation || 0) + (getEdit(e).rotation || 0)) * Math.PI) / 180,
        );
        ctx.font = `${h}px -apple-system,Arial,sans-serif`;
        ctx.textBaseline = s.top ? "top" : "alphabetic";
        ctx.textAlign = s.align || "left";
        s.text.split("\n").forEach((t, i) => ctx.fillText(t, 0, i * h * 1.25));
        ctx.restore();
      }
    }
    if (is) {
      const [x, y, x2, y2] = e.bounds,
        pts = [
          [x, y],
          [x2, y],
          [x2, y2],
          [x, y2],
        ].map((p) => screen(transform(p, e)));
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#76a04f";
      linePath(pts, true);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of pts) {
        ctx.fillStyle = "white";
        ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
        ctx.strokeRect(p[0] - 3, p[1] - 3, 6, 6);
      }
      ctx.restore();
    }
  }
  for (const a of project.additions) {
    ctx.strokeStyle = a.id === selected ? "#54862a" : "#709144";
    ctx.lineWidth = a.id === selected ? 2 : 1.5;
    linePath(rectPoints(a).map(screen), a.type === "rect");
    ctx.stroke();
  }
  project.notes.forEach((n, i) => {
    const p = screen(n.p);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(...p, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6e8e48";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#547632";
    ctx.font = "600 11px -apple-system,Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(i + 1, ...p);
  });
  if (draft) {
    ctx.save();
    ctx.strokeStyle = tool === "measure" ? "#be9157" : "#68953e";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    linePath(
      rectPoints({ points: [draft.start, draft.end], type: tool }).map(screen),
      tool === "rect",
    );
    ctx.stroke();
    ctx.setLineDash([]);
    const dist = Math.hypot(
        draft.end[0] - draft.start[0],
        draft.end[1] - draft.start[1],
      ),
      p = screen(draft.end);
    ctx.font = "11px -apple-system,Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const label =
      tool === "rect"
        ? `${Math.abs(draft.end[0] - draft.start[0]).toFixed(0)} × ${Math.abs(draft.end[1] - draft.start[1]).toFixed(0)} ${project.units}`
        : `${dist.toFixed(1)} ${project.units}`;
    ctx.fillStyle = "#fff";
    ctx.fillRect(p[0] + 8, p[1] - 25, ctx.measureText(label).width + 14, 23);
    ctx.fillStyle = "#526740";
    ctx.fillText(label, p[0] + 15, p[1] - 9);
    ctx.restore();
  }
}
function distance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l))
      : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function hitTest(p) {
  let best = null,
    score = 9;
  for (const a of [...project.additions].reverse()) {
    const pts = rectPoints(a).map(screen);
    if (a.type === "rect") pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const d = distance(p, pts[i - 1], pts[i]);
      if (d < score) {
        score = d;
        best = a.id;
      }
    }
  }
  for (const e of [...project.entities].reverse()) {
    if (!visible(e)) continue;
    for (const s of e.shapes) {
      if (s.kind === "text") {
        const q = screen(transform(s.p, e)),
          h = s.height * view.scale,
          w = Math.max(...s.text.split("\n").map((t) => t.length)) * h * 0.6;
        if (
          p[0] >= q[0] &&
          p[0] <= q[0] + w &&
          Math.abs(p[1] - q[1]) < Math.max(h, 6) &&
          score > 5
        ) {
          score = 5;
          best = e.id;
        }
      } else {
        const pts = s.points.map((q) => screen(transform(q, e)));
        if (s.closed && pts.length) pts.push(pts[0]);
        for (let i = 1; i < pts.length; i++) {
          const d = distance(p, pts[i - 1], pts[i]);
          if (d < score) {
            score = d;
            best = e.id;
          }
        }
      }
    }
  }
  return best;
}
function renderLayers() {
  if (!project) return;
  $("#layers").replaceChildren();
  const names = [...new Set(project.entities.map((e) => e.layer))];
  $("#layer-count").textContent = names.length;
  for (const name of names) {
    let layer = project.layers.find((l) => l.name === name);
    if (!layer) {
      layer = { name, visible: true };
      project.layers.push(layer);
    }
    const div = document.createElement("div");
    div.className = "layer" + (!layer.visible ? " off" : "");
    const btn = document.createElement("button");
    btn.title = name;
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.borderColor = layerColor(name);
    const label = document.createElement("span");
    label.className = "layer-name";
    label.textContent = name;
    const count = document.createElement("small");
    count.textContent = project.entities.filter(
      (e) => e.layer === name && !project.edits[e.id]?.deleted,
    ).length;
    const eye = document.createElement("span");
    eye.textContent = layer.visible ? "◉" : "○";
    btn.append(dot, label, count, eye);
    btn.onclick = () => {
      checkpoint();
      layer.visible = !layer.visible;
      if (entity()?.layer === name) selected = null;
      renderLayers();
      changed();
    };
    div.append(btn);
    $("#layers").append(div);
  }
}
function renderSelection() {
  const e = entity(),
    a = addition();
  $("#selection-empty").hidden = !!(e || a);
  $("#selection-details").hidden = !(e || a);
  if (e) {
    const ed = getEdit(e);
    $("#selection-title").textContent =
      e.type === "INSERT" ? "Mebel · " + e.name : e.type;
    $("#selection-layer").textContent = e.layer + " · #" + e.id;
    $("#dx").value = +(ed.dx || 0).toFixed(2);
    $("#dy").value = +(ed.dy || 0).toFixed(2);
    $("#rotation").value = +(ed.rotation || 0).toFixed(2);
    $("#transform-fields").hidden = false;
  } else if (a) {
    $("#selection-title").textContent =
      a.type === "rect" ? "To‘rtburchak" : "Chiziq";
    $("#selection-layer").textContent = "Yangi chizma · DIZY-EDIT";
    $("#transform-fields").hidden = true;
  }
}
function renderNotes() {
  if (!project) return;
  $("#note-count").textContent = project.notes.length;
  $("#notes-list").replaceChildren();
  project.notes.forEach((n, i) => {
    const card = document.createElement("div");
    card.className = "note-card";
    const h = document.createElement("header"),
      num = document.createElement("b"),
      edit = document.createElement("button"),
      del = document.createElement("button"),
      text = document.createElement("p");
    num.textContent = i + 1;
    edit.textContent = "Tahrirlash";
    del.textContent = "×";
    del.title = "Izohni o‘chirish";
    text.textContent = n.text;
    h.append(num, edit, del);
    card.append(h, text);
    edit.onclick = () => openNote(n.p, i);
    del.onclick = () => {
      checkpoint();
      project.notes.splice(i, 1);
      changed();
    };
    num.onclick = () => {
      view.x = width / 2 - n.p[0] * view.scale;
      view.y = height / 2 + n.p[1] * view.scale;
      render();
    };
    $("#notes-list").append(card);
  });
}
function tab(name) {
  $$("[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name),
  );
  $("#properties-panel").hidden = name !== "properties";
  $("#notes-panel").hidden = name !== "notes";
}
function setTool(t) {
  tool = t;
  draft = null;
  $$("[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === t),
  );
  canvas.style.cursor =
    t === "pan"
      ? "grab"
      : ["line", "rect", "measure", "note"].includes(t)
        ? "crosshair"
        : "default";
  $("#tool-hint").textContent = {
    select: "Obyektni tanlang va suring",
    pan: "Bosib ushlab, ko‘rinishni suring",
    line: "Boshlanish va tugash nuqtasini bosing",
    rect: "Qarama-qarshi ikki burchakni bosing",
    measure: "O‘lchash uchun ikkita nuqtani bosing",
    note: "Izoh joyini planda bosing",
  }[t];
  if (t === "note") {
    tab("notes");
    $(".right-panel").classList.add("mobile-open");
  }
  render();
}
function removeSelected() {
  if (!selected) return;
  checkpoint();
  if (entity())
    project.edits[selected] = { ...getEdit(entity()), deleted: true };
  else project.additions = project.additions.filter((a) => a.id !== selected);
  selected = null;
  renderLayers();
  changed();
}
function openNote(p, i = null) {
  notePoint = p;
  noteEdit = i;
  $("#note-text").value = i === null ? "" : project.notes[i].text;
  $("#note-dialog").showModal();
  setTimeout(() => $("#note-text").focus(), 50);
}
function eventPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
canvas.addEventListener("pointerdown", (e) => {
  if (loading || !project) return;
  canvas.focus();
  const p = eventPoint(e),
    w = world(p);
  pointer = p;
  if (e.button === 1 || space || tool === "pan") {
    gesture = { type: "pan", start: p, view: { ...view } };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  if (tool === "select") {
    const ni = project.notes.findIndex(
      (n) => Math.hypot(...screen(n.p).map((v, i) => v - p[i])) < 15,
    );
    if (ni >= 0) {
      openNote(project.notes[ni].p, ni);
      return;
    }
    selected = hitTest(p);
    renderSelection();
    render();
    if (selected) {
      $(".right-panel").classList.add("mobile-open");
      tab("properties");
      gesture = {
        type: "move",
        start: w,
        screen: p,
        id: selected,
        edit: entity() ? structuredClone(getEdit(entity())) : null,
        points: addition() ? structuredClone(addition().points) : null,
        committed: false,
      };
      canvas.setPointerCapture(e.pointerId);
    }
  } else if (tool === "note") openNote(snap(w));
  else if (["line", "rect", "measure"].includes(tool)) {
    if (!draft || draft.finished) {
      draft = { start: snap(w), end: snap(w) };
    } else {
      draft.end = snap(w, e.shiftKey, draft.start);
      const length = Math.hypot(
        draft.end[0] - draft.start[0],
        draft.end[1] - draft.start[1],
      );
      if (length === 0) return;
      if (tool === "measure") {
        draft.finished = true;
        toast(`${length.toFixed(1)} ${project.units}`);
      } else {
        checkpoint();
        project.additions.push({
          id: "new-" + crypto.randomUUID(),
          type: tool,
          points: [draft.start, draft.end],
        });
        draft = null;
        changed();
      }
    }
    render();
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = eventPoint(e);
  pointer = p;
  const w = world(p);
  $("#coordinates").textContent = `X ${w[0].toFixed(0)}   Y ${w[1].toFixed(0)}`;
  if (gesture?.type === "pan") {
    view.x = gesture.view.x + p[0] - gesture.start[0];
    view.y = gesture.view.y + p[1] - gesture.start[1];
    render();
  } else if (gesture?.type === "move") {
    if (
      !gesture.committed &&
      Math.hypot(p[0] - gesture.screen[0], p[1] - gesture.screen[1]) > 3
    ) {
      checkpoint();
      gesture.committed = true;
    }
    if (gesture.committed) {
      const delta = snap(
        [w[0] - gesture.start[0], w[1] - gesture.start[1]],
        e.shiftKey,
        [0, 0],
      );
      if (gesture.edit)
        project.edits[gesture.id] = {
          ...gesture.edit,
          dx: gesture.edit.dx + delta[0],
          dy: gesture.edit.dy + delta[1],
        };
      else
        addition(gesture.id).points = gesture.points.map((q) => [
          q[0] + delta[0],
          q[1] + delta[1],
        ]);
      render();
      renderSelection();
    }
  } else if (draft && !draft.finished) {
    draft.end = snap(w, e.shiftKey, draft.start);
    render();
  }
});
function endGesture() {
  if (gesture?.committed) changed();
  gesture = null;
}
canvas.addEventListener("pointerup", endGesture);
canvas.addEventListener("pointercancel", endGesture);
canvas.addEventListener("lostpointercapture", endGesture);
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.0014), eventPoint(e));
  },
  { passive: false },
);
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  draft = null;
  setTool("select");
});
window.addEventListener("keydown", (e) => {
  if (loading) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $("dialog[open]"))
    return;
  if (e.key === " ") {
    e.preventDefault();
    space = true;
    canvas.style.cursor = "grab";
    return;
  }
  if (e.key === "Escape") {
    draft = null;
    selected = null;
    setTool("select");
    renderSelection();
    $(".right-panel").classList.remove("mobile-open");
    return;
  }
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveProject();
    }
    return;
  }
  const map = {
    v: "select",
    h: "pan",
    l: "line",
    r: "rect",
    m: "measure",
    n: "note",
  };
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  if (e.key.toLowerCase() === "f") fit();
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeSelected();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    space = false;
    canvas.style.cursor =
      tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  }
});
window.addEventListener("blur", () => {
  space = false;
  endGesture();
});
function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function saveProject() {
  if (!project) return toast("Avval plan oching.");
  download(
    JSON.stringify(project),
    project.name.replace(/\.(dwg|dxf)$/i, "") + ".dizy.json",
    "application/json",
  );
  toast("Loyiha fayli saqlandi. Uni qayta ochib davom etishingiz mumkin.");
}
async function importFile(file) {
  if (!file) return;
  await autosave();
  if (file.size > 40 * 1024 * 1024) return toast("Fayl chegarasi: 40 MB.");
  busy(true);
  try {
    if (file.name.endsWith(".json")) adopt(JSON.parse(await file.text()));
    else {
      const r = await fetch("/api/import", {
        method: "POST",
        headers: {
          "X-Filename": encodeURIComponent(file.name),
          "Content-Type": "application/octet-stream",
        },
        body: file,
      });
      if (!r.ok) throw Error((await r.json()).error);
      adopt(await r.json());
    }
    $("#plan-picker").value = "";
    toast("Plan ochildi. Tahrirlashni boshlashingiz mumkin.");
  } catch (e) {
    toast(e.message);
  } finally {
    busy(false);
    $("#file-input").value = "";
  }
}
function escapeXML(text) {
  return String(text).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
function previewSVG() {
  const [x, y, x2, y2] = allBounds(),
    pad = Math.max(x2 - x, y2 - y) * 0.035 || 100,
    w = x2 - x + pad * 2,
    h = y2 - y + pad * 2,
    sw = Math.max(w, h) / 1800;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - pad} ${-y2 - pad} ${w} ${h}"><rect x="${x - pad}" y="${-y2 - pad}" width="${w}" height="${h}" fill="#fcfcf9"/>`,
  ];
  for (const e of project.entities.filter(visible)) {
    const color = layerColor(e.layer);
    for (const s of e.shapes) {
      if (s.kind === "path") {
        const pts = s.points
          .map((p) => transform(p, e))
          .map((p) => p[0] + "," + -p[1])
          .join(" ");
        parts.push(
          `<${s.closed ? "polygon" : "polyline"} points="${pts}" fill="${s.fill ? color : "none"}" fill-opacity="0.12" stroke="${color}" stroke-width="${sw}"/>`,
        );
      } else {
        const p = transform(s.p, e);
        parts.push(
          `<text x="${p[0]}" y="${-p[1]}" font-family="Arial,sans-serif" text-anchor="${s.align === "center" ? "middle" : "start"}" dominant-baseline="${s.top ? "hanging" : "auto"}" font-size="${s.height}" fill="${color}" transform="rotate(${-((s.rotation || 0) + (getEdit(e).rotation || 0))} ${p[0]} ${-p[1]})">${s.text
            .split("\n")
            .map(
              (t, i) =>
                `<tspan x="${p[0]}" dy="${i ? s.height * 1.25 : 0}">${escapeXML(t)}</tspan>`,
            )
            .join("")}</text>`,
        );
      }
    }
  }
  for (const a of project.additions)
    parts.push(
      `<${a.type === "rect" ? "polygon" : "polyline"} points="${rectPoints(a)
        .map((p) => p[0] + "," + -p[1])
        .join(" ")}" fill="none" stroke="#719443" stroke-width="${sw * 2}"/>`,
    );
  project.notes.forEach((n, i) => {
    parts.push(
      `<circle cx="${n.p[0]}" cy="${-n.p[1]}" r="${sw * 16}" fill="white" stroke="#6e8e48" stroke-width="${sw * 2}"/><text x="${n.p[0]}" y="${-n.p[1]}" font-family="Arial" font-size="${sw * 17}" text-anchor="middle" dominant-baseline="central" fill="#547632">${i + 1}</text>`,
    );
  });
  return parts.join("") + "</svg>";
}
async function exportFile(format) {
  if (!project) return toast("Avval plan oching.");
  $("#export-dialog").close();
  if (format === "svg") {
    download(previewSVG(), "plan-preview.svg", "image/svg+xml");
    return;
  }
  busy(
    true,
    format === "zip"
      ? "Vazifa paketi tayyorlanmoqda…"
      : "CAD fayl tayyorlanmoqda…",
  );
  try {
    const response = await api("/api/export", {
      format,
      project,
      preview: format === "zip" ? previewSVG() : undefined,
    });
    download(
      await response.blob(),
      format === "zip" ? "dizy-vazifa.zip" : "plan-edited." + format,
    );
    toast(
      format === "zip"
        ? "ZIP tayyor. Uni Codex suhbatiga biriktiring. Nusxa data/exports ichida ham bor."
        : "Tahrirlangan " + format.toUpperCase() + " saqlandi.",
    );
  } catch (e) {
    toast(e.message);
  } finally {
    busy(false);
  }
}
$$("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$$("[data-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$$("[data-format]").forEach(
  (b) => (b.onclick = () => exportFile(b.dataset.format)),
);
$("#plan-picker").onchange = async (e) => {
  const id = e.target.value;
  if (!id) return;
  await autosave();
  busy(true);
  try {
    const r = await api("/api/load", { id });
    const fresh = await r.json();
    const saved = db ? await loadSaved("project:" + fresh.name) : null;
    adopt(saved?.source === fresh.source ? saved : fresh);
  } catch (err) {
    toast(err.message);
  } finally {
    busy(false);
  }
};
$("#open-btn").onclick = $("#empty-open").onclick = () =>
  $("#file-input").click();
$("#file-input").onchange = (e) => importFile(e.target.files[0]);
$("#save-btn").onclick = saveProject;
$("#handoff-btn").onclick = () => exportFile("zip");
$("#export-btn").onclick = () =>
  project ? $("#export-dialog").showModal() : toast("Avval plan oching.");
$("#export-close").onclick = () => $("#export-dialog").close();
$("#help-btn").onclick = () => $("#help-dialog").showModal();
$("#help-close").onclick = () => $("#help-dialog").close();
$("#undo-btn").onclick = undo;
$("#redo-btn").onclick = redo;
$("#fit-btn").onclick = $("#fit-plan").onclick = fit;
$("#zoom-in").onclick = () => zoom(1.3);
$("#zoom-out").onclick = () => zoom(1 / 1.3);
$("#delete-btn").onclick = removeSelected;
$("#apply-transform").onclick = () => {
  const e = entity();
  if (!e) return;
  const values = ["dx", "dy", "rotation"].map((id) =>
    Number($("#" + id).value),
  );
  if (values.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e10))
    return toast("To‘g‘ri son kiriting.");
  checkpoint();
  project.edits[e.id] = {
    ...getEdit(e),
    dx: values[0],
    dy: values[1],
    rotation: values[2],
  };
  changed();
};
$("#rotate-btn").onclick = () => {
  const e = entity();
  if (!e) return;
  checkpoint();
  const ed = getEdit(e);
  project.edits[e.id] = { ...ed, rotation: ((ed.rotation || 0) + 90) % 360 };
  changed();
};
$("#add-note").onclick = () => setTool("note");
$("#note-cancel").onclick = () => $("#note-dialog").close();
$("#note-form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("#note-text").value.trim();
  if (!text) return;
  checkpoint();
  if (noteEdit === null)
    project.notes.push({ id: crypto.randomUUID(), p: notePoint, text });
  else project.notes[noteEdit].text = text;
  $("#note-dialog").close();
  tab("notes");
  changed();
};
$("#brief").onfocus = () => {
  if (project) checkpoint();
};
$("#brief").oninput = (e) => {
  if (project) {
    project.brief = e.target.value;
    changed();
  }
};
function snapUI() {
  $("#snap-btn").textContent =
    "⌗ Snap: " + ($("#snap-toggle").checked ? $("#grid-size").value : "off");
  $("#snap-btn").classList.toggle("active", $("#snap-toggle").checked);
  render();
}
$("#grid-toggle").onchange = render;
$("#snap-toggle").onchange = $("#grid-size").onchange = snapUI;
$("#snap-btn").onclick = () => {
  $("#snap-toggle").checked = !$("#snap-toggle").checked;
  snapUI();
};
$("#canvas-wrap").addEventListener("dragover", (e) => {
  e.preventDefault();
});
$("#canvas-wrap").addEventListener("drop", (e) => {
  e.preventDefault();
  importFile(e.dataTransfer.files[0]);
});
new ResizeObserver(resize).observe($("#canvas-wrap"));
(async () => {
  resize();
  updateHistory();
  try {
    const info = await (await fetch("/api/info")).json();
    for (const p of info.plans) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      $("#plan-picker").append(o);
    }
    $("#dwg-status").textContent = info.dwg
      ? "DWG / DXF · lokal rejim"
      : "DXF · DWG uchun ODA kerak";
    $('[data-format="dwg"]').disabled = !info.dwg;
    if (!info.dwg)
      $("#dwg-option-label").textContent = "ODA konverter o‘rnatilmagan";
    try {
      db = await openDB();
      const p = await loadSaved();
      if (p) {
        adopt(p);
        toast("Oxirgi ish joyingiz tiklandi.");
        return;
      }
    } catch (e) {
      toast("Avtosaqlash mavjud emas. Loyihani faylga saqlab turing.");
    }
    if (info.plans.length) {
      busy(true);
      const id = info.plans[0].id;
      const r = await api("/api/load", { id });
      adopt(await r.json());
      $("#plan-picker").value = id;
      busy(false);
    }
  } catch (e) {
    busy(false);
    toast(e.message);
  }
})();
