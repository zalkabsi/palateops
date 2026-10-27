/**
 * Duet client.
 *
 * No framework: the whole app is one decision screen. Everything the server
 * computed is rendered verbatim; the browser never invents or adjusts a score.
 */

const MAX_SIGNALS = 6;

const state = {
  health: null,
  presets: [],
  tasteTypes: [],
  persons: {
    a: { label: "You", tagline: "", signals: [] },
    b: { label: "Them", tagline: "", signals: [] },
  },
  city: "",
  busy: false,
  result: null,
  activePreset: null,
};

const els = { a: null, b: null };
const byId = (id) => document.getElementById(id);

init();

async function init() {
  buildPeople();
  bindCommit();
  await Promise.all([loadHealth(), loadPresets()]);
  renderMode();
}

/* ---------------- mode + presets ---------------- */

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    state.health = await response.json();
  } catch {
    state.health = { mode: "unknown", qlooConfigured: false };
  }
}

function renderMode() {
  const mode = state.health?.mode ?? "unknown";
  const badge = byId("modeBadge");
  badge.dataset.mode = mode;
  byId("modeText").textContent =
    mode === "live" ? "Live Qloo" : mode === "fixture" ? "Sample data" : "Offline";
  byId("footMode").textContent =
    mode === "live"
      ? "Live Qloo responses"
      : mode === "fixture"
        ? "Sample data — no Qloo request was made"
        : "Data source unavailable";
}

async function loadPresets() {
  try {
    const response = await fetch("/api/presets");
    const payload = await response.json();
    state.presets = payload.presets ?? [];
    state.tasteTypes = payload.tasteTypes ?? [];
  } catch {
    state.presets = [];
    state.tasteTypes = [];
  }
  fillDomains();
  renderPresets();
  applyInitialState();
}

/**
 * First load fills the form with a starter duo so the screen is never empty.
 * Shareable links override it: ?preset=<id> prefills, &run=1 runs it.
 */
function applyInitialState() {
  const params = new URLSearchParams(window.location.search);
  const presetId = params.get("preset");
  const targetId = presetId || state.presets[0]?.id;
  if (!targetId) return;
  const preset = state.presets.find((entry) => entry.id === targetId);
  if (!preset) return;
  const button = document.querySelector(`.preset[data-preset="${CSS.escape(preset.id)}"]`);
  if (button) applyPreset(preset, button);
  if (presetId && params.get("run") === "1") setTimeout(run, 60);
}

function renderPresets() {
  const holder = byId("presets");
  holder.textContent = "";
  for (const preset of state.presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    button.dataset.preset = preset.id;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<strong>${esc(preset.title)}</strong><small>${esc(preset.blurb)}</small>`;
    button.addEventListener("click", () => applyPreset(preset, button));
    holder.append(button);
  }
}

function applyPreset(preset, button) {
  const active = state.activePreset === preset.id;
  for (const other of document.querySelectorAll(".preset")) other.setAttribute("aria-pressed", "false");
  if (active) {
    state.activePreset = null;
    return;
  }
  button.setAttribute("aria-pressed", "true");
  state.activePreset = preset.id;
  state.city = preset.city;
  byId("city").value = preset.city;

  for (const side of ["a", "b"]) {
    const source = preset[side];
    state.persons[side] = {
      label: source.label,
      tagline: source.tagline,
      signals: source.signals.map((signal) => ({ name: signal.name, type: signal.type, id: "" })),
    };
    syncPerson(side);
  }
  clearError();
}

/* ---------------- people ---------------- */

function buildPeople() {
  for (const side of ["a", "b"]) {
    const host = document.querySelector(`.person[data-side="${side}"]`);
    host.innerHTML = `
      <header class="person-head">
        <div class="avatar" aria-hidden="true"></div>
        <div class="person-id">
          <input class="name-input" type="text" maxlength="24" aria-label="Name for ${side === "a" ? "the first" : "the second"} person" />
          <p class="person-tagline"></p>
        </div>
      </header>
      <div class="chips" role="list" aria-label="Taste signals"></div>
      <div class="search-row">
        <select class="domain-select" aria-label="Taste domain"></select>
        <input class="search-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Search an artist, film, brand…" aria-label="Search for a taste signal" />
        <div class="suggestions" hidden></div>
      </div>`;

    const refs = {
      host,
      avatar: host.querySelector(".avatar"),
      name: host.querySelector(".name-input"),
      tagline: host.querySelector(".person-tagline"),
      chips: host.querySelector(".chips"),
      domain: host.querySelector(".domain-select"),
      input: host.querySelector(".search-input"),
      suggestions: host.querySelector(".suggestions"),
    };
    els[side] = refs;

    refs.name.value = state.persons[side].label;
    refs.name.addEventListener("input", () => {
      state.persons[side].label = refs.name.value.trim() || (side === "a" ? "You" : "Them");
      refs.avatar.textContent = initial(state.persons[side].label);
      markCustom();
    });

    refs.input.addEventListener("input", debounce(() => suggest(side), 280));
    refs.input.addEventListener("keydown", (event) => onSearchKey(event, side));
    refs.input.addEventListener("blur", () => {
      // Delay so a click on a suggestion still registers.
      setTimeout(() => { refs.suggestions.hidden = true; }, 140);
    });

    syncPerson(side);
  }
}

function fillDomains() {
  for (const side of ["a", "b"]) {
    const select = els[side].domain;
    select.textContent = "";
    for (const type of state.tasteTypes) {
      const option = document.createElement("option");
      option.value = type.alias;
      option.textContent = type.label;
      select.append(option);
    }
  }
}

function syncPerson(side) {
  const refs = els[side];
  const person = state.persons[side];
  refs.name.value = person.label;
  refs.avatar.textContent = initial(person.label);
  refs.tagline.textContent = person.tagline || "";

  refs.chips.textContent = "";
  if (person.signals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chips-empty";
    empty.textContent = "Nothing yet — add something you actually love.";
    refs.chips.append(empty);
    return;
  }
  for (const signal of person.signals) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.innerHTML = `<span class="chip-domain">${esc(signal.type)}</span><span class="chip-name">${esc(signal.name)}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.innerHTML = "&times;";
    remove.setAttribute("aria-label", `Remove ${signal.name}`);
    remove.addEventListener("click", () => {
      state.persons[side].signals = person.signals.filter((entry) => entry !== signal);
      markCustom();
      syncPerson(side);
    });
    chip.append(remove);
    refs.chips.append(chip);
  }
}

/* ---------------- search ---------------- */

let requestToken = 0;

async function suggest(side) {
  const refs = els[side];
  const query = refs.input.value.trim();
  if (query.length < 2) {
    refs.suggestions.hidden = true;
    return;
  }
  const token = ++requestToken;
  refs.suggestions.hidden = false;
  refs.suggestions.innerHTML = `<p class="sug-note">Searching…</p>`;
  try {
    const type = refs.domain.value || "music";
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`);
    const payload = await response.json();
    if (token !== requestToken) return;
    if (!response.ok) throw new Error(payload.error || "Search failed.");
    renderSuggestions(side, payload.results ?? [], type);
  } catch (error) {
    if (token !== requestToken) return;
    refs.suggestions.innerHTML = `<p class="sug-note">${esc(error.message)}</p>`;
  }
}

function renderSuggestions(side, results, type) {
  const refs = els[side];
  refs.suggestions.textContent = "";
  if (results.length === 0) {
    refs.suggestions.innerHTML = `<p class="sug-note">Nothing matched. Try a different spelling.</p>`;
    return;
  }
  for (const entity of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${esc(entity.name)}</span><span class="sug-type">${esc(type)}</span>`;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      addSignal(side, { name: entity.name, type, id: entity.id ?? "" });
    });
    refs.suggestions.append(button);
  }
}

function onSearchKey(event, side) {
  const refs = els[side];
  const options = [...refs.suggestions.querySelectorAll("button")];
  if (event.key === "Escape") { refs.suggestions.hidden = true; return; }
  if (event.key === "Enter" && options.length > 0) {
    event.preventDefault();
    options[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }
}

function addSignal(side, signal) {
  const person = state.persons[side];
  if (person.signals.length >= MAX_SIGNALS) return;
  const duplicate = person.signals.some(
    (entry) => entry.name.toLowerCase() === signal.name.toLowerCase() && entry.type === signal.type,
  );
  if (duplicate) return;
  person.signals.push(signal);
  const refs = els[side];
  refs.input.value = "";
  refs.suggestions.hidden = true;
  markCustom();
  syncPerson(side);
  refs.input.focus();
  clearError();
}

function markCustom() {
  state.activePreset = null;
  for (const button of document.querySelectorAll(".preset")) button.setAttribute("aria-pressed", "false");
}

/* ---------------- run ---------------- */

function bindCommit() {
  byId("city").addEventListener("input", (event) => {
    state.city = event.target.value;
    clearError();
  });
  byId("runButton").addEventListener("click", run);
}

async function run() {
  if (state.busy) return;
  clearError();

  const city = byId("city").value.trim();
  if (city.length < 2) return fail("Choose a city, for example “Brooklyn, NY”.");
  if (state.persons.a.signals.length === 0) return fail("Add at least one taste signal for the first person.");
  if (state.persons.b.signals.length === 0) return fail("Add at least one taste signal for the second person.");

  state.busy = true;
  const button = byId("runButton");
  button.disabled = true;
  button.dataset.busy = "true";
  byId("commitHint").textContent = "Resolving signals and ranking places…";

  try {
    const response = await fetch("/api/duet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        city,
        a: { label: state.persons.a.label, signals: state.persons.a.signals },
        b: { label: state.persons.b.label, signals: state.persons.b.signals },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The duet could not be completed.");
    state.result = payload;
    renderResult(payload);
  } catch (error) {
    fail(error.message);
  } finally {
    state.busy = false;
    button.disabled = false;
    button.dataset.busy = "false";
    byId("commitHint").textContent = "Two Qloo requests per person. Nothing about your identity is sent.";
  }
}

function fail(message) {
  const error = byId("error");
  error.textContent = message;
  error.hidden = false;
}

function clearError() {
  const error = byId("error");
  error.hidden = true;
  error.textContent = "";
}

/* ---------------- result ---------------- */

function renderResult(result) {
  const host = byId("result");
  const nameA = result.people.a.label;
  const nameB = result.people.b.label;
  const overlapPct = Math.round((result.summary.overlap ?? 0) * 100);

  host.innerHTML = `
    ${result.mode === "fixture" ? fixtureNotice() : ""}
    <section class="verdict">
      <div class="verdict-copy">
        <p class="verdict-eyebrow">${esc(result.city)} · ${result.summary.total} places ranked twice</p>
        <h2>${esc(result.narration.headline)}</h2>
        <p class="verdict-detail">${esc(result.narration.detail)}</p>
        <p class="verdict-advice">${esc(result.narration.advice)}</p>
      </div>
      <div class="overlap">
        <span class="overlap-value">${overlapPct}%</span>
        <span class="overlap-label">of places work<br />for both of you</span>
        <div class="overlap-rail"><i style="width:${overlapPct}%"></i></div>
        <button class="verdict-copy-btn" id="copyButton" type="button">Copy the verdict</button>
      </div>
    </section>

    <section class="taste" aria-label="Shared and divergent taste">
      ${tasteColumn("shared", "You both respond to", result.taste.shared, nameA, nameB)}
      ${tasteColumn("a", `${nameA} only`, result.taste.onlyA, nameA, nameB)}
      ${tasteColumn("b", `${nameB} only`, result.taste.onlyB, nameA, nameB)}
    </section>

    <div class="groups">
      ${venueGroup("Both of you", "Ranked highly for both. These are the answers.", result.groups.both, "both", nameA, nameB)}
      ${venueGroup("The middle", "Neither loves it, neither objects. The safe compromise.", result.groups.middle, "middle", nameA, nameB)}
      ${venueGroup("Worth a trade", "Strong for one of you only. Someone is conceding here.", result.groups.trade, "trade", nameA, nameB)}
    </div>

    <section class="receipt">
      <div class="panel">
        <h3>What ran</h3>
        <div class="trace">${result.trace.map(traceStep).join("")}</div>
      </div>
      <div class="panel">
        <h3>Qloo calls</h3>
        <table class="calls">
          <thead><tr><th>Call</th><th>Request</th></tr></thead>
          <tbody>${result.provenance.calls.map(callRow).join("")}</tbody>
        </table>
        <p class="rule-note">${esc(result.provenance.rule)}</p>
      </div>
    </section>`;

  host.hidden = false;
  host.classList.remove("result-enter");
  void host.offsetWidth;
  host.classList.add("result-enter");

  byId("copyButton").addEventListener("click", () => copyVerdict(result));
  if (!new URLSearchParams(window.location.search).has("capture")) {
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function fixtureNotice() {
  return `<p class="fixture-note"><strong>Sample data.</strong> This deployment has no Qloo credential configured, so
    these rankings were generated locally. Venue names are invented. Add <code>QLOO_API_KEY</code> to switch every
    number on this page to a real Qloo response.</p>`;
}

function tasteColumn(kind, title, entries, nameA, nameB) {
  const body = entries.length === 0
    ? `<p class="tag-empty">${kind === "shared" ? "No shared vocabulary found." : "Nothing distinct enough to call out."}</p>`
    : `<div class="tag-list">${entries.map((entry) => `<span class="tag">${esc(entry.tag)}</span>`).join("")}</div>`;
  return `<div class="taste-col" data-kind="${kind}"><h3>${esc(title)}</h3>${body}</div>`;
}

function venueGroup(title, subtitle, venues, kind, nameA, nameB) {
  if (!venues || venues.length === 0) return "";
  return `
    <section>
      <div class="group-head">
        <h3>${esc(title)}</h3>
        <p>${esc(subtitle)}</p>
        <span class="group-count">${venues.length}</span>
      </div>
      <div class="venues">
        ${venues.map((venue) => venueCard(venue, kind, nameA, nameB)).join("")}
      </div>
    </section>`;
}

function venueCard(venue, kind, nameA, nameB) {
  const tags = (venue.tags ?? []).slice(0, 4).map((tag) => `<span>${esc(tag.name)}</span>`).join("");
  const joint = Math.round((venue.compromise ?? 0) * 100);
  // A zero joint score is not a ranking, it is the absence of one.
  const badge = kind === "trade" ? "" : `<span class="venue-joint" title="Joint score for both people">${joint}</span>`;
  return `
    <article class="venue" data-bucket="${kind}">
      <div class="venue-head">
        <h4>${esc(venue.name)}</h4>
        ${badge}
      </div>
      ${venue.address ? `<p class="venue-addr">${esc(venue.address)}</p>` : ""}
      <div class="bars">
        ${barRow(nameA, venue.affinityA, "a")}
        ${barRow(nameB, venue.affinityB, "b")}
      </div>
      ${tags ? `<div class="venue-tags">${tags}</div>` : ""}
    </article>`;
}

function barRow(label, value, side) {
  const pct = Math.round((value ?? 0) * 100);
  return `<div class="bar-row" data-side="${side}">
    <span class="bar-who" title="${esc(label)}">${esc(label)}</span>
    <span class="bar-track"><i style="width:${pct}%"></i></span>
    <span class="bar-num">${pct}</span>
  </div>`;
}

function traceStep(step) {
  return `<div class="trace-step" data-ok="${step.ok}">
    <span class="trace-mark" aria-hidden="true"></span>
    <span class="trace-label">${esc(step.label)}<span class="trace-tool">${esc(step.tool)}</span></span>
    <span class="trace-ms">${step.ms ?? 0}ms</span>
  </div>`;
}

function callRow(call) {
  const args = Object.entries(call.args ?? {})
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join(" · ");
  return `<tr>
    <td>${esc(call.tool.replace("qloo api ", ""))}</td>
    <td>${esc(args)} ${call.cached ? '<span class="cached">cached</span>' : ""}</td>
  </tr>`;
}

async function copyVerdict(result) {
  const nameA = result.people.a.label;
  const nameB = result.people.b.label;
  const best = result.groups.both[0] ?? result.groups.trade[0];
  const lines = [
    `${result.city} — ${nameA} × ${nameB}`,
    result.narration.headline,
    "",
    result.narration.advice,
    best ? `→ ${best.name} (${Math.round(best.affinityA * 100)} / ${Math.round(best.affinityB * 100)})` : "",
  ].filter(Boolean);

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    byId("copyButton").textContent = "Copied";
  } catch {
    byId("copyButton").textContent = "Copy failed";
  }
  setTimeout(() => {
    const button = byId("copyButton");
    if (button) button.textContent = "Copy the verdict";
  }, 1800);
}

/* ---------------- helpers ---------------- */

function initial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
