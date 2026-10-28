/**
 * PalateOps client.
 *
 * No framework. The screen is one decision: who is at the table, and what can
 * they agree on. Every number rendered here came from the server; the browser
 * never invents or adjusts a score.
 */

const MAX_PEOPLE = 5;
const MIN_PEOPLE = 2;
const MAX_SIGNALS = 6;

const state = {
  health: null,
  presets: [],
  tasteTypes: [],
  people: [
    { label: "You", tagline: "", signals: [] },
    { label: "Them", tagline: "", signals: [] },
  ],
  city: "",
  maxPriceLevel: "",
  busy: false,
  result: null,
  activePreset: null,
};

/** Per-person DOM handles, rebuilt whenever the group changes shape. */
let cards = [];
let searchToken = 0;

const byId = (id) => document.getElementById(id);

init();

async function init() {
  bindCommit();
  byId("addPerson").addEventListener("click", () => {
    if (state.people.length >= MAX_PEOPLE) return;
    state.people.push({ label: `Person ${state.people.length + 1}`, tagline: "", signals: [] });
    markCustom();
    renderPeople();
  });
  await Promise.all([loadHealth(), loadPresets()]);
  renderMode();
}

/* ---------------- mode ---------------- */

async function loadHealth() {
  try {
    state.health = await (await fetch("/api/health")).json();
  } catch {
    state.health = { mode: "unknown", qlooConfigured: false };
  }
}

function renderMode() {
  const mode = state.health?.mode ?? "unknown";
  const badge = byId("modeBadge");
  badge.dataset.mode = mode;
  byId("modeText").textContent = mode === "live" ? "Live Qloo" : mode === "fixture" ? "Sample data" : "Offline";
  byId("footMode").textContent =
    mode === "live"
      ? "Live Qloo responses"
      : mode === "fixture"
        ? "Sample data — no Qloo request was made"
        : "Data source unavailable";
}

/* ---------------- presets ---------------- */

async function loadPresets() {
  try {
    const payload = await (await fetch("/api/presets")).json();
    state.presets = payload.presets ?? [];
    state.tasteTypes = payload.tasteTypes ?? [];
  } catch {
    state.presets = [];
    state.tasteTypes = [];
  }
  renderPresets();
  applyInitialState();
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
  if (state.activePreset === preset.id) {
    for (const other of document.querySelectorAll(".preset")) other.setAttribute("aria-pressed", "false");
    state.activePreset = null;
    return;
  }
  for (const other of document.querySelectorAll(".preset")) other.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-pressed", "true");
  state.activePreset = preset.id;
  state.city = preset.city;
  state.maxPriceLevel = preset.maxPriceLevel ? String(preset.maxPriceLevel) : "";
  byId("city").value = preset.city;
  byId("priceLevel").value = state.maxPriceLevel;
  state.people = preset.people.map((person) => ({
    label: person.label,
    tagline: person.tagline ?? "",
    signals: person.signals.map((signal) => ({ name: signal.name, type: signal.type, id: "" })),
  }));
  renderPeople();
  clearError();
}

/**
 * First load fills the form from the first starter group so the screen is
 * never empty. A shareable link overrides it: ?preset=<id>&run=1.
 */
function applyInitialState() {
  const params = new URLSearchParams(window.location.search);
  const presetId = params.get("preset");
  const targetId = presetId || state.presets[0]?.id;
  if (!targetId) {
    renderPeople();
    return;
  }
  const preset = state.presets.find((entry) => entry.id === targetId);
  if (!preset) {
    renderPeople();
    return;
  }
  const button = document.querySelector(`.preset[data-preset="${CSS.escape(preset.id)}"]`);
  if (button) applyPreset(preset, button);
  else renderPeople();
  if (presetId && params.get("run") === "1") setTimeout(run, 60);
}

/* ---------------- people ---------------- */

function renderPeople() {
  const holder = byId("people");
  holder.textContent = "";
  cards = state.people.map((person, index) => personCard(person, index));
  for (const card of cards) holder.append(card.el);
  byId("addPerson").disabled = state.people.length >= MAX_PEOPLE;
  byId("addPerson").hidden = state.people.length >= MAX_PEOPLE;
}

function personCard(person, index) {
  const el = document.createElement("article");
  el.className = "person";
  el.dataset.index = String(index);
  el.innerHTML = `
    <header class="person-head">
      <div class="avatar" aria-hidden="true"></div>
      <div class="person-id">
        <input class="name-input" type="text" maxlength="24" aria-label="Name for person ${index + 1}" />
        <p class="person-tagline"></p>
      </div>
      ${state.people.length > MIN_PEOPLE ? '<button class="remove-person" type="button" title="Remove this person">&times;</button>' : ""}
    </header>
    <div class="chips" role="list" aria-label="Taste signals"></div>
    <div class="search-row">
      <select class="domain-select" aria-label="Taste domain"></select>
      <input class="search-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="Search an artist, film, brand…" aria-label="Search a taste signal" />
      <div class="suggestions" hidden></div>
    </div>`;

  const refs = {
    el,
    index,
    avatar: el.querySelector(".avatar"),
    name: el.querySelector(".name-input"),
    tagline: el.querySelector(".person-tagline"),
    chips: el.querySelector(".chips"),
    domain: el.querySelector(".domain-select"),
    input: el.querySelector(".search-input"),
    suggestions: el.querySelector(".suggestions"),
  };

  for (const type of state.tasteTypes) {
    const option = document.createElement("option");
    option.value = type.alias;
    option.textContent = type.label;
    refs.domain.append(option);
  }

  refs.name.addEventListener("input", () => {
    state.people[index].label = refs.name.value.trim() || `Person ${index + 1}`;
    refs.avatar.textContent = initial(state.people[index].label);
    markCustom();
  });

  refs.input.addEventListener("input", debounce(() => suggest(refs), 280));
  refs.input.addEventListener("keydown", (event) => onSearchKey(event, refs));
  refs.input.addEventListener("blur", () => setTimeout(() => { refs.suggestions.hidden = true; }, 140));

  const remove = el.querySelector(".remove-person");
  remove?.addEventListener("click", () => {
    if (state.people.length <= MIN_PEOPLE) return;
    state.people.splice(index, 1);
    markCustom();
    renderPeople();
  });

  syncCard(refs);
  return refs;
}

function syncCard(refs) {
  const person = state.people[refs.index];
  refs.name.value = person.label;
  refs.avatar.textContent = initial(person.label);
  refs.tagline.textContent = person.tagline || "";

  refs.chips.textContent = "";
  if (person.signals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chips-empty";
    empty.textContent = "Nothing yet — add something they actually love.";
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
      person.signals = person.signals.filter((entry) => entry !== signal);
      markCustom();
      syncCard(refs);
    });
    chip.append(remove);
    refs.chips.append(chip);
  }
}

/* ---------------- search ---------------- */

async function suggest(refs) {
  const query = refs.input.value.trim();
  if (query.length < 2) {
    refs.suggestions.hidden = true;
    return;
  }
  const token = ++searchToken;
  refs.suggestions.hidden = false;
  refs.suggestions.innerHTML = `<p class="sug-note">Searching…</p>`;
  try {
    const type = refs.domain.value || "music";
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`);
    const payload = await response.json();
    if (token !== searchToken) return;
    if (!response.ok) throw new Error(payload.error || "Search failed.");
    renderSuggestions(refs, payload.results ?? [], type);
  } catch (error) {
    if (token !== searchToken) return;
    refs.suggestions.innerHTML = `<p class="sug-note">${esc(error.message)}</p>`;
  }
}

function renderSuggestions(refs, results, type) {
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
      addSignal(refs, { name: entity.name, type, id: entity.id ?? "" });
    });
    refs.suggestions.append(button);
  }
}

function onSearchKey(event, refs) {
  const options = [...refs.suggestions.querySelectorAll("button")];
  if (event.key === "Escape") { refs.suggestions.hidden = true; return; }
  if (event.key === "Enter" && options.length > 0) {
    event.preventDefault();
    options[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }
}

function addSignal(refs, signal) {
  const person = state.people[refs.index];
  if (person.signals.length >= MAX_SIGNALS) return;
  if (person.signals.some((entry) => entry.name.toLowerCase() === signal.name.toLowerCase() && entry.type === signal.type)) return;
  person.signals.push(signal);
  refs.input.value = "";
  refs.suggestions.hidden = true;
  markCustom();
  syncCard(refs);
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
  byId("priceLevel").addEventListener("change", (event) => {
    state.maxPriceLevel = event.target.value;
    clearError();
  });
  byId("runButton").addEventListener("click", run);
}

async function run() {
  if (state.busy) return;
  clearError();

  const city = byId("city").value.trim();
  if (city.length < 2) return fail("Choose a city, for example “Brooklyn, NY”.");
  if (state.people.length < MIN_PEOPLE) return fail("A compromise needs at least two people.");
  const empty = state.people.findIndex((person) => person.signals.length === 0);
  if (empty >= 0) return fail(`Add at least one taste signal for ${state.people[empty].label}.`);

  state.busy = true;
  const button = byId("runButton");
  button.disabled = true;
  button.dataset.busy = "true";
  byId("commitHint").textContent = "Resolving taste and ranking places…";

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        city,
        maxPriceLevel: state.maxPriceLevel ? Number(state.maxPriceLevel) : undefined,
        people: state.people.map((person) => ({ label: person.label, signals: person.signals })),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The agent could not finish.");
    state.result = payload;
    renderResult(payload);
  } catch (error) {
    fail(error.message);
  } finally {
    state.busy = false;
    button.disabled = false;
    button.dataset.busy = "false";
    byId("commitHint").textContent =
      "One Qloo request per person. The agent will loosen the price ceiling rather than return nothing.";
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
  const names = result.people.map((person) => person.label);
  const overlapPct = Math.round((result.summary.overlap ?? 0) * 100);

  host.innerHTML = `
    ${result.mode === "fixture" ? fixtureNotice() : ""}
    ${result.narration.negotiated ? negotiationCallout(result) : ""}
    <section class="verdict">
      <div class="verdict-copy">
        <p class="verdict-eyebrow">${esc(result.city)} · ${result.summary.total} places ranked for ${names.length} people</p>
        <h2>${esc(result.narration.headline)}</h2>
        <p class="verdict-detail">${esc(result.narration.detail)}</p>
        <p class="verdict-advice">${esc(result.narration.advice)}</p>
      </div>
      <div class="overlap">
        <span class="overlap-value">${overlapPct}%</span>
        <span class="overlap-label">of places work<br />for everyone</span>
        <div class="overlap-rail"><i style="width:${overlapPct}%"></i></div>
        <button class="verdict-copy-btn" id="copyButton" type="button">Copy the verdict</button>
      </div>
    </section>

    <section class="taste" style="--people:${names.length}" aria-label="Shared and individual taste">
      ${tasteShared(result.taste.shared, names)}
      ${result.taste.individual.map((entry) => tasteIndividual(entry)).join("")}
    </section>

    <div class="groups">
      ${venueGroup("Everyone", "Ranked highly for every person. These are the answers.", result.groups.everyone, "everyone", names)}
      ${venueGroup("Most of you", "Nobody objects. Nobody is excited either.", result.groups.most, "most", names)}
      ${venueGroup("One person's pick", "Strong for one person only. Somebody is conceding here.", result.groups.trade, "trade", names)}
    </div>

    <section class="receipt">
      <div class="panel">
        <h3>What the agent did</h3>
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

function negotiationCallout(result) {
  const decisions = result.negotiation.decisions
    .map((decision) => `<li><strong>${esc(decision.label)}</strong> — ${esc(decision.reason)}</li>`)
    .join("");
  return `<section class="negotiation">
    <p class="negotiation-tag">The agent changed the plan</p>
    <p class="negotiation-lead">${esc(result.narration.negotiated)}</p>
    <ul class="negotiation-list">${decisions}</ul>
  </section>`;
}

function tasteShared(entries, names) {
  const body = entries.length === 0
    ? `<p class="tag-empty">No shared vocabulary found — this group has genuinely different taste.</p>`
    : `<div class="tag-list">${entries.map((entry) => `<span class="tag">${esc(entry.tag)}</span>`).join("")}</div>`;
  return `<div class="taste-col" data-kind="shared"><h3>All ${names.length} of you</h3>${body}</div>`;
}

function tasteIndividual(entry) {
  const body = entry.tags.length === 0
    ? `<p class="tag-empty">Nothing distinct enough to call out.</p>`
    : `<div class="tag-list">${entry.tags.map((tag) => `<span class="tag">${esc(tag.tag)}</span>`).join("")}</div>`;
  return `<div class="taste-col" data-kind="individual"><h3>${esc(entry.label)} only</h3>${body}</div>`;
}

function venueGroup(title, subtitle, venues, kind, names) {
  if (!venues || venues.length === 0) return "";
  return `
    <section>
      <div class="group-head">
        <h3>${esc(title)}</h3>
        <p>${esc(subtitle)}</p>
        <span class="group-count">${venues.length}</span>
      </div>
      <div class="venues">
        ${venues.map((venue) => venueCard(venue, kind, names)).join("")}
      </div>
    </section>`;
}

function venueCard(venue, kind, names) {
  const shown = venue.displayTags ?? (venue.tags ?? []).slice(0, 4);
  const tags = shown.map((tag) => `<span>${esc(tag.name)}</span>`).join("");
  const badge = kind === "trade"
    ? ""
    : `<span class="venue-joint" title="Group score: the harmonic mean across everyone">${Math.round((venue.joint ?? 0) * 100)}</span>`;
  const price = venue.priceLevel ? `<span class="venue-price">${"$".repeat(venue.priceLevel)}</span>` : "";
  return `
    <article class="venue" data-bucket="${kind}">
      <div class="venue-head">
        <h4>${esc(venue.name)}</h4>
        ${price}
        ${badge}
      </div>
      ${venue.address ? `<p class="venue-addr">${esc(venue.address)}</p>` : ""}
      <div class="bars">
        ${names.map((name, index) => barRow(name, venue.scores[index], index)).join("")}
      </div>
      ${tags ? `<div class="venue-tags">${tags}</div>` : ""}
    </article>`;
}

function barRow(label, value, index) {
  const pct = Math.round((value ?? 0) * 100);
  return `<div class="bar-row" data-side="${index % 2 === 0 ? "a" : "b"}">
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
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join(" · ");
  return `<tr>
    <td>${esc(call.tool.replace("qloo api ", ""))}</td>
    <td>${esc(args)} ${call.cached ? '<span class="cached">cached</span>' : ""}</td>
  </tr>`;
}

async function copyVerdict(result) {
  const names = result.people.map((person) => person.label);
  const best = result.groups.everyone[0] ?? result.groups.most[0] ?? result.groups.trade[0];
  const lines = [
    `${result.city} — ${names.join(", ")}`,
    result.narration.headline,
    "",
    result.narration.negotiated ?? "",
    result.narration.advice,
    best ? `→ ${best.name}` : "",
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
