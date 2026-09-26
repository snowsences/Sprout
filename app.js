import "./firebase-client.js";
import { SPROUT_CONFIG } from "./config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = $("#app");
const CURRENT_YEAR = new Date().getFullYear();
const GARDEN_LOCATION = { lat: 45.8236, lon: -122.7412 }; // approx. zip 98642
const PX_PER_INCH = 4;
const PLANT_CATEGORIES = [
  { id: "tomatoes", label: "Tomatoes", icon: "🍅" },
  { id: "carrots", label: "Carrots", icon: "🥕" },
  { id: "chiles", label: "Chiles", icon: "🌶️" },
  { id: "squash", label: "Squash", icon: "🎃" },
  { id: "beans", label: "Beans", icon: "🫘" },
  { id: "potatoes", label: "Potatoes", icon: "🥔" },
  { id: "berries", label: "Berries", icon: "🍓" },
  { id: "alliums", label: "Alliums", icon: "🧅" },
  { id: "greens", label: "Greens", icon: "🥬" },
  { id: "other", label: "Other", icon: "📦" },
];
const COLORS = ["#4f8d5b", "#75a843", "#a7b43c", "#d8a62d", "#df7435", "#c94c49", "#a95a87", "#735ca7", "#3f83a8", "#3b8c83"];
const STATUSES = ["planned", "seeded", "planted", "growing", "harvesting", "finished", "failed", "removed"];
const LOG_TYPES = ["note", "watered", "fertilised", "pruned", "transplanted", "pest or disease", "treatment", "harvested", "status change"];

const state = {
  user: window.SproutCurrentUser || null,
  data: window.SproutData || window.SproutStore.getData(),
  tab: "garden",
  year: null,
  seedCategory: "all",
  yearSubTab: "calendar",
  search: "",
  modal: null,
  selected: null,
  mode: "browse",
  busy: false,
  clipboard: null,
  map: { zoom: 1, panX: 20, panY: 20, initializedYear: null },
};
let ensuringInitialYear = false;

const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const snap = (value) => Math.round(value / state.data.settings.gridIn) * state.data.settings.gridIn;
const title = (value) => String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateText = (timestamp) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
const shortDate = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Not set";
const dimensions = (inches) => `${Math.floor(Number(inches) / 12)}′ ${Number(inches) % 12}″`;
const toInches = (feet, inches) => Math.max(0, Number(feet || 0) * 12 + Number(inches || 0));
const splitInches = (inches) => ({ feet: Math.floor(Number(inches || 0) / 12), inches: Number(inches || 0) % 12 });
const yearIsReadOnly = () => Number(state.year) !== Number(state.data.settings.activeYear);
const bedsForYear = () => state.data.beds.filter((bed) => Number(bed.year) === Number(state.year)).sort((a, b) => a.number - b.number);
const plantsForYear = () => state.data.plants.filter((plant) => Number(plant.year) === Number(state.year));
const seedById = (id) => state.data.seeds.find((seed) => seed.id === id);
const seedFor = (plant) => seedById(plant?.seedId) || {};
const plantsForSeedThisYear = (seedId) => state.data.plants.filter((plant) => plant.seedId === seedId && Number(plant.year) === Number(state.year) && !plant.archived);
const categoryById = (id) => PLANT_CATEGORIES.find((category) => category.id === id);
const categoryForSeed = (seed = {}) => {
  if (categoryById(seed.category)) return seed.category;
  if (seed.icon === "🫑" || seed.icon === "🌶️") return "chiles";
  return PLANT_CATEGORIES.find((category) => category.icon === seed.icon)?.id || "greens";
};
const iconForSeed = (seed) => categoryById(categoryForSeed(seed))?.icon || "🥬";
const yearRecord = (year) => state.data.years.find((item) => Number(item.year) === Number(year));
const yearUpdateSortKey = (entry) => entry.type === "monthly" ? `${entry.year}-${pad2(entry.month)}-${pad2(new Date(entry.year, entry.month, 0).getDate())}` : entry.date || "";
const yearUpdatesForYear = (year) => state.data.yearUpdates.filter((entry) => Number(entry.year) === Number(year)).sort((a, b) => yearUpdateSortKey(b).localeCompare(yearUpdateSortKey(a)) || b.createdAt - a.createdAt);
const categoryDatesFor = (categoryId) => state.data.categoryDates[categoryId] || {};
const monthDayLabel = (mmdd) => mmdd ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(`2024-${mmdd}T12:00:00`)) : "Not set";
const monthLabel = (month) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2024, Number(month) - 1, 1));
const pad2 = (value) => String(value).padStart(2, "0");
const monthlyUpdateId = (year, month) => `${year}-${pad2(month)}-monthly`;
const monthlyUpdateFor = (year, month) => state.data.yearUpdates.find((entry) => entry.id === monthlyUpdateId(year, month));

function seedsForMonth(year, month) {
  const monthStart = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const seedIds = new Set();
  for (const plant of state.data.plants) {
    if (Number(plant.year) !== Number(year)) continue;
    if (plant.archived) {
      if (!plant.removedAt || new Date(plant.removedAt).toISOString().slice(0, 10) < monthStart) continue;
    }
    const seed = seedFor(plant);
    if (!seed.id) continue;
    const dates = categoryDatesFor(categoryForSeed(seed));
    if (dates.plantDate && `${year}-${dates.plantDate}` > monthEnd) continue;
    seedIds.add(seed.id);
  }
  return [...seedIds].map((id) => seedById(id)).filter(Boolean).sort((a, b) => a.commonName.localeCompare(b.commonName));
}

function defaultMonthlyMonth(year) {
  const now = new Date();
  if (Number(year) === now.getFullYear()) return now.getMonth() === 0 ? 12 : now.getMonth();
  return 12;
}

function pendingMonthlyBanner() {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();
  if (month === 0) { month = 12; year -= 1; } else { /* month already 1-indexed previous month */ }
  if (!state.data.years.some((item) => Number(item.year) === year)) return null;
  return monthlyUpdateFor(year, month) ? null : { year, month };
}

function icon(name) {
  const paths = {
    garden: '<path d="M4 19V9m5 10V5m6 14V8m5 11V4M2 19h20M3 12h18M6 6c-2-3 1-5 3-3 0 2-1 3-3 3Zm7 5c-2-3 1-5 3-3 0 2-1 3-3 3Z"/>',
    seeds: '<path d="M12 22V9m0 4c-5 0-8-3-8-8 5 0 8 3 8 8Zm0 4c5 0 8-3 8-8-5 0-8 3-8 8Z"/>',
    link: '<path d="M9 15 15 9M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
    activity: '<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 6l3 3"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3v12H4V7Z"/><circle cx="12" cy="13" r="4"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.garden}</svg>`;
}

function toast(message, kind = "") {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.append(stack);
  }
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  stack.append(node);
  setTimeout(() => node.remove(), 3800);
}

function render() {
  if (!state.user) {
    root.innerHTML = renderSignIn();
    return;
  }
  if (!state.year) state.year = Number(state.data.settings.activeYear || CURRENT_YEAR);
  const years = [...new Set([state.data.settings.activeYear, ...state.data.years.map((item) => item.year)])].filter(Boolean).sort((a, b) => b - a);
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><img src="./icon-192.png" alt=""><span class="brand-name">Sprout</span></div>
        <div class="topbar-center">
          <select class="year-select" data-action="change-year" aria-label="Garden year">
            ${years.map((year) => `<option value="${year}" ${Number(year) === Number(state.year) ? "selected" : ""}>${year}</option>`).join("")}
          </select>
          ${yearIsReadOnly() ? '<span class="readonly-chip">Snapshot</span>' : '<span class="active-chip">Active year</span>'}
        </div>
        ${state.tab === "garden" ? `<button class="topbar-add-plant" data-action="add-plant" ${yearIsReadOnly() || !state.data.seeds.length ? "disabled" : ""} aria-label="Add plant">${icon("plus")}</button>` : ""}
        <div class="sync-state"><span class="sync-dot"></span><span>${state.data.fromCache ? "Connecting…" : "Up to date"}</span></div>
      </header>
      <div class="banner-slot">${(() => { const banner = pendingMonthlyBanner(); return banner ? `<button class="month-banner" data-action="open-monthly-banner" data-year="${banner.year}" data-month="${banner.month}">It's time for the ${monthLabel(banner.month)} update</button>` : ""; })()}</div>
      <main class="main">${renderPage()}</main>
      <nav class="bottom-nav" aria-label="Main navigation">
        ${navButton("garden", "Garden", "garden")}
        ${navButton("year", String(state.year), "calendar")}
        ${navButton("seeds", "Seeds", "seeds")}
        ${navButton("activity", "Activity", "activity")}
        ${navButton("settings", "Settings", "settings")}
      </nav>
    </div>
    ${renderModal()}
  `;
  if (state.tab === "garden") requestAnimationFrame(bindMap);
}

function renderSignIn() {
  const configured = window.SproutStore.configured;
  return `<main class="signin"><section class="signin-card">
    <img src="./icon-192.png" alt="Sprout app icon">
    <h1>Sprout</h1>
    <p>Plan the garden together and keep every plant’s story in one place.</p>
    ${configured
      ? '<button class="google-button" data-action="sign-in">Continue with Google</button>'
      : '<div class="config-box"><strong>Firebase setup needed</strong><br>Paste the new Sprout web-app configuration into <code>config.js</code>, enable Google sign-in, and publish the included Firestore rules.</div>'}
  </section></main>`;
}

function navButton(tab, label, iconName) {
  return `<button class="nav-item ${state.tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}">${icon(iconName)}<span>${label}</span></button>`;
}

function renderPage() {
  if (state.tab === "garden") return renderGarden();
  if (state.tab === "year") return renderYearTab();
  if (state.tab === "seeds") return renderSeeds();
  if (state.tab === "activity") return renderActivity();
  return renderSettings();
}

function renderGarden() {
  const settings = state.data.settings;
  const beds = bedsForYear();
  const seeds = state.data.seeds;
  const plants = plantsForYear().filter((plant) => !plant.archived);
  const readOnly = yearIsReadOnly();
  const selectedPlant = state.selected?.type === "plant" ? state.data.plants.find((item) => item.id === state.selected.id) : null;
  const selectedBed = state.mode === "layout" && state.selected?.type === "bed" ? state.data.beds.find((item) => item.id === state.selected.id) : null;
  return `<section class="tab-page garden-page">
    <div class="garden-tools">
      <div class="segmented" aria-label="Garden interaction mode">
        <button data-action="mode" data-mode="browse" class="${state.mode === "browse" ? "active" : ""}">Browse</button>
        <button class="mode-beds-btn ${state.mode === "layout" ? "active" : ""}" data-action="mode" data-mode="layout" ${readOnly ? "disabled" : ""}>Beds</button>
        <button data-action="mode" data-mode="plants" class="${state.mode === "plants" ? "active" : ""}" ${readOnly ? "disabled" : ""}>Plants</button>
      </div>
      <span class="tool-divider"></span>
      <button class="tool-button add-bed-btn" data-action="add-bed" ${readOnly || beds.length >= 10 ? "disabled" : ""}>${icon("plus")}<span>Add bed</span></button>
      <button class="tool-button primary add-plant-btn" data-action="add-plant" ${readOnly || !seeds.length ? "disabled" : ""}>${icon("plus")}<span>Add plant</span></button>
      ${readOnly ? `<button class="tool-button" data-action="duplicate-year">${icon("duplicate")}<span>Duplicate year</span></button>` : ""}
      <div class="zoom-group">
        <button class="icon-button" data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button>
        <button class="icon-button" data-action="fit-map" aria-label="Fit garden">${icon("fit")}</button>
        <button class="icon-button" data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button>
      </div>
    </div>
    <div class="garden-body">
      <div class="map-viewport" aria-label="Garden plan">
        <div class="garden-world ${readOnly ? "readonly" : ""} ${state.mode !== "layout" ? "beds-inert" : ""} ${state.mode === "layout" ? "layout-mode" : ""}" style="width:${settings.widthIn * PX_PER_INCH}px;height:${settings.heightIn * PX_PER_INCH}px;background-size:${settings.gridIn * PX_PER_INCH}px ${settings.gridIn * PX_PER_INCH}px">
          ${beds.map((bed) => renderBed(bed)).join("")}
          ${plants.map((plant) => renderPlantMarker(plant)).join("")}
        </div>
        ${!beds.length && !plants.length ? `<div class="map-empty"><h2>${readOnly ? "No beds in this snapshot" : "Start planning your garden"}</h2><p>${readOnly ? "This year does not contain a saved layout." : "Add a numbered bed for visual context, or add seeds and place plants anywhere on the grid."}</p>${readOnly ? "" : '<button class="primary-button" data-action="add-bed">Add first bed</button>'}</div>` : ""}
        ${selectedPlant ? renderSelectionPlant(selectedPlant) : selectedBed ? renderSelectionBed(selectedBed) : ""}
      </div>
    </div>
  </section>`;
}

function resizeHandles(kind, id) {
  return ["nw", "ne", "sw", "se"].map((corner) => `<span class="resize-handle rh-${corner}" data-resize="${kind}" data-corner="${corner}" data-id="${id}"></span>`).join("");
}

function renderBed(bed) {
  const width = bed.widthIn * PX_PER_INCH;
  const height = bed.heightIn * PX_PER_INCH;
  const rotation = Number(bed.rotation || 0);
  const quarterTurn = Math.abs(rotation % 180) === 90;
  const visualLeft = quarterTurn ? (width - height) / 2 : 0;
  const visualTop = quarterTurn ? (height - width) / 2 : 0;
  const selected = state.selected?.type === "bed" && state.selected.id === bed.id;
  const showHandles = !yearIsReadOnly() && state.mode === "layout" && selected;
  return `<div class="bed-wrap" data-kind="bed" data-id="${bed.id}" style="left:${bed.x * PX_PER_INCH}px;top:${bed.y * PX_PER_INCH}px;width:${width}px;height:${height}px">
    <div class="bed ${state.mode === "layout" && selected ? "selected" : ""}" style="transform:rotate(${rotation}deg)"></div>
    <span class="bed-number" style="left:${visualLeft}px;top:${visualTop}px">${bed.number}</span>
    ${showHandles ? resizeHandles("bed", bed.id) : ""}
  </div>`;
}

function renderPlantMarker(plant) {
  const seed = seedFor(plant);
  const selected = state.selected?.type === "plant" && state.selected.id === plant.id;
  const showHandles = !yearIsReadOnly() && state.mode === "plants" && selected;
  return `<div class="plant-marker ${selected ? "selected" : ""}" data-kind="plant" data-id="${plant.id}" style="--plant-color:${esc(seed.color || "#4f8d5b")};left:${plant.x * PX_PER_INCH}px;top:${plant.y * PX_PER_INCH}px;width:${plant.widthIn * PX_PER_INCH}px;height:${plant.heightIn * PX_PER_INCH}px"><span class="plant-icon">${esc(iconForSeed(seed))}</span><span class="plant-label">${esc(seed.commonName || "Plant")}</span>${showHandles ? resizeHandles("plant", plant.id) : ""}</div>`;
}

function renderSelectionPlant(plant) {
  const seed = seedFor(plant);
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon" style="--plant-color:${esc(seed.color)}">${esc(iconForSeed(seed))}</div><div class="selection-copy"><h3>${esc(seed.commonName || "Plant")}</h3><p>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)} · ${title(plant.status)}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div><div class="selection-actions"><button class="secondary-button" data-action="plant-details" data-id="${plant.id}">Details</button>${yearIsReadOnly() ? "" : `<button class="primary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button>`}</div></aside>`;
}

function renderSelectionBed(bed) {
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon">${bed.number}</div><div class="selection-copy"><h3>Bed ${bed.number}</h3><p>${dimensions(bed.widthIn)} × ${dimensions(bed.heightIn)}${bed.notes ? ` · ${esc(bed.notes)}` : ""}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div>${yearIsReadOnly() ? "" : `<div class="selection-actions"><button class="primary-button" data-action="edit-bed" data-id="${bed.id}">Edit bed</button></div>`}</aside>`;
}

function renderYearCard() {
  const year = state.year;
  const record = yearRecord(year) || {};
  const readOnly = yearIsReadOnly();
  const updates = yearUpdatesForYear(year);
  const today = new Date().toISOString().slice(0, 10);
  return `<aside class="year-card">
    <div class="year-cover">
      ${record.coverPhoto ? `<img src="${esc(record.coverPhoto.url)}" alt="${year} cover photo">` : `<div class="year-cover-empty">${icon("camera")}<span>No cover photo</span></div>`}
      ${readOnly ? "" : `<label class="text-button year-cover-upload">${record.coverPhoto ? "Change photo" : "Add cover photo"}<input class="hidden" type="file" accept="image/*" data-year-cover="${year}"></label>`}
    </div>
    <div class="year-card-body">
      <div class="section-head"><h3>${year} Updates</h3>${readOnly ? "" : `<button class="text-button" data-action="log-monthly-update">Log Monthly Update</button>`}</div>
      ${readOnly ? "" : `<form id="year-update-form" class="year-update-form"><input type="hidden" name="year" value="${year}"><input name="date" type="date" value="${today}" max="${today}" required><textarea name="text" maxlength="1000" placeholder="What happened in the garden today?" required></textarea><button class="primary-button full" type="submit">Add update</button></form>`}
      <div class="year-timeline">${updates.length ? updates.map((entry) => renderUpdateEntry(entry, readOnly)).join("") : '<div class="form-note">No updates yet this year.</div>'}</div>
    </div>
  </aside>`;
}

function renderUpdateEntry(entry, readOnly) {
  if (entry.type === "monthly") {
    const chips = (entry.ratings || []).map((r) => `<span class="rating-chip">${esc(seedById(r.seedId)?.commonName || "Plant")}: ${r.rating == null ? "N/A" : "★".repeat(r.rating)}</span>`).join("");
    return `<article class="timeline-entry timeline-monthly">
      <div class="timeline-date">${monthLabel(entry.month)} ${entry.year} <span class="timeline-badge">Monthly</span></div>
      <div class="monthly-summary">${chips}</div>
      ${entry.note ? `<p>${esc(entry.note)}</p>` : ""}
      ${readOnly ? "" : `<button class="text-button" data-action="edit-monthly-update" data-id="${entry.id}">Edit</button> · <button class="text-button" data-action="delete-year-update" data-id="${entry.id}">Delete</button>`}
    </article>`;
  }
  return `<article class="timeline-entry"><div class="timeline-date">${shortDate(entry.date)}</div><p>${esc(entry.text)}</p>${readOnly ? "" : `<button class="text-button" data-action="delete-year-update" data-id="${entry.id}">Delete</button>`}</article>`;
}

function renderYearTab() {
  const year = state.year;
  return `<section class="tab-page year-tab">
    <div class="year-subtabs segmented" role="tablist" aria-label="Year view">
      <button data-action="year-subtab" data-subtab="calendar" class="${state.yearSubTab === "calendar" ? "active" : ""}">Calendar</button>
      <button data-action="year-subtab" data-subtab="updates" class="${state.yearSubTab === "updates" ? "active" : ""}">Updates</button>
      <button data-action="year-subtab" data-subtab="insights" class="${state.yearSubTab === "insights" ? "active" : ""}">Insights</button>
    </div>
    <div class="year-tab-body">
      <div class="year-pane ${state.yearSubTab === "calendar" ? "active" : ""}">${renderCalendar(year)}</div>
      <div class="year-pane year-pane-updates ${state.yearSubTab === "updates" ? "active" : ""}">${renderYearCard()}</div>
      <div class="year-pane ${state.yearSubTab === "insights" ? "active" : ""}">${renderInsights(year)}</div>
    </div>
  </section>`;
}

function categoryEventsForYear(year) {
  const groups = new Map();
  const add = (mmdd, eventType, categoryId, seedName) => {
    if (!mmdd) return;
    const key = `${mmdd}|${eventType}|${categoryId}`;
    if (!groups.has(key)) groups.set(key, { mmdd, eventType, categoryId, names: new Set() });
    groups.get(key).names.add(seedName || "Plant");
  };
  const plants = state.data.plants.filter((plant) => Number(plant.year) === Number(year) && !plant.archived);
  for (const plant of plants) {
    const seed = seedFor(plant);
    const categoryId = categoryForSeed(seed);
    const dates = categoryDatesFor(categoryId);
    add(dates.plantDate, "plant", categoryId, seed.commonName);
    if (dates.startIndoors) add(dates.startIndoorsDate, "indoors", categoryId, seed.commonName);
  }
  return [...groups.values()].sort((a, b) => a.mmdd.localeCompare(b.mmdd));
}

function renderCalendar(year) {
  const events = categoryEventsForYear(year);
  if (!events.length) return `<div class="empty-state">No planting dates yet. Set Plant Dates for your categories from the gear icon on the Seeds tab.</div>`;
  let lastMonth = "";
  const rows = events.map((event) => {
    const date = new Date(`${year}-${event.mmdd}T12:00:00`);
    const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
    const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
    const category = categoryById(event.categoryId);
    const header = monthLabel !== lastMonth ? `<h3 class="cal-month">${monthLabel}</h3>` : "";
    lastMonth = monthLabel;
    return `${header}<article class="cal-row"><div class="cal-date">${dayLabel}</div><div class="cal-icon">${category?.icon || "🌱"}</div><div class="cal-desc"><strong>${event.eventType === "plant" ? "Plant Date" : "Start Indoors"}: ${esc(category?.label || "Other")}</strong><small>${esc([...event.names].join(", "))}</small></div></article>`;
  }).join("");
  return `<div class="calendar-list">${rows}</div>`;
}

function monthlyWeatherStats(weather) {
  const months = Array.from({ length: 12 }, () => ({ count: 0, highSum: 0, lowSum: 0, precipSum: 0 }));
  let hot90 = 0, hot95 = 0, cold32 = 0;
  for (const day of weather.days || []) {
    const monthIndex = Number(day.date.slice(5, 7)) - 1;
    if (!months[monthIndex]) continue;
    if (day.tempHighF != null) { months[monthIndex].highSum += day.tempHighF; months[monthIndex].count++; if (day.tempHighF >= 90) hot90++; if (day.tempHighF >= 95) hot95++; }
    if (day.tempLowF != null) { months[monthIndex].lowSum += day.tempLowF; if (day.tempLowF <= 32) cold32++; }
    if (day.precipIn != null) months[monthIndex].precipSum += day.precipIn;
  }
  return {
    months: months.map((m, index) => ({ month: index + 1, avgHigh: m.count ? m.highSum / m.count : null, avgLow: m.count ? m.lowSum / m.count : null, precip: m.count ? m.precipSum : null })),
    hot90, hot95, cold32,
  };
}

function historicalWeatherStats() {
  const byMonth = Array.from({ length: 12 }, () => ({ highs: [], lows: [], precipTotals: [] }));
  for (const yearDoc of state.data.weather) {
    const perMonth = Array.from({ length: 12 }, () => ({ highSum: 0, highCount: 0, lowSum: 0, lowCount: 0, precipSum: 0, any: false }));
    for (const day of yearDoc.days || []) {
      const monthIndex = Number(day.date.slice(5, 7)) - 1;
      if (!perMonth[monthIndex]) continue;
      const bucket = perMonth[monthIndex];
      bucket.any = true;
      if (day.tempHighF != null) { bucket.highSum += day.tempHighF; bucket.highCount++; }
      if (day.tempLowF != null) { bucket.lowSum += day.tempLowF; bucket.lowCount++; }
      if (day.precipIn != null) bucket.precipSum += day.precipIn;
    }
    perMonth.forEach((bucket, index) => {
      if (!bucket.any) return;
      if (bucket.highCount) byMonth[index].highs.push(bucket.highSum / bucket.highCount);
      if (bucket.lowCount) byMonth[index].lows.push(bucket.lowSum / bucket.lowCount);
      byMonth[index].precipTotals.push(bucket.precipSum);
    });
  }
  const avg = (values) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  const monthly = byMonth.map((bucket, index) => ({ month: index + 1, avgHigh: avg(bucket.highs), avgLow: avg(bucket.lows), avgPrecip: avg(bucket.precipTotals) }));
  const overallHigh = avg(monthly.map((m) => m.avgHigh).filter((v) => v != null));
  const overallLow = avg(monthly.map((m) => m.avgLow).filter((v) => v != null));
  const overallPrecip = monthly.reduce((sum, m) => sum + (m.avgPrecip || 0), 0);
  return { monthly, overallHigh, overallLow, overallPrecip, yearsCount: state.data.weather.length };
}

function monthlyRatingStats(entries) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const entry = entries.find((item) => Number(item.month) === month);
    const rated = (entry?.ratings || []).filter((r) => r.rating != null);
    return { month, avg: rated.length ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length : null };
  });
}

function seedRatingStats(entries) {
  const bySeed = new Map();
  for (const entry of entries) {
    for (const r of entry.ratings || []) {
      if (r.rating == null) continue;
      if (!bySeed.has(r.seedId)) bySeed.set(r.seedId, { sum: 0, count: 0 });
      const agg = bySeed.get(r.seedId);
      agg.sum += r.rating; agg.count++;
    }
  }
  return [...bySeed.entries()].map(([seedId, agg]) => ({ seed: seedById(seedId), avg: agg.sum / agg.count }))
    .filter((item) => item.seed).sort((a, b) => b.avg - a.avg);
}

function niceCeil(value) {
  if (!value || value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function smoothPath(points) {
  if (points.length < 2) return `M ${points[0]?.join(",") || "0,0"}`;
  let d = `M ${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function verticalBarChart({ series, months, unit, max, labels, historical, yAxis }) {
  const values = months.flatMap((m) => series.map((s) => m[s.key])).filter((v) => v != null);
  const histValues = historical ? months.flatMap((m) => historical.map((h) => m[h.key])).filter((v) => v != null) : [];
  const rawMax = max || Math.max(1, ...values, ...histValues);
  const axisMax = yAxis ? niceCeil(rawMax) : rawMax;
  const legendItems = [
    ...(series.length > 1 ? series.map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${s.label}</span>`) : []),
    ...(historical ? historical.map((h) => `<span class="legend-item"><span class="legend-swatch legend-swatch-hist" style="background:${h.color}"></span>${h.label}</span>`) : []),
  ];
  const legend = legendItems.length ? `<div class="chart-legend">${legendItems.join("")}</div>` : "";
  const cols = months.map((m) => {
    const bars = series.map((s) => {
      const v = m[s.key];
      const pct = v == null ? 0 : Math.max(2, Math.round((v / axisMax) * 100));
      const valueLabel = v == null ? "—" : `${v.toFixed(1)}${unit}`;
      return `<div class="chart-bar" style="height:${pct}%;background:${v == null ? "transparent" : s.color}" title="${monthLabel(m.month)} ${s.label}: ${valueLabel}">${labels && v != null ? `<span class="chart-bar-value">${v.toFixed(1)}</span>` : ""}</div>`;
    }).join("");
    return `<div class="chart-col"><div class="chart-bars">${bars}</div></div>`;
  }).join("");
  const labelCols = months.map((m) => `<div class="chart-col-label">${monthLabel(m.month).slice(0, 3)}</div>`).join("");
  let overlaySvg = "";
  if (historical) {
    const paths = historical.map((h) => {
      const points = months.map((m, index) => {
        const v = m[h.key];
        if (v == null) return null;
        const x = (index + 0.5) * (100 / months.length);
        const y = 100 - Math.max(0, Math.min(100, (v / axisMax) * 100));
        return [x, y];
      }).filter(Boolean);
      if (points.length < 2) return "";
      return `<path d="${smoothPath(points)}" fill="none" stroke="${h.color}" stroke-width="2" vector-effect="non-scaling-stroke" opacity="0.5"/>`;
    }).join("");
    overlaySvg = `<svg class="chart-hist-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>`;
  }
  const yAxisHtml = yAxis ? `<div class="chart-y-axis">${[4, 3, 2, 1, 0].map((i) => `<span>${Math.round((axisMax * i) / 4)}${unit}</span>`).join("")}</div>` : "";
  return `${legend}<div class="chart-plot">${yAxisHtml}<div class="chart-frame-wrap"><div class="chart-frame">${cols}${overlaySvg}</div><div class="chart-labels-row">${labelCols}</div></div></div>`;
}

function statTile(label, value) {
  return `<div class="stat-tile"><strong>${value}</strong><span>${esc(label)}</span></div>`;
}

function renderInsights(year) {
  const weather = state.data.weather.find((w) => Number(w.year) === Number(year));
  const monthlyEntries = state.data.yearUpdates.filter((u) => u.type === "monthly" && Number(u.year) === Number(year));

  const weatherBody = weather ? (() => {
    const stats = monthlyWeatherStats(weather);
    const hist = historicalWeatherStats();
    const hasHistory = state.data.weather.some((w) => Number(w.year) !== Number(year));
    const monthsMerged = stats.months.map((m, index) => ({ ...m, histHigh: hist.monthly[index]?.avgHigh, histLow: hist.monthly[index]?.avgLow, histPrecip: hist.monthly[index]?.avgPrecip }));
    const tempChart = verticalBarChart({
      series: [{ key: "avgHigh", label: "Avg High", color: "#2a78d6" }, { key: "avgLow", label: "Avg Low", color: "#eb6834" }],
      months: monthsMerged, unit: "°F", yAxis: true,
      historical: hasHistory ? [{ key: "histHigh", color: "#2a78d6", label: "Historical Avg High" }, { key: "histLow", color: "#eb6834", label: "Historical Avg Low" }] : null,
    });
    const rainChart = verticalBarChart({
      series: [{ key: "precip", label: "Rainfall", color: "#1baf7a" }],
      months: monthsMerged, unit: "in", labels: true,
      historical: hasHistory ? [{ key: "histPrecip", color: "#1baf7a", label: "Historical Avg" }] : null,
    });
    const histSummary = hasHistory ? `<p class="hist-summary">Historical average (since 2021, ${hist.yearsCount} yr${hist.yearsCount === 1 ? "" : "s"} of data): ${hist.overallHigh != null ? hist.overallHigh.toFixed(0) : "—"}°F high · ${hist.overallLow != null ? hist.overallLow.toFixed(0) : "—"}°F low · ${hist.overallPrecip.toFixed(1)}in/yr rainfall</p>` : "";
    return `${histSummary}<div class="chart-card"><h4>Monthly Temperatures (avg high/low, °F)</h4>${tempChart}</div>
      <div class="chart-card"><h4>Monthly Rainfall (in)</h4>${rainChart}</div>
      <div class="stat-tiles">${statTile("Days ≥ 90°F", stats.hot90)}${statTile("Days ≥ 95°F", stats.hot95)}${statTile("Days ≤ 32°F", stats.cold32)}</div>`;
  })() : `<div class="empty-state">No weather data yet for ${year}. Fetch historical highs, lows, and rainfall since 2021 for zip 98642.</div>`;

  const ratingBody = monthlyEntries.length ? (() => {
    const monthly = monthlyRatingStats(monthlyEntries);
    const bySeed = seedRatingStats(monthlyEntries);
    const ratingChart = verticalBarChart({ series: [{ key: "avg", label: "Avg Rating", color: "#2a78d6" }], months: monthly, unit: "★", max: 5, labels: true });
    const seedBars = bySeed.length ? `<div class="rank-list">${bySeed.map((item) => `<div class="rank-row"><span class="rank-label">${esc(item.seed.commonName)}</span><div class="rank-bar-track"><div class="rank-bar" style="width:${(item.avg / 5) * 100}%"></div></div><span class="rank-value">${item.avg.toFixed(1)}★</span></div>`).join("")}</div>` : '<div class="form-note">No rated seeds yet.</div>';
    return `<div class="chart-card"><h4>Average Rating by Month</h4>${ratingChart}</div><div class="chart-card"><h4>Average Rating by Seed</h4>${seedBars}</div>`;
  })() : `<div class="empty-state">No Monthly Updates logged yet for ${year}.</div>`;

  return `<div class="insights-pane">
    <div class="insights-section"><div class="section-head"><h3>Weather</h3><button class="text-button" data-action="fetch-weather">${state.data.weather.length ? "Refresh" : "Fetch"} weather history</button></div>${weatherBody}</div>
    <div class="insights-section"><div class="section-head"><h3>Seed Ratings</h3></div>${ratingBody}</div>
  </div>`;
}

function renderSeeds() {
  const query = state.search.trim().toLowerCase();
  const seeds = [...state.data.seeds]
    .filter((seed) => state.seedCategory === "all" || categoryForSeed(seed) === state.seedCategory)
    .filter((seed) => !query || seed.commonName.toLowerCase().includes(query) || seed.notes?.toLowerCase().includes(query))
    .sort((a, b) => a.commonName.localeCompare(b.commonName));
  return `<section class="tab-page content-page"><div class="page-heading"><div><h1>Seeds</h1><p>${seeds.length} shown</p></div><div class="page-actions"><button class="icon-button" data-action="category-dates" aria-label="Category planting dates">${icon("settings")}</button><button class="primary-button" data-action="add-seed">Add seed</button></div></div>
    <div class="search-row"><label class="search-wrap">${icon("search")}<input id="plant-search" type="search" placeholder="Search seeds" value="${esc(state.search)}"></label></div>
    <div class="plant-category-tabs" role="tablist" aria-label="Seed categories"><button role="tab" aria-selected="${state.seedCategory === "all"}" class="${state.seedCategory === "all" ? "active" : ""}" data-action="seed-category" data-category="all">All</button>${PLANT_CATEGORIES.map((category) => `<button role="tab" aria-selected="${state.seedCategory === category.id}" class="${state.seedCategory === category.id ? "active" : ""}" data-action="seed-category" data-category="${category.id}"><span>${category.icon}</span>${category.label}</button>`).join("")}</div>
    <div class="plant-list">${seeds.length ? seeds.map((seed) => { const activeCount = plantsForSeedThisYear(seed.id).length; const dates = categoryDatesFor(categoryForSeed(seed)); return `<button class="plant-row" data-action="seed-details" data-id="${seed.id}" style="--plant-color:${esc(seed.color)}"><span class="plant-avatar">${esc(iconForSeed(seed))}</span><span class="plant-main"><h3>${esc(seed.commonName)}</h3><p>${title(categoryForSeed(seed))}${dates.plantDate ? ` · ${monthDayLabel(dates.plantDate)}` : ""}</p></span><span class="status-pill">${activeCount} planted</span></button>`; }).join("") : '<div class="empty-state">No seeds match this view. Add your first seed to get started.</div>'}</div>
  </section>`;
}

function renderActivity() {
  const entries = [...state.data.activity].filter((entry) => Number(entry.year) === Number(state.year)).sort((a, b) => b.createdAt - a.createdAt);
  return `<section class="tab-page content-page"><div class="page-heading"><div><h1>Activity</h1><p>Everything changed in ${state.year}, and who changed it.</p></div></div><div class="activity-list">${entries.length ? entries.map((entry, index) => `<div class="activity-row"><div class="activity-badge">${entry.subjectType === "plant" ? "🌱" : entry.subjectType === "bed" ? "▦" : "✓"}</div><div><p><strong>${esc(entry.actorName || entry.actorEmail || "Someone")}</strong> ${esc(entry.action)}${entry.label && entry.label !== "Sprout" ? ` <strong>${esc(entry.label)}</strong>` : ""}${entry.undoneAt ? " <em>(undone)</em>" : ""}</p><p class="activity-meta">${entry.sourceYear ? `Copied ${entry.sourceYear} into ${entry.targetYear}` : esc(entry.actorEmail || "")}</p></div><span class="activity-time">${dateText(entry.createdAt)}${index === 0 && !yearIsReadOnly() && entry.undo?.operations?.length && !entry.undoneAt ? `<button class="text-button" data-action="undo-activity" data-id="${entry.id}">Undo</button>` : ""}</span></div>`).join("") : '<div class="empty-state">No activity has been recorded for this year yet.</div>'}</div></section>`;
}

function renderSettings() {
  const width = splitInches(state.data.settings.widthIn);
  const height = splitInches(state.data.settings.heightIn);
  const years = [...state.data.years].sort((a, b) => b.year - a.year);
  return `<section class="tab-page content-page"><div class="page-heading"><div><h1>Settings</h1><p>Garden size, yearly plans, accounts and backups.</p></div></div><div class="settings-grid">
    <section class="settings-card"><h2>Garden size</h2><p>The permanent six-inch grid fills these real-world dimensions.</p><form id="garden-settings" class="form-grid"><label class="field"><span>Width</span>${dimensionInputs("garden-width", width)}</label><label class="field"><span>Height</span>${dimensionInputs("garden-height", height)}</label><button class="primary-button full field" type="submit">Save garden size</button></form></section>
    <section class="settings-card"><h2>Shared account</h2><p>Only the two approved Google accounts can access this garden.</p><div class="account-row"><div class="account-avatar">${state.user.photoURL ? `<img src="${esc(state.user.photoURL)}" alt="" style="width:44px;height:44px;border-radius:50%">` : "K"}</div><div class="account-copy"><strong>${esc(state.user.displayName || "Signed in")}</strong><span>${esc(state.user.email)}</span></div><button class="secondary-button" data-action="sign-out">Sign out</button></div></section>
    <section class="settings-card wide"><h2>Years</h2><p>The active year can be edited. Older years remain read-only snapshots.</p><div class="button-row">${years.map((year) => `<button class="secondary-button" data-action="view-year" data-year="${year.year}">${year.year}${Number(year.year) === Number(state.data.settings.activeYear) ? " · Active" : ""}</button>`).join("")}<button class="primary-button" data-action="duplicate-year">Duplicate a year</button></div></section>
    <section class="settings-card"><h2>Backup</h2><p>Download all Sprout data as JSON, or merge a previous backup into Firestore.</p><div class="button-row"><button class="secondary-button" data-action="export">${icon("download")} Export</button><button class="secondary-button" data-action="import">${icon("upload")} Import</button></div></section>
    <section class="settings-card"><h2>Connections</h2><p>Firebase: <strong>${window.SproutStore.configured ? "Configured" : "Needs setup"}</strong><br>Photos: <strong>${SPROUT_CONFIG.cloudinaryWorkerUrl.startsWith("PASTE_") ? "Worker URL needed" : "Configured"}</strong></p><p>Photo uploads are resized in the browser to 1500px and kept below about 3.5MB.</p></section>
  </div></section>`;
}

function dimensionInputs(name, value, minimum = 0) {
  return `<span class="dimension-row"><input name="${name}-ft" type="number" min="${minimum}" max="200" value="${value.feet}" inputmode="numeric" required><span>ft</span><input name="${name}-in" type="number" min="0" max="11" step="1" value="${value.inches}" inputmode="numeric" required><span>in</span></span>`;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal.type === "bed") return renderBedModal(state.modal.id ? state.data.beds.find((item) => item.id === state.modal.id) : null);
  if (state.modal.type === "plant") return renderPlantModal(state.modal.id ? state.data.plants.find((item) => item.id === state.modal.id) : null);
  if (state.modal.type === "details") return renderPlantDetails(state.data.plants.find((item) => item.id === state.modal.id));
  if (state.modal.type === "log") return renderLogModal(state.data.plants.find((item) => item.id === state.modal.id));
  if (state.modal.type === "seed") return renderSeedModal(state.modal.id ? seedById(state.modal.id) : null);
  if (state.modal.type === "seedDetails") return renderSeedDetails(seedById(state.modal.id));
  if (state.modal.type === "categoryDates") return renderCategoryDatesModal();
  if (state.modal.type === "monthlyUpdate") return renderMonthlyUpdateModal();
  if (state.modal.type === "duplicate") return renderDuplicateModal();
  if (state.modal.type === "confirm") return renderConfirmModal();
  return "";
}

function modalShell(titleText, body, actions = "", large = false) {
  return `<div class="modal-layer" data-action="modal-backdrop"><section class="modal ${large ? "large" : ""}" role="dialog" aria-modal="true" aria-label="${esc(titleText)}"><header class="modal-header"><h2>${esc(titleText)}</h2><button class="close-button" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-body">${body}</div>${actions ? `<footer class="modal-actions">${actions}</footer>` : ""}</section></div>`;
}

function renderBedModal(bed) {
  const used = new Set(bedsForYear().filter((item) => item.id !== bed?.id).map((item) => item.number));
  const number = bed?.number || [...Array(10)].map((_, index) => index + 1).find((value) => !used.has(value));
  const width = splitInches(bed?.widthIn || 48);
  const height = splitInches(bed?.heightIn || 96);
  const body = `<form id="bed-form" class="form-grid"><input type="hidden" name="id" value="${bed?.id || ""}"><label class="field full"><span>Bed number</span><div class="choice-row">${[...Array(10)].map((_, index) => index + 1).map((value) => `<button type="button" class="choice ${value === number ? "selected" : ""}" data-field-choice="number" data-value="${value}" ${used.has(value) ? "disabled" : ""}>${value}</button>`).join("")}</div><input type="hidden" name="number" value="${number}"></label><label class="field"><span>Width</span>${dimensionInputs("bed-width", width)}</label><label class="field"><span>Length</span>${dimensionInputs("bed-height", height)}</label><label class="field full"><span>Rotation</span><div class="choice-row"><button type="button" class="choice ${!bed?.rotation ? "selected" : ""}" data-field-choice="rotation" data-value="0">0°</button><button type="button" class="choice ${Number(bed?.rotation) === 90 ? "selected" : ""}" data-field-choice="rotation" data-value="90">90°</button></div><input type="hidden" name="rotation" value="${bed?.rotation || 0}"></label><label class="field full"><span>Notes (optional)</span><textarea name="notes" maxlength="1000" placeholder="Anything useful about this bed…">${esc(bed?.notes || "")}</textarea></label></form>`;
  const deleteButton = bed ? '<button class="danger-button" data-action="delete-bed">Delete bed</button>' : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(bed ? `Edit Bed ${bed.number}` : "Add a Bed", body, `${deleteButton}<button class="primary-button" type="button" data-action="save-bed">Save</button>`);
}

function renderPlantModal(plant) {
  const initial = plant || {};
  const sizeW = splitInches(initial.widthIn || 12);
  const sizeH = splitInches(initial.heightIn || 12);
  const seeds = [...state.data.seeds].sort((a, b) => a.commonName.localeCompare(b.commonName));
  const selectedSeedId = initial.seedId || seeds[0]?.id || "";
  const body = `<form id="plant-form" class="form-grid"><input type="hidden" name="id" value="${plant?.id || ""}"><label class="field full"><span>Seed</span><select name="seedId" required>${seeds.map((seed) => `<option value="${seed.id}" ${seed.id === selectedSeedId ? "selected" : ""}>${esc(seed.commonName)}</option>`).join("")}</select></label><label class="field"><span>Plant width</span>${dimensionInputs("plant-width", sizeW)}</label><label class="field"><span>Plant length</span>${dimensionInputs("plant-height", sizeH)}</label><label class="field"><span>Status</span><select name="status">${STATUSES.map((status) => `<option value="${status}" ${status === (initial.status || "planned") ? "selected" : ""}>${title(status)}</option>`).join("")}</select></label><label class="field full"><span>Notes</span><textarea name="notes" maxlength="3000" placeholder="Anything specific to this planting…">${esc(initial.notes || "")}</textarea></label></form>`;
  const archive = plant ? `<button class="${plant.archived ? "secondary-button" : "danger-button"}" data-action="archive-plant" data-id="${plant.id}">${plant.archived ? "Restore" : "Archive"}</button>` : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(plant ? `Edit ${seedFor(plant).commonName || "Plant"}` : "Add a Plant", body, `${archive}<button class="primary-button" type="button" data-action="save-plant">Save</button>`, true);
}

function renderSeedModal(seed) {
  const initial = seed || {};
  const commonName = initial.commonName || "";
  const selectedCategory = initial.category || initial.icon ? categoryForSeed(initial) : PLANT_CATEGORIES[0].id;
  const selectedIcon = categoryById(selectedCategory).icon;
  const selectedColor = initial.color || COLORS[0];
  const sun = initial.sun || "medium";
  const water = initial.water || "medium";
  const body = `<form id="seed-form" class="form-grid"><input type="hidden" name="id" value="${seed?.id || ""}"><label class="field full"><span>Common name</span><input id="seed-name" name="commonName" value="${esc(commonName)}" maxlength="80" autocomplete="off" required></label><label class="field full"><span>Category</span><div class="choice-row plant-category-choices">${PLANT_CATEGORIES.map((category) => `<button type="button" class="choice plant-category-choice ${category.id === selectedCategory ? "selected" : ""}" data-field-choice="category" data-value="${category.id}" data-icon="${category.icon}"><span>${category.icon}</span><small>${category.label}</small></button>`).join("")}</div><input type="hidden" name="category" value="${selectedCategory}"><input type="hidden" name="icon" value="${esc(selectedIcon)}"></label><label class="field full"><span>Colour</span><div class="choice-row">${COLORS.map((item) => `<button type="button" class="color-choice ${item === selectedColor ? "selected" : ""}" style="--choice-color:${item}" data-field-choice="color" data-value="${item}" aria-label="${item}"></button>`).join("")}</div><input type="hidden" name="color" value="${selectedColor}"></label>${levelSelector("sun", "Sun", sun, "☁️", "⛅", "☀️")}${levelSelector("water", "Water", water, "💧", "💧💧", "💧💧💧")}<label class="field full"><span>Seed link</span><input name="seedLink" type="url" placeholder="https://…" value="${esc(initial.seedLink || "")}"></label><label class="field full"><span>Notes</span><textarea name="notes" maxlength="3000" placeholder="Care details, source, or anything useful…">${esc(initial.notes || "")}</textarea></label></form>`;
  const deleteButton = seed ? '<button class="danger-button" data-action="delete-seed" data-id="'+seed.id+'">Delete seed</button>' : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(seed ? `Edit ${seed.commonName}` : "Add a Seed", body, `${deleteButton}<button class="primary-button" type="button" data-action="save-seed">Save</button>`, true);
}

function renderSeedDetails(seed) {
  if (!seed) return "";
  const plants = plantsForSeedThisYear(seed.id);
  const categoryId = categoryForSeed(seed);
  const dates = categoryDatesFor(categoryId);
  const body = `<div class="detail-hero"><div class="detail-icon" style="--plant-color:${esc(seed.color)}">${esc(iconForSeed(seed))}</div><div class="detail-title"><h2>${esc(seed.commonName)}</h2><p>${title(categoryId)}</p></div><div class="detail-actions"><button class="secondary-button" data-action="edit-seed" data-id="${seed.id}">Edit</button></div></div><div class="fact-grid"><div class="fact"><span>Plant date</span><strong>${monthDayLabel(dates.plantDate)}</strong></div>${dates.startIndoors ? `<div class="fact"><span>Start indoors</span><strong>${monthDayLabel(dates.startIndoorsDate)}</strong></div>` : ""}<div class="fact"><span>Sun</span><strong>${seed.sun === "low" ? "☁️" : seed.sun === "high" ? "☀️" : "⛅"} ${seed.sun}</strong></div><div class="fact"><span>Water</span><strong>${seed.water === "low" ? "💧" : seed.water === "high" ? "💧💧💧" : "💧💧"} ${seed.water}</strong></div><div class="fact"><span>Seed link</span><strong>${seed.seedLink ? `<a href="${esc(seed.seedLink)}" target="_blank" rel="noopener noreferrer">${icon("link")} Buy</a>` : "—"}</strong></div></div>${seed.notes ? `<div class="section-head"><h3>Notes</h3></div><div class="notes-box">${esc(seed.notes)}</div>` : ""}<div class="section-head"><h3>Plants in ${state.year}</h3></div><div class="plant-list">${plants.length ? plants.map((plant) => `<button class="plant-row" data-action="plant-details" data-id="${plant.id}" style="--plant-color:${esc(seed.color)}"><span class="plant-avatar">${esc(iconForSeed(seed))}</span><span class="plant-main"><h3>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</h3><p>${plant.notes ? esc(plant.notes) : "No notes"}</p></span><span class="status-pill ${esc(plant.status)}">${esc(plant.status)}</span></button>`).join("") : '<div class="form-note">No active plants from this seed in the current year.</div>'}</div>`;
  return modalShell(seed.commonName, body, "", true);
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthDayFields(fieldName, categoryId, mmdd) {
  const [mm, dd] = (mmdd || "01-01").split("-").map(Number);
  const monthOptions = [...Array(12)].map((_, i) => i + 1).map((m) => `<option value="${m}" ${m === mm ? "selected" : ""}>${monthLabel(m)}</option>`).join("");
  const dayOptions = [...Array(DAYS_IN_MONTH[mm - 1])].map((_, i) => i + 1).map((d) => `<option value="${d}" ${d === dd ? "selected" : ""}>${d}</option>`).join("");
  return `<div class="month-day-fields"><select data-cat-field="${fieldName}-month" data-category="${categoryId}">${monthOptions}</select><select data-cat-field="${fieldName}-day" data-category="${categoryId}">${dayOptions}</select></div>`;
}

function renderCategoryDatesModal() {
  const rows = PLANT_CATEGORIES.map((category) => {
    const dates = state.data.categoryDates[category.id] || {};
    return `<div class="category-date-row" data-category-row="${category.id}">
      <div class="category-date-head"><span>${category.icon}</span><strong>${category.label}</strong></div>
      <label class="field"><span>Plant Date</span>${monthDayFields("plantDate", category.id, dates.plantDate)}</label>
      <label class="field checkbox-field"><input type="checkbox" data-cat-field="startIndoors" data-category="${category.id}" ${dates.startIndoors ? "checked" : ""}><span>Start Indoors</span></label>
      <label class="field ${dates.startIndoors ? "" : "hidden"}" data-indoors-date="${category.id}"><span>Start Indoors Date</span>${monthDayFields("startIndoorsDate", category.id, dates.startIndoorsDate)}</label>
    </div>`;
  }).join("");
  const body = `<form id="category-dates-form" class="category-dates-list">${rows}</form>`;
  return modalShell("Category Planting Dates", body, '<button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" type="button" data-action="save-category-dates">Save</button>', true);
}

function ratingRow(seed, existing) {
  const current = existing?.ratings?.find((entry) => entry.seedId === seed.id);
  const value = current ? (current.rating == null ? "na" : String(current.rating)) : "";
  return `<div class="rating-row">
    <div class="rating-seed"><span>${esc(iconForSeed(seed))}</span><strong>${esc(seed.commonName)}</strong></div>
    <div class="rating-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star ${value && value !== "na" && n <= Number(value) ? "selected" : ""}" data-rating-choice data-seed="${seed.id}" data-value="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}<button type="button" class="rating-na ${value === "na" ? "selected" : ""}" data-rating-choice data-seed="${seed.id}" data-value="na">N/A</button></div>
    <input type="hidden" name="rating-${seed.id}" value="${value}">
    <input class="rating-note" type="text" name="note-${seed.id}" placeholder="Notes (optional)" value="${esc(current?.notes || "")}" maxlength="300">
  </div>`;
}

function renderMonthlyUpdateModal() {
  const { year, month } = state.modal;
  const existing = monthlyUpdateFor(year, month);
  const seeds = seedsForMonth(year, month);
  const monthOptions = [...Array(12)].map((_, index) => index + 1).map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${monthLabel(m)}</option>`).join("");
  const body = `<form id="monthly-update-form" class="monthly-update-form">
    <input type="hidden" name="year" value="${year}">
    <label class="field full"><span>Month</span><select name="month" id="monthly-update-month">${monthOptions}</select></label>
    ${seeds.length ? `<div class="rating-list">${seeds.map((seed) => ratingRow(seed, existing)).join("")}</div>` : '<div class="empty-state">No seeds were in the garden this month.</div>'}
    <label class="field full"><span>Overall notes (optional)</span><textarea name="overallNote" maxlength="1000" placeholder="Anything else about ${monthLabel(month)}…">${esc(existing?.note || "")}</textarea></label>
  </form>`;
  return modalShell(`Monthly Update — ${monthLabel(month)} ${year}`, body, '<button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" type="button" data-action="save-monthly-update">Save</button>', true);
}

function levelSelector(name, label, selected, lowIcon, mediumIcon, highIcon) {
  return `<label class="field full"><span>${label}</span><div class="choice-row">${[["low",lowIcon],["medium",mediumIcon],["high",highIcon]].map(([value, symbol]) => `<button type="button" class="choice ${value === selected ? "selected" : ""}" data-field-choice="${name}" data-value="${value}">${symbol} ${title(value)}</button>`).join("")}</div><input type="hidden" name="${name}" value="${selected}"></label>`;
}

function renderPlantDetails(plant) {
  if (!plant) return "";
  const seed = seedFor(plant);
  const dates = categoryDatesFor(categoryForSeed(seed));
  const logs = state.data.logs.filter((entry) => entry.plantId === plant.id).sort((a, b) => b.createdAt - a.createdAt);
  const body = `<div class="detail-hero"><div class="detail-icon" style="--plant-color:${esc(seed.color)}">${esc(iconForSeed(seed))}</div><div class="detail-title"><h2>${esc(seed.commonName || "Plant")}</h2><p>${title(plant.status)}</p></div>${yearIsReadOnly() ? "" : `<div class="detail-actions"><button class="secondary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button></div>`}</div><div class="fact-grid"><div class="fact"><span>Size</span><strong>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</strong></div><div class="fact"><span>Plant date</span><strong>${dates.plantDate ? shortDate(`${plant.year}-${dates.plantDate}`) : "Not set"}</strong></div>${dates.startIndoors ? `<div class="fact"><span>Start indoors</span><strong>${dates.startIndoorsDate ? shortDate(`${plant.year}-${dates.startIndoorsDate}`) : "Not set"}</strong></div>` : ""}<div class="fact"><span>Sun</span><strong>${seed.sun === "low" ? "☁️" : seed.sun === "high" ? "☀️" : "⛅"} ${seed.sun}</strong></div><div class="fact"><span>Water</span><strong>${seed.water === "low" ? "💧" : seed.water === "high" ? "💧💧💧" : "💧💧"} ${seed.water}</strong></div></div><div class="section-head"><h3>Seed</h3><button class="text-button" data-action="seed-details" data-id="${seed.id}">View seed</button></div>${plant.notes ? `<div class="section-head"><h3>Notes</h3></div><div class="notes-box">${esc(plant.notes)}</div>` : ""}<div class="section-head"><h3>Photos</h3>${yearIsReadOnly() ? "" : `<label class="text-button">Add photo<input class="hidden" type="file" accept="image/*" data-photo-plant="${plant.id}"></label>`}</div><div class="photo-grid">${(plant.photos || []).map((photo, index) => `<div class="photo"><img src="${esc(photo.url)}" alt="${esc(seed.commonName || "Plant")} photo" loading="lazy">${yearIsReadOnly() ? "" : `<button class="photo-delete" data-action="delete-photo" data-id="${plant.id}" data-index="${index}" aria-label="Delete photo">×</button>`}</div>`).join("")}${!(plant.photos || []).length ? '<div class="form-note" style="grid-column:1/-1">No photos yet.</div>' : ""}</div><div class="section-head"><h3>Journal</h3>${yearIsReadOnly() ? "" : `<button class="text-button" data-action="add-log" data-id="${plant.id}">Add entry</button>`}</div><div class="journal-list">${logs.length ? logs.map((entry) => `<article class="journal-entry"><div class="journal-head"><span class="journal-type">${esc(entry.type)}</span><span class="journal-date">${dateText(entry.createdAt)}</span></div>${entry.note ? `<p>${esc(entry.note)}</p>` : ""}${entry.photos?.[0] ? `<img class="journal-photo" src="${esc(entry.photos[0].url)}" alt="Journal photo" loading="lazy">` : ""}<div class="journal-meta">${esc(entry.actorName || entry.actorEmail || "Someone")}${yearIsReadOnly() ? "" : ` · <button class="text-button" data-action="delete-log" data-id="${entry.id}">Delete</button>`}</div></article>`).join("") : '<div class="form-note">No journal entries yet.</div>'}</div>`;
  return modalShell(seed.commonName || "Plant", body, "", true);
}

function renderLogModal(plant) {
  const seed = seedFor(plant);
  const body = `<form id="log-form" class="form-grid"><input type="hidden" name="plantId" value="${plant.id}"><label class="field full"><span>Entry type</span><select name="type">${LOG_TYPES.map((type) => `<option value="${type}">${title(type)}</option>`).join("")}</select></label><label class="field full"><span>Note</span><textarea name="note" maxlength="3000" placeholder="What happened?"></textarea></label><label class="field full"><span>Photo (optional)</span><input name="photo" type="file" accept="image/*"></label></form>`;
  return modalShell(`Add to ${seed.commonName || "Plant"}`, body, '<button class="secondary-button" data-action="plant-details" data-id="'+plant.id+'">Cancel</button><button class="primary-button" type="button" data-action="save-log">Save entry</button>');
}

function renderDuplicateModal() {
  const years = [...state.data.years].sort((a, b) => b.year - a.year);
  const source = Number(state.year || state.data.settings.activeYear);
  const target = Math.max(CURRENT_YEAR, ...years.map((item) => Number(item.year))) + 1;
  const body = `<form id="duplicate-form" class="form-grid"><label class="field"><span>Copy from</span><select name="sourceYear">${years.map((year) => `<option value="${year.year}" ${Number(year.year) === source ? "selected" : ""}>${year.year}</option>`).join("")}</select></label><label class="field"><span>New year</span><input name="targetYear" type="number" min="2020" max="2100" value="${target}" required></label><div class="form-note field full">Beds and active plant placements will be copied. Plants begin as Planned, with no photos. Seeds are shared across years and are not duplicated. The original year remains unchanged.</div></form>`;
  return modalShell("Duplicate a Year", body, '<button class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" type="button" data-action="save-duplicate">Duplicate</button>');
}

function renderConfirmModal() {
  const modal = state.modal;
  return modalShell(modal.title, `<p>${esc(modal.message)}</p>`, `<button class="secondary-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-action">${esc(modal.confirmLabel || "Delete")}</button>`);
}

function openModal(modal) { state.modal = modal; render(); requestAnimationFrame(() => $(".modal input:not([type=hidden]),.modal select,.modal textarea")?.focus()); }
function closeModal() { state.modal = null; render(); }

async function ensureInitialYear() {
  if (!state.user || ensuringInitialYear) return;
  const active = Number(state.data.settings.activeYear || CURRENT_YEAR);
  if (!state.data.years.some((item) => Number(item.year) === active)) {
    ensuringInitialYear = true;
    try { await window.SproutStore.ensureYear(active); } catch (error) { toast(error.message || "Could not create the current year.", "error"); }
    finally { ensuringInitialYear = false; }
  }
}

let ensuringWeather = false;
async function ensureWeatherFresh() {
  if (!state.user || ensuringWeather) return;
  const latestFetch = Math.max(0, ...state.data.weather.map((w) => w.fetchedAt || 0));
  const stale = !state.data.weather.length || (Date.now() - latestFetch) > 20 * 60 * 60 * 1000;
  if (!stale) return;
  ensuringWeather = true;
  try { await fetchWeatherHistory(); render(); } catch { /* silent: retried on next load */ }
  finally { ensuringWeather = false; }
}

function firstBedPosition(widthIn, heightIn) {
  const grid = state.data.settings.gridIn;
  const index = bedsForYear().length;
  const x = snap(grid * 2 + (index % 3) * (widthIn + grid * 2));
  const y = snap(grid * 2 + Math.floor(index / 3) * (heightIn + grid * 2));
  return { x: clamp(x, 0, Math.max(0, state.data.settings.widthIn - widthIn)), y: clamp(y, 0, Math.max(0, state.data.settings.heightIn - heightIn)) };
}

function firstPlantPosition(widthIn, heightIn) {
  const grid = state.data.settings.gridIn;
  const index = plantsForYear().length;
  const x = snap(grid * 2 + (index % 4) * (widthIn + grid * 2));
  const y = snap(grid * 2 + Math.floor(index / 4) * (heightIn + grid * 2));
  return { x: clamp(x, 0, Math.max(0, state.data.settings.widthIn - widthIn)), y: clamp(y, 0, Math.max(0, state.data.settings.heightIn - heightIn)) };
}

async function saveBed(form) {
  const values = new FormData(form);
  const existing = state.data.beds.find((item) => item.id === values.get("id"));
  const number = Number(values.get("number"));
  const widthIn = snap(toInches(values.get("bed-width-ft"), values.get("bed-width-in")));
  const heightIn = snap(toInches(values.get("bed-height-ft"), values.get("bed-height-in")));
  if (!Number.isInteger(number) || number < 1 || number > 10) throw new Error("Choose a bed number from 1 to 10.");
  if (bedsForYear().some((bed) => bed.id !== existing?.id && bed.number === number)) throw new Error(`Bed ${number} already exists in this year.`);
  if (widthIn < 12 || heightIn < 12) throw new Error("Beds must be at least one foot in each direction.");
  const position = existing || firstBedPosition(widthIn, heightIn);
  const saving = window.SproutStore.saveBed({ ...existing, id: existing?.id, year: state.year, number, widthIn, heightIn, rotation: Number(values.get("rotation")), notes: values.get("notes"), x: position.x, y: position.y });
  state.modal = null;
  state.mode = "layout";
  render();
  await saving;
  toast(existing ? "Bed updated." : "Bed added. Drag it into place in Beds mode.");
}

async function savePlant(form) {
  const values = new FormData(form);
  const existing = state.data.plants.find((item) => item.id === values.get("id"));
  const seed = state.data.seeds.find((item) => item.id === values.get("seedId"));
  if (!seed) throw new Error("Choose a seed.");
  const widthIn = snap(toInches(values.get("plant-width-ft"), values.get("plant-width-in")));
  const heightIn = snap(toInches(values.get("plant-height-ft"), values.get("plant-height-in")));
  if (widthIn < state.data.settings.gridIn || heightIn < state.data.settings.gridIn) throw new Error("Plant size must be at least one grid square.");
  if (widthIn > state.data.settings.widthIn || heightIn > state.data.settings.heightIn) throw new Error("This plant footprint is larger than the garden.");
  const position = existing ? { x: clamp(existing.x, 0, state.data.settings.widthIn - widthIn), y: clamp(existing.y, 0, state.data.settings.heightIn - heightIn) } : firstPlantPosition(widthIn, heightIn);
  const saved = await window.SproutStore.savePlant({ ...existing, id: existing?.id, year: state.year, seedId: seed.id, widthIn, heightIn, status: values.get("status"), notes: values.get("notes"), x: position.x, y: position.y });
  state.modal = null;
  state.mode = "plants";
  state.selected = { type: "plant", id: saved.id };
  render();
  toast(existing ? "Plant updated." : "Plant added. Drag it into place in Plants mode.");
}

async function saveSeed(form) {
  const values = new FormData(form);
  const existing = state.data.seeds.find((item) => item.id === values.get("id"));
  const commonName = String(values.get("commonName") || "").trim();
  const category = categoryById(values.get("category"))?.id || "greens";
  const seedIcon = categoryById(category).icon;
  const seed = { id: existing?.id, commonName, category, icon: seedIcon, color: values.get("color"), sun: values.get("sun"), water: values.get("water"), seedLink: values.get("seedLink"), notes: values.get("notes") };
  const saved = await window.SproutStore.saveSeed(seed);
  state.modal = { type: "seedDetails", id: saved.id };
  render();
  toast(existing ? "Seed updated." : "Seed added.");
}

function monthDayValue(form, fieldName, categoryId) {
  const month = form.querySelector(`[data-cat-field="${fieldName}-month"][data-category="${categoryId}"]`)?.value;
  const day = form.querySelector(`[data-cat-field="${fieldName}-day"][data-category="${categoryId}"]`)?.value;
  return month && day ? `${pad2(month)}-${pad2(day)}` : "";
}

async function saveCategoryDates(form) {
  const map = {};
  for (const category of PLANT_CATEGORIES) {
    const startIndoorsInput = form.querySelector(`[data-cat-field="startIndoors"][data-category="${category.id}"]`);
    map[category.id] = {
      plantDate: monthDayValue(form, "plantDate", category.id),
      startIndoors: Boolean(startIndoorsInput?.checked),
      startIndoorsDate: monthDayValue(form, "startIndoorsDate", category.id),
    };
  }
  await window.SproutStore.saveCategoryDates(map);
  closeModal();
  toast("Category planting dates saved.");
}

async function saveMonthlyUpdate(form) {
  const values = new FormData(form);
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const seeds = seedsForMonth(year, month);
  const ratings = [];
  for (const seed of seeds) {
    const raw = values.get(`rating-${seed.id}`);
    if (!raw) throw new Error(`Rate ${seed.commonName} (or mark N/A) before saving.`);
    ratings.push({ seedId: seed.id, rating: raw === "na" ? null : Number(raw), notes: values.get(`note-${seed.id}`) || "" });
  }
  await window.SproutStore.saveMonthlyUpdate({ year, month, ratings, note: values.get("overallNote") });
  closeModal();
  toast(`${monthLabel(month)} update saved.`);
}

async function fetchWeatherHistory() {
  const start = "2021-01-01";
  const now = new Date();
  const end = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${GARDEN_LOCATION.lat}&longitude=${GARDEN_LOCATION.lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FLos_Angeles`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch weather data.");
  const json = await response.json();
  const byYear = new Map();
  const times = json.daily?.time || [];
  for (let index = 0; index < times.length; index++) {
    const date = times[index];
    const year = Number(date.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ date, tempHighF: json.daily.temperature_2m_max[index], tempLowF: json.daily.temperature_2m_min[index], precipIn: json.daily.precipitation_sum[index] });
  }
  for (const [year, days] of byYear) {
    await window.SproutStore.saveWeatherYear(year, days);
  }
}

async function saveYearUpdate(form) {
  const values = new FormData(form);
  await window.SproutStore.addYearUpdate({ year: Number(values.get("year")), date: values.get("date"), text: values.get("text") });
  render();
  toast("Update added.");
}

async function saveLog(form) {
  const values = new FormData(form);
  const plant = state.data.plants.find((item) => item.id === values.get("plantId"));
  let photos = [];
  const file = values.get("photo");
  if (file?.size) photos = [await uploadPhoto(file, plant.id)];
  await window.SproutStore.addLog({ plantId: plant.id, year: plant.year, type: values.get("type"), note: values.get("note"), photos });
  state.modal = { type: "details", id: plant.id }; render(); toast("Journal entry added.");
}

async function duplicateYear(form) {
  const values = new FormData(form);
  const target = Number(values.get("targetYear"));
  await window.SproutStore.duplicateYear(Number(values.get("sourceYear")), target);
  state.year = target; state.selected = null; state.modal = null; state.mode = "browse"; state.map.initializedYear = null; render(); toast(`${target} is now the active garden plan.`);
}

function applyFieldChoice(button) {
  const form = button.closest("form");
  const name = button.dataset.fieldChoice;
  const field = form?.elements[name];
  if (!field) {
    toast("That option could not be selected.", "error");
    return;
  }
  $$(`[data-field-choice="${name}"]`, form).forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  field.value = button.dataset.value;
  if (name === "category" && button.dataset.icon && form.elements.icon) form.elements.icon.value = button.dataset.icon;
}

function applyRatingChoice(button) {
  const form = button.closest("form");
  const seedId = button.dataset.seed;
  const value = button.dataset.value;
  const field = form?.elements[`rating-${seedId}`];
  if (!field) return;
  field.value = value;
  $$(`[data-rating-choice][data-seed="${seedId}"]`, form).forEach((el) => {
    if (el.dataset.value === "na") { el.classList.toggle("selected", value === "na"); return; }
    el.classList.toggle("selected", value !== "na" && Number(el.dataset.value) <= Number(value));
  });
}

function bindMap() {
  const viewport = $(".map-viewport");
  const world = $(".garden-world");
  if (!viewport || !world) return;
  const apply = () => { world.style.transform = `translate3d(${state.map.panX}px,${state.map.panY}px,0) scale(${state.map.zoom})`; };
  const fit = () => {
    const width = state.data.settings.widthIn * PX_PER_INCH;
    const height = state.data.settings.heightIn * PX_PER_INCH;
    const zoom = clamp(Math.min((viewport.clientWidth - 36) / width, (viewport.clientHeight - 36) / height), .22, 2.5);
    state.map.zoom = zoom;
    state.map.panX = (viewport.clientWidth - width * zoom) / 2;
    state.map.panY = (viewport.clientHeight - height * zoom) / 2;
    state.map.initializedYear = state.year;
    apply();
  };
  if (state.map.initializedYear !== state.year) fit(); else apply();
  viewport._gardenFit = fit;
  viewport._gardenZoom = (factor, clientX = viewport.getBoundingClientRect().left + viewport.clientWidth / 2, clientY = viewport.getBoundingClientRect().top + viewport.clientHeight / 2) => {
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const old = state.map.zoom;
    const next = clamp(old * factor, .2, 4);
    const worldX = (localX - state.map.panX) / old;
    const worldY = (localY - state.map.panY) / old;
    state.map.zoom = next;
    state.map.panX = localX - worldX * next;
    state.map.panY = localY - worldY * next;
    apply();
  };

  const pointers = new Map();
  let interaction = null;
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const findItem = (kind, itemId) => (kind === "bed" ? state.data.beds.find((entry) => entry.id === itemId) : state.data.plants.find((entry) => entry.id === itemId));
  viewport.onpointerdown = (event) => {
    if (event.target.closest(".selection-card,button,input,select,textarea,label")) return;
    pointers.set(event.pointerId, point(event));
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size >= 2) { interaction = null; return; }
    const handle = event.target.closest("[data-resize]");
    if (handle) {
      const kind = handle.dataset.resize;
      const handleId = handle.dataset.id;
      const allowed = !yearIsReadOnly() && ((kind === "bed" && state.mode === "layout") || (kind === "plant" && state.mode === "plants"));
      if (allowed) {
        const item = findItem(kind, handleId);
        const node = handle.closest(kind === "bed" ? ".bed-wrap" : ".plant-marker");
        state.selected = { type: kind, id: handleId };
        interaction = { type: `resize-${kind}`, id: handleId, corner: handle.dataset.corner, startX: event.clientX, startY: event.clientY, originalX: item.x, originalY: item.y, originalW: item.widthIn, originalH: item.heightIn, moved: false, node };
      }
      return;
    }
    const target = event.target.closest("[data-kind]");
    const kind = target?.dataset.kind;
    const id = target?.dataset.id;
    if (kind && id) {
      const bedInteractive = kind === "bed" && state.mode === "layout";
      const plantInteractive = kind === "plant" && state.mode === "plants";
      if (!yearIsReadOnly() && (bedInteractive || plantInteractive)) {
        state.selected = { type: kind, id };
        const item = findItem(kind, id);
        interaction = { type: kind, id, startX: event.clientX, startY: event.clientY, originalX: item.x, originalY: item.y, moved: false, node: target };
      } else if (kind === "bed" && state.mode !== "layout") {
        interaction = { type: "pan", startX: event.clientX, startY: event.clientY, originalX: state.map.panX, originalY: state.map.panY, moved: false };
        viewport.classList.add("dragging");
      } else {
        interaction = { type: "pan", startX: event.clientX, startY: event.clientY, originalX: state.map.panX, originalY: state.map.panY, moved: false, selectTarget: { type: kind, id } };
        viewport.classList.add("dragging");
      }
      return;
    }
    interaction = { type: "pan", startX: event.clientX, startY: event.clientY, originalX: state.map.panX, originalY: state.map.panY, moved: false };
    viewport.classList.add("dragging");
  };
  viewport.onpointermove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (pointers.size >= 2) return;
    if (!interaction) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (Math.hypot(dx,dy) > 3) interaction.moved = true;
    if (interaction.type === "pan") {
      state.map.panX = interaction.originalX + dx;
      state.map.panY = interaction.originalY + dy;
      apply();
      return;
    }
    if (interaction.type.startsWith("resize-")) {
      const kind = interaction.type === "resize-bed" ? "bed" : "plant";
      const grid = state.data.settings.gridIn;
      const minSize = kind === "bed" ? Math.max(12, grid) : grid;
      const maxW = state.data.settings.widthIn;
      const maxH = state.data.settings.heightIn;
      const inchDx = dx / state.map.zoom / PX_PER_INCH;
      const inchDy = dy / state.map.zoom / PX_PER_INCH;
      let x = interaction.originalX, y = interaction.originalY, w = interaction.originalW, h = interaction.originalH;
      if (interaction.corner.includes("w")) {
        const nx = clamp(snap(interaction.originalX + inchDx), 0, interaction.originalX + interaction.originalW - minSize);
        w = interaction.originalW - (nx - interaction.originalX);
        x = nx;
      }
      if (interaction.corner.includes("e")) {
        w = clamp(snap(interaction.originalW + inchDx), minSize, maxW - interaction.originalX);
      }
      if (interaction.corner.includes("n")) {
        const ny = clamp(snap(interaction.originalY + inchDy), 0, interaction.originalY + interaction.originalH - minSize);
        h = interaction.originalH - (ny - interaction.originalY);
        y = ny;
      }
      if (interaction.corner.includes("s")) {
        h = clamp(snap(interaction.originalH + inchDy), minSize, maxH - interaction.originalY);
      }
      interaction.nextX = x; interaction.nextY = y; interaction.nextW = w; interaction.nextH = h;
      interaction.node.style.left = `${x * PX_PER_INCH}px`;
      interaction.node.style.top = `${y * PX_PER_INCH}px`;
      interaction.node.style.width = `${w * PX_PER_INCH}px`;
      interaction.node.style.height = `${h * PX_PER_INCH}px`;
      return;
    }
    const item = findItem(interaction.type, interaction.id);
    const parent = state.data.settings;
    const maxX = parent.widthIn - item.widthIn;
    const maxY = parent.heightIn - item.heightIn;
    const x = clamp(snap(interaction.originalX + dx / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxX));
    const y = clamp(snap(interaction.originalY + dy / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxY));
    interaction.nextX = x; interaction.nextY = y;
    interaction.node.style.left = `${x * PX_PER_INCH}px`;
    interaction.node.style.top = `${y * PX_PER_INCH}px`;
  };
  viewport.onpointerup = async (event) => {
    pointers.delete(event.pointerId);
    viewport.classList.remove("dragging");
    if (interaction && interaction.type.startsWith("resize-") && interaction.moved) {
      const kind = interaction.type === "resize-bed" ? "bed" : "plant";
      const item = findItem(kind, interaction.id);
      const patch = { ...item, x: interaction.nextX ?? item.x, y: interaction.nextY ?? item.y, widthIn: interaction.nextW ?? item.widthIn, heightIn: interaction.nextH ?? item.heightIn };
      try {
        if (kind === "bed") await window.SproutStore.saveBed(patch);
        else await window.SproutStore.savePlant(patch);
      } catch (error) { toast(error.message || "Could not resize that.", "error"); render(); }
    } else if (interaction && (interaction.type === "bed" || interaction.type === "plant")) {
      if (interaction.moved) {
        const item = findItem(interaction.type, interaction.id);
        try {
          if (interaction.type === "bed") await window.SproutStore.saveBed({ ...item, x: interaction.nextX ?? item.x, y: interaction.nextY ?? item.y });
          else await window.SproutStore.savePlant({ ...item, x: interaction.nextX ?? item.x, y: interaction.nextY ?? item.y });
        } catch (error) { toast(error.message || "Could not save that position.", "error"); render(); }
      } else {
        render();
      }
    } else if (interaction?.type.startsWith("resize-") && !interaction.moved) {
      render();
    } else if (interaction?.type === "pan" && !interaction.moved) {
      state.selected = interaction.selectTarget || null; render();
    }
    interaction = null;
  };
  viewport.onpointercancel = viewport.onpointerup;
}

async function resizePhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
      image.src = url;
    });
  }
  const max = SPROUT_CONFIG.photoMaxDimension;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let quality = .88;
  let blob;
  do {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("This image could not be compressed.");
    quality -= .08;
  } while (blob.size > SPROUT_CONFIG.photoMaxBytes && quality >= .52);
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

async function uploadPhoto(file, plantId) {
  if (SPROUT_CONFIG.cloudinaryWorkerUrl.startsWith("PASTE_")) throw new Error("Add the Cloudflare Worker URL to config.js before uploading photos.");
  const resized = await resizePhoto(file);
  const folder = `${SPROUT_CONFIG.cloudinaryFolder}/${SPROUT_CONFIG.householdId}/${plantId}`;
  const idToken = await window.SproutStore.getIdToken();
  if (!idToken) throw new Error("Sign in again before uploading photos.");
  const signing = await fetch(SPROUT_CONFIG.cloudinaryWorkerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action: "sign", folder }),
  });
  if (!signing.ok) throw new Error("Photo signing failed.");
  const signed = await signing.json();
  const form = new FormData();
  form.set("file", resized);
  form.set("api_key", signed.apiKey);
  form.set("timestamp", String(signed.timestamp));
  form.set("folder", signed.folder);
  form.set("signature", signed.signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`, { method: "POST", body: form });
  if (!response.ok) throw new Error("Photo upload failed.");
  const result = await response.json();
  return { url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height, bytes: result.bytes, createdAt: Date.now() };
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action],[data-field-choice],[data-rating-choice]");
  if (!button) return;
  if (button.dataset.fieldChoice) { event.preventDefault(); applyFieldChoice(button); return; }
  if (button.dataset.ratingChoice !== undefined) { event.preventDefault(); applyRatingChoice(button); return; }
  const action = button.dataset.action;
  try {
    if (action === "sign-in") await window.SproutStore.signIn();
    if (action === "sign-out") await window.SproutStore.signOut();
    if (action === "tab") { state.tab = button.dataset.tab; state.selected = null; state.modal = null; render(); }
    if (action === "seed-category") { state.seedCategory = button.dataset.category; render(); }
    if (action === "year-subtab") { state.yearSubTab = button.dataset.subtab; render(); }
    if (action === "mode") { state.mode = button.dataset.mode; state.selected = null; render(); }
    if (action === "add-bed") openModal({ type: "bed" });
    if (action === "edit-bed") openModal({ type: "bed", id: button.dataset.id });
    if (action === "add-plant") { if (!state.data.seeds.length) throw new Error("Add a seed first."); openModal({ type: "plant" }); }
    if (action === "edit-plant") openModal({ type: "plant", id: button.dataset.id });
    if (action === "plant-details") openModal({ type: "details", id: button.dataset.id });
    if (action === "add-log") openModal({ type: "log", id: button.dataset.id });
    if (action === "add-seed") openModal({ type: "seed" });
    if (action === "edit-seed") openModal({ type: "seed", id: button.dataset.id });
    if (action === "seed-details") openModal({ type: "seedDetails", id: button.dataset.id });
    if (action === "category-dates") openModal({ type: "categoryDates" });
    if (action === "log-monthly-update") openModal({ type: "monthlyUpdate", year: state.year, month: defaultMonthlyMonth(state.year) });
    if (action === "edit-monthly-update") { const entry = state.data.yearUpdates.find((item) => item.id === button.dataset.id); openModal({ type: "monthlyUpdate", year: entry.year, month: entry.month }); }
    if (action === "open-monthly-banner") { state.year = Number(button.dataset.year); state.tab = "year"; state.yearSubTab = "updates"; openModal({ type: "monthlyUpdate", year: Number(button.dataset.year), month: Number(button.dataset.month) }); }
    if (action === "fetch-weather") {
      button.disabled = true;
      button.textContent = "Fetching…";
      await fetchWeatherHistory();
      render();
      toast("Weather history updated.");
    }
    if (action === "close-modal" || (action === "modal-backdrop" && event.target === button)) closeModal();
    if (action === "clear-selection") { state.selected = null; render(); }
    if (action === "zoom-in") $(".map-viewport")?._gardenZoom(1.2);
    if (action === "zoom-out") $(".map-viewport")?._gardenZoom(.83);
    if (action === "fit-map") $(".map-viewport")?._gardenFit();
    if (action === "duplicate-year") openModal({ type: "duplicate" });
    if (action === "view-year") { state.year = Number(button.dataset.year); state.tab = "garden"; state.map.initializedYear = null; render(); }
    if (action === "save-bed") {
      const form = $("#bed-form");
      if (!form) throw new Error("The bed editor could not be found. Close it and try again.");
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Check the highlighted bed measurements and try again.");
      }
      button.disabled = true;
      button.textContent = "Saving…";
      await saveBed(form);
    }
    if (action === "save-plant") {
      const form = $("#plant-form");
      if (!form) throw new Error("The plant editor could not be found. Close it and try again.");
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Complete the highlighted plant fields and try again.");
      }
      button.disabled = true;
      button.textContent = "Saving…";
      await savePlant(form);
    }
    if (action === "save-log") {
      const form = $("#log-form");
      if (!form) throw new Error("The journal editor could not be found. Close it and try again.");
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Complete the highlighted journal fields and try again.");
      }
      button.disabled = true;
      button.textContent = "Saving…";
      await saveLog(form);
    }
    if (action === "save-seed") {
      const form = $("#seed-form");
      if (!form) throw new Error("The seed editor could not be found. Close it and try again.");
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Complete the highlighted seed fields and try again.");
      }
      button.disabled = true;
      button.textContent = "Saving…";
      await saveSeed(form);
    }
    if (action === "save-category-dates") {
      const form = $("#category-dates-form");
      if (!form) throw new Error("The category date editor could not be found. Close it and try again.");
      button.disabled = true;
      button.textContent = "Saving…";
      await saveCategoryDates(form);
    }
    if (action === "save-monthly-update") {
      const form = $("#monthly-update-form");
      if (!form) throw new Error("The monthly update editor could not be found. Close it and try again.");
      button.disabled = true;
      button.textContent = "Saving…";
      await saveMonthlyUpdate(form);
    }
    if (action === "save-duplicate") {
      const form = $("#duplicate-form");
      if (!form) throw new Error("The year editor could not be found. Close it and try again.");
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Choose a valid year and try again.");
      }
      button.disabled = true;
      button.textContent = "Duplicating…";
      await duplicateYear(form);
    }
    if (action === "delete-bed") { const bed = state.data.beds.find((item) => item.id === state.modal.id); state.modal = { type: "confirm", title: `Delete Bed ${bed.number}?`, message: "This removes the bed from the grid. It is purely visual and does not affect any plants.", confirmLabel: "Delete bed", run: async () => { await window.SproutStore.deleteBed(bed); state.selected = null; } }; render(); }
    if (action === "delete-seed") { const seed = state.data.seeds.find((item) => item.id === button.dataset.id); state.modal = { type: "confirm", title: `Delete ${seed.commonName}?`, message: "This removes the seed. Plants already using it will keep their history but lose their seed details.", confirmLabel: "Delete seed", run: async () => { await window.SproutStore.deleteSeed(seed); state.selected = null; } }; render(); }
    if (action === "archive-plant") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); await window.SproutStore.archivePlant(plant, !plant.archived); state.modal = null; state.selected = null; render(); toast(plant.archived ? "Plant restored." : "Plant moved to the archive."); }
    if (action === "delete-log") { const log = state.data.logs.find((item) => item.id === button.dataset.id); if (confirm("Delete this journal entry?")) { await window.SproutStore.deleteLog(log); render(); } }
    if (action === "delete-photo") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); if (confirm("Remove this photo from the plant?")) { await window.SproutStore.savePlant({ ...plant, photos: plant.photos.filter((_, index) => index !== Number(button.dataset.index)) }); render(); } }
    if (action === "delete-year-update") { const entry = state.data.yearUpdates.find((item) => item.id === button.dataset.id); if (confirm("Delete this update?")) { await window.SproutStore.deleteYearUpdate(entry); render(); } }
    if (action === "undo-activity") { const entry = state.data.activity.find((item) => item.id === button.dataset.id); await window.SproutStore.undoLast(entry); toast("Last action undone."); }
    if (action === "confirm-action") { const run = state.modal.run; await run(); state.modal = null; render(); }
    if (action === "export") exportBackup();
    if (action === "import") importBackup();
  } catch (error) {
    toast(error?.message || "Sprout couldn’t save that change.", "error");
    button.disabled = false;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches('[data-action="change-year"]')) { state.year = Number(event.target.value); state.selected = null; state.map.initializedYear = null; if (yearIsReadOnly()) state.mode = "browse"; render(); }
  if (event.target.id === "monthly-update-month") { state.modal.month = Number(event.target.value); render(); }
  if (event.target.matches("[data-photo-plant]")) {
    const plant = state.data.plants.find((item) => item.id === event.target.dataset.photoPlant);
    const file = event.target.files?.[0];
    if (!file) return;
    try { toast("Preparing photo…"); const photo = await uploadPhoto(file, plant.id); await window.SproutStore.savePlant({ ...plant, photos: [...(plant.photos || []), photo] }); render(); toast("Photo added."); } catch (error) { toast(error.message || "Photo upload failed.", "error"); }
  }
  if (event.target.matches("[data-year-cover]")) {
    const year = event.target.dataset.yearCover;
    const file = event.target.files?.[0];
    if (!file) return;
    try { toast("Preparing photo…"); const photo = await uploadPhoto(file, `year-${year}`); await window.SproutStore.saveYearCover(year, photo); render(); toast("Cover photo updated."); } catch (error) { toast(error.message || "Photo upload failed.", "error"); }
  }
  if (event.target.matches('[data-cat-field="startIndoors"]')) {
    const field = $(`[data-indoors-date="${event.target.dataset.category}"]`);
    field?.classList.toggle("hidden", !event.target.checked);
  }
  if (event.target.matches('select[data-cat-field$="-month"]')) {
    const category = event.target.dataset.category;
    const fieldName = event.target.dataset.catField.replace(/-month$/, "");
    const daySelect = $(`[data-cat-field="${fieldName}-day"][data-category="${category}"]`);
    if (daySelect) {
      const month = Number(event.target.value);
      const max = DAYS_IN_MONTH[month - 1];
      const current = Math.min(Number(daySelect.value) || 1, max);
      daySelect.innerHTML = [...Array(max)].map((_, i) => i + 1).map((d) => `<option value="${d}" ${d === current ? "selected" : ""}>${d}</option>`).join("");
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "plant-search") { state.search = event.target.value; const position = event.target.selectionStart; render(); requestAnimationFrame(() => { const input = $("#plant-search"); input?.focus(); input?.setSelectionRange(position, position); }); }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const modalSaves = {
    "bed-form": { pending: "Saving…", run: saveBed },
    "plant-form": { pending: "Saving…", run: savePlant },
    "seed-form": { pending: "Saving…", run: saveSeed },
    "log-form": { pending: "Saving…", run: saveLog },
    "duplicate-form": { pending: "Duplicating…", run: duplicateYear },
    "year-update-form": { pending: "Adding…", run: saveYearUpdate },
  };

  if (modalSaves[form.id]) {
    const submitButton = document.querySelector(`[type="submit"][form="${form.id}"]`);
    const originalText = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = modalSaves[form.id].pending;
    }
    try {
      await modalSaves[form.id].run(form);
    } catch (error) {
      toast(error?.message || "Sprout couldn’t save that change.", "error");
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
    return;
  }

  if (form.id !== "garden-settings") return;
  try {
    const values = new FormData(form);
    const widthIn = snap(toInches(values.get("garden-width-ft"), values.get("garden-width-in")));
    const heightIn = snap(toInches(values.get("garden-height-ft"), values.get("garden-height-in")));
    if (widthIn < 120 || heightIn < 120) throw new Error("The garden must be at least 10 feet in each direction.");
    await window.SproutStore.saveSettings({ widthIn, heightIn, gridIn: 6 });
    state.map.initializedYear = null; render(); toast("Garden size saved.");
  } catch (error) { toast(error.message || "Could not save garden size.", "error"); }
});

function copySelected() {
  if (state.tab !== "garden" || state.modal || yearIsReadOnly()) return;
  if (state.mode === "layout" && state.selected?.type === "bed") {
    const bed = state.data.beds.find((item) => item.id === state.selected.id);
    if (bed) { state.clipboard = { type: "bed", data: bed }; toast(`Bed ${bed.number} copied.`); }
  } else if (state.mode === "plants" && state.selected?.type === "plant") {
    const plant = state.data.plants.find((item) => item.id === state.selected.id);
    if (plant) { state.clipboard = { type: "plant", data: plant }; toast("Plant copied."); }
  }
}

async function pasteClipboard() {
  if (state.tab !== "garden" || state.modal || yearIsReadOnly() || !state.clipboard) return;
  const grid = state.data.settings.gridIn;
  const source = state.clipboard.data;
  const x = clamp(snap(source.x + grid * 2), 0, Math.max(0, state.data.settings.widthIn - source.widthIn));
  const y = clamp(snap(source.y + grid * 2), 0, Math.max(0, state.data.settings.heightIn - source.heightIn));
  if (state.clipboard.type === "bed" && state.mode === "layout") {
    const used = new Set(bedsForYear().map((item) => item.number));
    let number = Number(source.number) + 1;
    while (used.has(number) && number <= 10) number++;
    if (number > 10 || bedsForYear().length >= 10) { toast("No bed numbers available.", "error"); return; }
    const saved = await window.SproutStore.saveBed({ year: state.year, number, widthIn: source.widthIn, heightIn: source.heightIn, rotation: source.rotation, notes: source.notes, x, y });
    state.selected = { type: "bed", id: saved.id };
    render();
    toast(`Bed ${number} pasted.`);
  } else if (state.clipboard.type === "plant" && state.mode === "plants") {
    const saved = await window.SproutStore.savePlant({ year: state.year, seedId: source.seedId, widthIn: source.widthIn, heightIn: source.heightIn, status: source.status, notes: source.notes, x, y });
    state.selected = { type: "plant", id: saved.id };
    render();
    toast("Plant pasted.");
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) { closeModal(); return; }
  if (!(event.metaKey || event.ctrlKey)) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const key = event.key.toLowerCase();
  if (key === "c") { event.preventDefault(); copySelected(); }
  if (key === "v") {
    event.preventDefault();
    pasteClipboard().catch((error) => toast(error?.message || "Could not paste.", "error"));
  }
});

function exportBackup() {
  const payload = { app: "Sprout", exportedAt: new Date().toISOString(), ...state.data };
  delete payload.fromCache;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `sprout-backup-${new Date().toISOString().slice(0,10)}.json`; link.click();
  URL.revokeObjectURL(url);
}

function importBackup() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.onchange = async () => {
    try {
      const payload = JSON.parse(await input.files[0].text());
      if (payload.app !== "Sprout") throw new Error("That is not a Sprout backup.");
      if (!confirm("Merge this backup into Sprout? Existing records with matching IDs will be updated.")) return;
      await window.SproutStore.importBackup(payload); toast("Backup imported.");
    } catch (error) { toast(error.message || "Could not import that backup.", "error"); }
  };
  input.click();
}

window.addEventListener("sprout:auth", (event) => { state.user = event.detail; render(); if (state.user) { ensureInitialYear(); ensureWeatherFresh(); } });
window.addEventListener("sprout:data", (event) => { state.data = event.detail; if (!state.year) state.year = Number(state.data.settings.activeYear || CURRENT_YEAR); render(); if (state.user) { ensureInitialYear(); ensureWeatherFresh(); } });
window.addEventListener("sprout:error", (event) => toast(event.detail, "error"));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
render();
if (state.user) { ensureInitialYear(); ensureWeatherFresh(); }
