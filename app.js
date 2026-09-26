import "./firebase-client.js";
import { SPROUT_CONFIG } from "./config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = $("#app");
const CURRENT_YEAR = new Date().getFullYear();
const PX_PER_INCH = 4;
const PLANT_CATEGORIES = [
  { id: "tomatoes", label: "Tomatoes", icon: "🍅" },
  { id: "carrots", label: "Carrots", icon: "🥕" },
  { id: "chiles", label: "Chiles", icon: "🌶️" },
  { id: "cucumbers", label: "Cucumbers", icon: "🥒" },
  { id: "beans", label: "Beans", icon: "🫘" },
  { id: "potatoes", label: "Potatoes", icon: "🥔" },
  { id: "berries", label: "Berries", icon: "🍓" },
  { id: "alliums", label: "Alliums", icon: "🧅" },
  { id: "greens", label: "Greens", icon: "🥬" },
];
const COLORS = ["#4f8d5b", "#75a843", "#a7b43c", "#d8a62d", "#df7435", "#c94c49", "#a95a87", "#735ca7", "#3f83a8", "#3b8c83"];
const STATUSES = ["planned", "seeded", "planted", "growing", "harvesting", "finished", "failed", "removed"];
const LOG_TYPES = ["note", "watered", "fertilised", "pruned", "transplanted", "pest or disease", "treatment", "harvested", "status change"];

const state = {
  user: window.SproutCurrentUser || null,
  data: window.SproutData || window.SproutStore.getData(),
  tab: "garden",
  year: null,
  plantFilter: "active",
  plantCategory: "all",
  search: "",
  modal: null,
  selected: null,
  mode: "browse",
  busy: false,
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
const bedFor = (plant) => state.data.beds.find((bed) => bed.id === plant.bedId);
const varietyFor = (name) => state.data.varieties.find((item) => item.normalizedName === String(name || "").trim().toLowerCase());
const categoryById = (id) => PLANT_CATEGORIES.find((category) => category.id === id);
const categoryForPlant = (plant = {}) => {
  if (categoryById(plant.category)) return plant.category;
  if (plant.icon === "🫑" || plant.icon === "🌶️") return "chiles";
  return PLANT_CATEGORIES.find((category) => category.icon === plant.icon)?.id || "greens";
};
const iconForPlant = (plant) => categoryById(categoryForPlant(plant))?.icon || "🥬";

function icon(name) {
  const paths = {
    garden: '<path d="M4 19V9m5 10V5m6 14V8m5 11V4M2 19h20M3 12h18M6 6c-2-3 1-5 3-3 0 2-1 3-3 3Zm7 5c-2-3 1-5 3-3 0 2-1 3-3 3Z"/>',
    plants: '<path d="M12 22V9m0 4c-5 0-8-3-8-8 5 0 8 3 8 8Zm0 4c5 0 8-3 8-8-5 0-8 3-8 8Z"/>',
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
        <div class="sync-state"><span class="sync-dot"></span><span>${state.data.fromCache ? "Connecting…" : "Up to date"}</span></div>
      </header>
      <main class="main">${renderPage()}</main>
      <nav class="bottom-nav" aria-label="Main navigation">
        ${navButton("garden", "Garden", "garden")}
        ${navButton("plants", "Plants", "plants")}
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
  if (state.tab === "plants") return renderPlants();
  if (state.tab === "activity") return renderActivity();
  return renderSettings();
}

function renderGarden() {
  const settings = state.data.settings;
  const beds = bedsForYear();
  const plants = plantsForYear().filter((plant) => !plant.archived);
  const readOnly = yearIsReadOnly();
  const selectedPlant = state.selected?.type === "plant" ? state.data.plants.find((item) => item.id === state.selected.id) : null;
  const selectedBed = state.selected?.type === "bed" ? state.data.beds.find((item) => item.id === state.selected.id) : null;
  return `<section class="tab-page garden-page">
    <div class="garden-tools">
      <div class="segmented" aria-label="Garden interaction mode">
        <button data-action="mode" data-mode="browse" class="${state.mode === "browse" ? "active" : ""}">Browse</button>
        <button data-action="mode" data-mode="layout" class="${state.mode === "layout" ? "active" : ""}" ${readOnly ? "disabled" : ""}>Beds</button>
        <button data-action="mode" data-mode="plants" class="${state.mode === "plants" ? "active" : ""}" ${readOnly ? "disabled" : ""}>Plants</button>
      </div>
      <span class="tool-divider"></span>
      <button class="tool-button" data-action="add-bed" ${readOnly || beds.length >= 10 ? "disabled" : ""}>${icon("plus")}<span>Add bed</span></button>
      <button class="tool-button primary" data-action="add-plant" ${readOnly || !beds.length ? "disabled" : ""}>${icon("plus")}<span>Add plant</span></button>
      ${readOnly ? `<button class="tool-button" data-action="duplicate-year">${icon("duplicate")}<span>Duplicate year</span></button>` : ""}
      <div class="zoom-group">
        <button class="icon-button" data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button>
        <button class="icon-button" data-action="fit-map" aria-label="Fit garden">${icon("fit")}</button>
        <button class="icon-button" data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button>
      </div>
    </div>
    <div class="map-viewport" aria-label="Garden plan">
      <div class="garden-world ${readOnly ? "readonly" : ""}" style="width:${settings.widthIn * PX_PER_INCH}px;height:${settings.heightIn * PX_PER_INCH}px;background-size:${settings.gridIn * PX_PER_INCH}px ${settings.gridIn * PX_PER_INCH}px">
        ${beds.map((bed) => renderBed(bed, plants.filter((plant) => plant.bedId === bed.id))).join("")}
      </div>
      ${!beds.length ? `<div class="map-empty"><h2>${readOnly ? "No beds in this snapshot" : "Start with a planter box"}</h2><p>${readOnly ? "This year does not contain a saved layout." : "Add a numbered bed, then place individual plants inside it."}</p>${readOnly ? "" : '<button class="primary-button" data-action="add-bed">Add first bed</button>'}</div>` : ""}
      ${selectedPlant ? renderSelectionPlant(selectedPlant) : selectedBed ? renderSelectionBed(selectedBed) : ""}
    </div>
  </section>`;
}

function renderBed(bed, plants) {
  const width = bed.widthIn * PX_PER_INCH;
  const height = bed.heightIn * PX_PER_INCH;
  const rotation = Number(bed.rotation || 0);
  const quarterTurn = Math.abs(rotation % 180) === 90;
  const visualLeft = quarterTurn ? (width - height) / 2 : 0;
  const visualTop = quarterTurn ? (height - width) / 2 : 0;
  return `<div class="bed-wrap" data-kind="bed" data-id="${bed.id}" style="left:${bed.x * PX_PER_INCH}px;top:${bed.y * PX_PER_INCH}px;width:${width}px;height:${height}px">
    <div class="bed ${state.selected?.type === "bed" && state.selected.id === bed.id ? "selected" : ""}" style="transform:rotate(${rotation}deg)">
      ${plants.map((plant) => `<div class="plant-marker ${state.selected?.type === "plant" && state.selected.id === plant.id ? "selected" : ""}" data-kind="plant" data-id="${plant.id}" style="--plant-color:${esc(plant.color)};left:${plant.x * PX_PER_INCH}px;top:${plant.y * PX_PER_INCH}px;width:${plant.widthIn * PX_PER_INCH}px;height:${plant.heightIn * PX_PER_INCH}px"><span class="plant-icon">${esc(iconForPlant(plant))}</span><span class="plant-label">${esc(plant.commonName)}</span></div>`).join("")}
    </div>
    <span class="bed-number" style="left:${visualLeft}px;top:${visualTop}px">[${bed.number}]</span>
  </div>`;
}

function renderSelectionPlant(plant) {
  const bed = bedFor(plant);
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon" style="--plant-color:${esc(plant.color)}">${esc(iconForPlant(plant))}</div><div class="selection-copy"><h3>${esc(plant.commonName)}</h3><p>Bed ${bed?.number || "—"} · ${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div><div class="selection-actions"><button class="secondary-button" data-action="plant-details" data-id="${plant.id}">Details</button>${yearIsReadOnly() ? "" : `<button class="primary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button>`}</div></aside>`;
}

function renderSelectionBed(bed) {
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon">${bed.number}</div><div class="selection-copy"><h3>Bed ${bed.number}</h3><p>${dimensions(bed.widthIn)} × ${dimensions(bed.heightIn)}${bed.notes ? ` · ${esc(bed.notes)}` : ""}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div>${yearIsReadOnly() ? "" : `<div class="selection-actions"><button class="primary-button" data-action="edit-bed" data-id="${bed.id}">Edit bed</button></div>`}</aside>`;
}

function renderPlants() {
  const query = state.search.trim().toLowerCase();
  const plants = plantsForYear()
    .filter((plant) => state.plantFilter === "all" || (state.plantFilter === "archived" ? plant.archived : !plant.archived))
    .filter((plant) => state.plantCategory === "all" || categoryForPlant(plant) === state.plantCategory)
    .filter((plant) => !query || plant.commonName.toLowerCase().includes(query) || plant.notes?.toLowerCase().includes(query))
    .sort((a, b) => a.commonName.localeCompare(b.commonName) || (bedFor(a)?.number || 99) - (bedFor(b)?.number || 99));
  return `<section class="tab-page content-page"><div class="page-heading"><div><h1>Plants</h1><p>${state.year} · ${plants.length} shown</p></div><div class="page-actions">${yearIsReadOnly() ? "" : '<button class="primary-button" data-action="add-plant">Add plant</button>'}</div></div>
    <div class="search-row"><label class="search-wrap">${icon("search")}<input id="plant-search" type="search" placeholder="Search plants" value="${esc(state.search)}"></label><select class="filter-select" id="plant-filter"><option value="active" ${state.plantFilter === "active" ? "selected" : ""}>Active</option><option value="archived" ${state.plantFilter === "archived" ? "selected" : ""}>Archived</option><option value="all" ${state.plantFilter === "all" ? "selected" : ""}>All</option></select></div>
    <div class="plant-category-tabs" role="tablist" aria-label="Plant categories"><button role="tab" aria-selected="${state.plantCategory === "all"}" class="${state.plantCategory === "all" ? "active" : ""}" data-action="plant-category" data-category="all">All</button>${PLANT_CATEGORIES.map((category) => `<button role="tab" aria-selected="${state.plantCategory === category.id}" class="${state.plantCategory === category.id ? "active" : ""}" data-action="plant-category" data-category="${category.id}"><span>${category.icon}</span>${category.label}</button>`).join("")}</div>
    <div class="plant-list">${plants.length ? plants.map((plant) => { const bed = bedFor(plant); return `<button class="plant-row" data-action="plant-details" data-id="${plant.id}" style="--plant-color:${esc(plant.color)}"><span class="plant-avatar">${esc(iconForPlant(plant))}</span><span class="plant-main"><h3>${esc(plant.commonName)}</h3><p>Bed ${bed?.number || "—"} · ${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}${plant.plantedDate ? ` · ${shortDate(plant.plantedDate)}` : ""}</p></span><span class="status-pill ${esc(plant.status)}">${esc(plant.status)}</span></button>`; }).join("") : '<div class="empty-state">No plants match this view.</div>'}</div>
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
  const initial = plant || state.modal.seed || {};
  const bed = state.data.beds.find((item) => item.id === initial.bedId) || bedsForYear()[0];
  const sizeW = splitInches(initial.widthIn || 12);
  const sizeH = splitInches(initial.heightIn || 12);
  const commonName = initial.commonName || "";
  const selectedCategory = initial.category || initial.icon ? categoryForPlant(initial) : PLANT_CATEGORIES[0].id;
  const selectedIcon = categoryById(selectedCategory).icon;
  const selectedColor = initial.color || COLORS[0];
  const sun = initial.sun || "medium";
  const water = initial.water || "medium";
  const body = `<form id="plant-form" class="form-grid"><input type="hidden" name="id" value="${plant?.id || ""}"><label class="field full"><span>Common name</span><input id="plant-name" name="commonName" value="${esc(commonName)}" list="plant-varieties" maxlength="80" autocomplete="off" required><datalist id="plant-varieties">${state.data.varieties.sort((a,b)=>a.commonName.localeCompare(b.commonName)).map((item) => `<option value="${esc(item.commonName)}"></option>`).join("")}</datalist></label><label class="field full"><span>Planter box</span><select name="bedId" required>${bedsForYear().map((item) => `<option value="${item.id}" ${item.id === bed?.id ? "selected" : ""}>Bed ${item.number}</option>`).join("")}</select></label><label class="field"><span>Plant width</span>${dimensionInputs("plant-width", sizeW)}</label><label class="field"><span>Plant length</span>${dimensionInputs("plant-height", sizeH)}</label><label class="field full"><span>Category</span><div class="choice-row plant-category-choices">${PLANT_CATEGORIES.map((category) => `<button type="button" class="choice plant-category-choice ${category.id === selectedCategory ? "selected" : ""}" data-field-choice="category" data-value="${category.id}" data-icon="${category.icon}"><span>${category.icon}</span><small>${category.label}</small></button>`).join("")}</div><input type="hidden" name="category" value="${selectedCategory}"><input type="hidden" name="icon" value="${esc(selectedIcon)}"></label><label class="field full"><span>Colour</span><div class="choice-row">${COLORS.map((item) => `<button type="button" class="color-choice ${item === selectedColor ? "selected" : ""}" style="--choice-color:${item}" data-field-choice="color" data-value="${item}" aria-label="${item}"></button>`).join("")}</div><input type="hidden" name="color" value="${selectedColor}"></label>${levelSelector("sun", "Sun", sun, "☁️", "⛅", "☀️")}${levelSelector("water", "Water", water, "💧", "💧💧", "💧💧💧")}<label class="field"><span>Status</span><select name="status">${STATUSES.map((status) => `<option value="${status}" ${status === (initial.status || "planned") ? "selected" : ""}>${title(status)}</option>`).join("")}</select></label><label class="field"><span>Planting date</span><input name="plantedDate" type="date" value="${esc(initial.plantedDate || "")}"></label><label class="field full"><span>Notes</span><textarea name="notes" maxlength="3000" placeholder="Care details, source, or anything useful…">${esc(initial.notes || "")}</textarea></label></form>`;
  const archive = plant ? `<button class="${plant.archived ? "secondary-button" : "danger-button"}" data-action="archive-plant" data-id="${plant.id}">${plant.archived ? "Restore" : "Archive"}</button>` : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(plant ? `Edit ${plant.commonName}` : "Add a Plant", body, `${archive}<button class="primary-button" type="button" data-action="save-plant">Save</button>`, true);
}

function levelSelector(name, label, selected, lowIcon, mediumIcon, highIcon) {
  return `<label class="field full"><span>${label}</span><div class="choice-row">${[["low",lowIcon],["medium",mediumIcon],["high",highIcon]].map(([value, symbol]) => `<button type="button" class="choice ${value === selected ? "selected" : ""}" data-field-choice="${name}" data-value="${value}">${symbol} ${title(value)}</button>`).join("")}</div><input type="hidden" name="${name}" value="${selected}"></label>`;
}

function renderPlantDetails(plant) {
  if (!plant) return "";
  const bed = bedFor(plant);
  const logs = state.data.logs.filter((entry) => entry.plantId === plant.id).sort((a, b) => b.createdAt - a.createdAt);
  const body = `<div class="detail-hero"><div class="detail-icon" style="--plant-color:${esc(plant.color)}">${esc(iconForPlant(plant))}</div><div class="detail-title"><h2>${esc(plant.commonName)}</h2><p>Bed ${bed?.number || "—"} · ${title(plant.status)}</p></div>${yearIsReadOnly() ? "" : `<div class="detail-actions"><button class="secondary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button></div>`}</div><div class="fact-grid"><div class="fact"><span>Size</span><strong>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</strong></div><div class="fact"><span>Planted</span><strong>${shortDate(plant.plantedDate)}</strong></div><div class="fact"><span>Sun</span><strong>${plant.sun === "low" ? "☁️" : plant.sun === "high" ? "☀️" : "⛅"} ${plant.sun}</strong></div><div class="fact"><span>Water</span><strong>${plant.water === "low" ? "💧" : plant.water === "high" ? "💧💧💧" : "💧💧"} ${plant.water}</strong></div></div>${plant.notes ? `<div class="section-head"><h3>Notes</h3></div><div class="notes-box">${esc(plant.notes)}</div>` : ""}<div class="section-head"><h3>Photos</h3>${yearIsReadOnly() ? "" : `<label class="text-button">Add photo<input class="hidden" type="file" accept="image/*" data-photo-plant="${plant.id}"></label>`}</div><div class="photo-grid">${(plant.photos || []).map((photo, index) => `<div class="photo"><img src="${esc(photo.url)}" alt="${esc(plant.commonName)} photo" loading="lazy">${yearIsReadOnly() ? "" : `<button class="photo-delete" data-action="delete-photo" data-id="${plant.id}" data-index="${index}" aria-label="Delete photo">×</button>`}</div>`).join("")}${!(plant.photos || []).length ? '<div class="form-note" style="grid-column:1/-1">No photos yet.</div>' : ""}</div><div class="section-head"><h3>Journal</h3>${yearIsReadOnly() ? "" : `<button class="text-button" data-action="add-log" data-id="${plant.id}">Add entry</button>`}</div><div class="journal-list">${logs.length ? logs.map((entry) => `<article class="journal-entry"><div class="journal-head"><span class="journal-type">${esc(entry.type)}</span><span class="journal-date">${dateText(entry.createdAt)}</span></div>${entry.note ? `<p>${esc(entry.note)}</p>` : ""}${entry.photos?.[0] ? `<img class="journal-photo" src="${esc(entry.photos[0].url)}" alt="Journal photo" loading="lazy">` : ""}<div class="journal-meta">${esc(entry.actorName || entry.actorEmail || "Someone")}${yearIsReadOnly() ? "" : ` · <button class="text-button" data-action="delete-log" data-id="${entry.id}">Delete</button>`}</div></article>`).join("") : '<div class="form-note">No journal entries yet.</div>'}</div>`;
  return modalShell(plant.commonName, body, "", true);
}

function renderLogModal(plant) {
  const body = `<form id="log-form" class="form-grid"><input type="hidden" name="plantId" value="${plant.id}"><label class="field full"><span>Entry type</span><select name="type">${LOG_TYPES.map((type) => `<option value="${type}">${title(type)}</option>`).join("")}</select></label><label class="field full"><span>Note</span><textarea name="note" maxlength="3000" placeholder="What happened?"></textarea></label><label class="field full"><span>Photo (optional)</span><input name="photo" type="file" accept="image/*"></label></form>`;
  return modalShell(`Add to ${plant.commonName}`, body, '<button class="secondary-button" data-action="plant-details" data-id="'+plant.id+'">Cancel</button><button class="primary-button" type="button" data-action="save-log">Save entry</button>');
}

function renderDuplicateModal() {
  const years = [...state.data.years].sort((a, b) => b.year - a.year);
  const source = Number(state.year || state.data.settings.activeYear);
  const target = Math.max(CURRENT_YEAR, ...years.map((item) => Number(item.year))) + 1;
  const body = `<form id="duplicate-form" class="form-grid"><label class="field"><span>Copy from</span><select name="sourceYear">${years.map((year) => `<option value="${year.year}" ${Number(year.year) === source ? "selected" : ""}>${year.year}</option>`).join("")}</select></label><label class="field"><span>New year</span><input name="targetYear" type="number" min="2020" max="2100" value="${target}" required></label><div class="form-note field full">Beds and active plant placements will be copied. Plants begin as Planned, with no planting date or photos. The original year remains unchanged.</div></form>`;
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

function firstBedPosition(widthIn, heightIn) {
  const grid = state.data.settings.gridIn;
  const index = bedsForYear().length;
  const x = snap(grid * 2 + (index % 3) * (widthIn + grid * 2));
  const y = snap(grid * 2 + Math.floor(index / 3) * (heightIn + grid * 2));
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
  const bed = state.data.beds.find((item) => item.id === values.get("bedId"));
  if (!bed) throw new Error("Choose a planter box.");
  const widthIn = snap(toInches(values.get("plant-width-ft"), values.get("plant-width-in")));
  const heightIn = snap(toInches(values.get("plant-height-ft"), values.get("plant-height-in")));
  if (widthIn < state.data.settings.gridIn || heightIn < state.data.settings.gridIn) throw new Error("Plant size must be at least one grid square.");
  if (widthIn > bed.widthIn || heightIn > bed.heightIn) throw new Error("This plant footprint is larger than its planter box.");
  const commonName = String(values.get("commonName") || "").trim();
  const category = categoryById(values.get("category"))?.id || "greens";
  const plantIcon = categoryById(category).icon;
  const variety = { commonName, category, icon: plantIcon, color: values.get("color"), sun: values.get("sun"), water: values.get("water") };
  const changingBed = existing && existing.bedId !== bed.id;
  const x = existing && !changingBed ? clamp(existing.x, 0, bed.widthIn - widthIn) : snap((bed.widthIn - widthIn) / 2);
  const y = existing && !changingBed ? clamp(existing.y, 0, bed.heightIn - heightIn) : snap((bed.heightIn - heightIn) / 2);
  const varietySaving = window.SproutStore.saveVariety(variety);
  const plantSaving = window.SproutStore.savePlant({ ...existing, id: existing?.id, year: state.year, bedId: bed.id, commonName, widthIn, heightIn, category, icon: plantIcon, color: values.get("color"), sun: values.get("sun"), water: values.get("water"), status: values.get("status"), plantedDate: values.get("plantedDate"), notes: values.get("notes"), x, y });
  state.modal = null;
  state.mode = "plants";
  render();
  const [, saved] = await Promise.all([varietySaving, plantSaving]);
  state.selected = { type: "plant", id: saved.id };
  render();
  toast(existing ? "Plant updated." : "Plant added. Drag it into place in Plants mode.");
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
  let pinch = null;
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  viewport.onwheel = (event) => { event.preventDefault(); viewport._gardenZoom(event.deltaY < 0 ? 1.12 : .89, event.clientX, event.clientY); };
  viewport.onpointerdown = (event) => {
    if (event.target.closest(".selection-card,button,input,select,textarea,label")) return;
    pointers.set(event.pointerId, point(event));
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a,b] = [...pointers.values()];
      pinch = { distance: distance(a,b), zoom: state.map.zoom, midpoint: midpoint(a,b), panX: state.map.panX, panY: state.map.panY };
      interaction = null;
      return;
    }
    const target = event.target.closest("[data-kind]");
    const kind = target?.dataset.kind;
    const id = target?.dataset.id;
    if (kind && id) {
      if (!yearIsReadOnly() && ((kind === "bed" && state.mode === "layout") || (kind === "plant" && state.mode === "plants"))) {
        state.selected = { type: kind, id };
        const item = kind === "bed" ? state.data.beds.find((entry) => entry.id === id) : state.data.plants.find((entry) => entry.id === id);
        interaction = { type: kind, id, startX: event.clientX, startY: event.clientY, originalX: item.x, originalY: item.y, moved: false, node: target };
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
    if (pointers.size >= 2 && pinch) {
      const [a,b] = [...pointers.values()];
      const mid = midpoint(a,b);
      const nextZoom = clamp(pinch.zoom * distance(a,b) / pinch.distance, .2, 4);
      const rect = viewport.getBoundingClientRect();
      const anchorX = pinch.midpoint.x - rect.left;
      const anchorY = pinch.midpoint.y - rect.top;
      const worldX = (anchorX - pinch.panX) / pinch.zoom;
      const worldY = (anchorY - pinch.panY) / pinch.zoom;
      state.map.zoom = nextZoom;
      state.map.panX = (mid.x - rect.left) - worldX * nextZoom;
      state.map.panY = (mid.y - rect.top) - worldY * nextZoom;
      apply();
      return;
    }
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
    const item = interaction.type === "bed" ? state.data.beds.find((entry) => entry.id === interaction.id) : state.data.plants.find((entry) => entry.id === interaction.id);
    const parent = interaction.type === "plant" ? bedFor(item) : state.data.settings;
    const maxX = (interaction.type === "plant" ? parent.widthIn : parent.widthIn) - item.widthIn;
    const maxY = (interaction.type === "plant" ? parent.heightIn : parent.heightIn) - item.heightIn;
    const x = clamp(snap(interaction.originalX + dx / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxX));
    const y = clamp(snap(interaction.originalY + dy / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxY));
    interaction.nextX = x; interaction.nextY = y;
    interaction.node.style.left = `${x * PX_PER_INCH}px`;
    interaction.node.style.top = `${y * PX_PER_INCH}px`;
  };
  viewport.onpointerup = async (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    viewport.classList.remove("dragging");
    if (interaction && interaction.type !== "pan" && interaction.moved) {
      const item = interaction.type === "bed" ? state.data.beds.find((entry) => entry.id === interaction.id) : state.data.plants.find((entry) => entry.id === interaction.id);
      try {
        if (interaction.type === "bed") await window.SproutStore.saveBed({ ...item, x: interaction.nextX ?? item.x, y: interaction.nextY ?? item.y });
        else await window.SproutStore.savePlant({ ...item, x: interaction.nextX ?? item.x, y: interaction.nextY ?? item.y });
      } catch (error) { toast(error.message || "Could not save that position.", "error"); render(); }
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
  const button = event.target.closest("[data-action],[data-field-choice]");
  if (!button) return;
  if (button.dataset.fieldChoice) { event.preventDefault(); applyFieldChoice(button); return; }
  const action = button.dataset.action;
  try {
    if (action === "sign-in") await window.SproutStore.signIn();
    if (action === "sign-out") await window.SproutStore.signOut();
    if (action === "tab") { state.tab = button.dataset.tab; state.selected = null; state.modal = null; render(); }
    if (action === "plant-category") { state.plantCategory = button.dataset.category; render(); }
    if (action === "mode") { state.mode = button.dataset.mode; state.selected = null; render(); }
    if (action === "add-bed") openModal({ type: "bed" });
    if (action === "edit-bed") openModal({ type: "bed", id: button.dataset.id });
    if (action === "add-plant") { if (!bedsForYear().length) throw new Error("Add a planter box first."); openModal({ type: "plant" }); }
    if (action === "edit-plant") openModal({ type: "plant", id: button.dataset.id });
    if (action === "plant-details") openModal({ type: "details", id: button.dataset.id });
    if (action === "add-log") openModal({ type: "log", id: button.dataset.id });
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
    if (action === "delete-bed") { const bed = state.data.beds.find((item) => item.id === state.modal.id); state.modal = { type: "confirm", title: `Delete Bed ${bed.number}?`, message: "This removes the bed and moves its plants into the archive so their journals are preserved.", confirmLabel: "Delete bed", run: async () => { await window.SproutStore.deleteBed(bed); state.selected = null; } }; render(); }
    if (action === "archive-plant") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); await window.SproutStore.archivePlant(plant, !plant.archived); state.modal = null; state.selected = null; render(); toast(plant.archived ? "Plant restored." : "Plant moved to the archive."); }
    if (action === "delete-log") { const log = state.data.logs.find((item) => item.id === button.dataset.id); if (confirm("Delete this journal entry?")) { await window.SproutStore.deleteLog(log); render(); } }
    if (action === "delete-photo") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); if (confirm("Remove this photo from the plant?")) { await window.SproutStore.savePlant({ ...plant, photos: plant.photos.filter((_, index) => index !== Number(button.dataset.index)) }); render(); } }
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
  if (event.target.id === "plant-filter") { state.plantFilter = event.target.value; render(); }
  if (event.target.matches("[data-photo-plant]")) {
    const plant = state.data.plants.find((item) => item.id === event.target.dataset.photoPlant);
    const file = event.target.files?.[0];
    if (!file) return;
    try { toast("Preparing photo…"); const photo = await uploadPhoto(file, plant.id); await window.SproutStore.savePlant({ ...plant, photos: [...(plant.photos || []), photo] }); render(); toast("Photo added."); } catch (error) { toast(error.message || "Photo upload failed.", "error"); }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "plant-search") { state.search = event.target.value; const position = event.target.selectionStart; render(); requestAnimationFrame(() => { const input = $("#plant-search"); input?.focus(); input?.setSelectionRange(position, position); }); }
  if (event.target.id === "plant-name") {
    const match = varietyFor(event.target.value);
    if (!match) return;
    const form = event.target.form;
    const category = categoryForPlant(match);
    form.elements.category.value = category;
    form.elements.icon.value = categoryById(category).icon;
    $$('[data-field-choice="category"]', form).forEach((button) => button.classList.toggle("selected", button.dataset.value === category));
    for (const name of ["color", "sun", "water"]) {
      form.elements[name].value = match[name];
      $$(`[data-field-choice="${name}"]`, form).forEach((button) => button.classList.toggle("selected", button.dataset.value === match[name]));
    }
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const modalSaves = {
    "bed-form": { pending: "Saving…", run: saveBed },
    "plant-form": { pending: "Saving…", run: savePlant },
    "log-form": { pending: "Saving…", run: saveLog },
    "duplicate-form": { pending: "Duplicating…", run: duplicateYear },
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) closeModal();
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

window.addEventListener("sprout:auth", (event) => { state.user = event.detail; render(); if (state.user) ensureInitialYear(); });
window.addEventListener("sprout:data", (event) => { state.data = event.detail; if (!state.year) state.year = Number(state.data.settings.activeYear || CURRENT_YEAR); render(); if (state.user) ensureInitialYear(); });
window.addEventListener("sprout:error", (event) => toast(event.detail, "error"));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
render();
if (state.user) ensureInitialYear();
