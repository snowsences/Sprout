import "./firebase-client.js?v=62";
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
  { id: "squash", label: "Squash", icon: "🥒" },
  { id: "beans", label: "Beans", icon: "🫘" },
  { id: "potatoes", label: "Potatoes", icon: "🥔" },
  { id: "berries", label: "Berries", icon: "🍓" },
  { id: "alliums", label: "Alliums", icon: "🧅" },
  { id: "greens", label: "Greens", icon: "🥬" },
  { id: "herbs", label: "Herbs", icon: "🌿" },
  { id: "other", label: "Other", icon: "📦" },
];
const COLORS = ["#4f8d5b", "#75a843", "#a7b43c", "#d8a62d", "#df7435", "#c94c49", "#a95a87", "#735ca7", "#3f83a8", "#3b8c83"];
const STATUSES = ["planned", "seeded", "planted", "growing", "harvesting", "finished", "failed", "removed"];
const LOG_TYPES = ["note", "watered", "fertilised", "pruned", "transplanted", "pest or disease", "treatment", "harvested", "status change"];

const state = {
  user: window.SproutCurrentUser || null,
  data: window.SproutData || window.SproutStore.getData(),
  dataReady: false,
  tab: "garden",
  year: null,
  seedCategory: "year",
  seedView: "list",
  yearSubTab: "insights",
  addUpdateOpen: false,
  search: "",
  modal: null,
  modalAnim: null,
  selected: null,
  mode: "browse",
  busy: false,
  clipboard: null,
  map: { zoom: 1, panX: 20, panY: 20, initializedYear: null },
  installPromptAvailable: false,
};
let ensuringInitialYear = false;
let deferredInstallPrompt = null;
const isStandaloneDisplay = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  state.installPromptAvailable = true;
  render();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  state.installPromptAvailable = false;
  render();
});

const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const safeHttpUrl = (value) => { try { const url = new URL(String(value || ""), window.location.href); return url.protocol === "http:" || url.protocol === "https:" ? url.href : ""; } catch { return ""; } };
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
const lastPlantedYear = (seedId) => {
  const years = state.data.plants.filter((plant) => plant.seedId === seedId).map((plant) => Number(plant.year));
  return years.length ? Math.max(...years) : null;
};
const categoryById = (id) => PLANT_CATEGORIES.find((category) => category.id === id);
const categoryForSeed = (seed = {}) => {
  if (categoryById(seed.category)) return seed.category;
  if (seed.icon === "🫑" || seed.icon === "🌶️") return "chiles";
  return PLANT_CATEGORIES.find((category) => category.icon === seed.icon)?.id || "greens";
};
const iconForSeed = (seed) => categoryById(categoryForSeed(seed))?.icon || "🥬";
const seedAvatarInner = (seed) => seed?.coverPhoto?.url ? `<img class="avatar-photo" src="${esc(seed.coverPhoto.url)}" alt="${esc(seed.commonName || "Seed")} photo" loading="lazy">` : esc(iconForSeed(seed));
const starRatingHtml = (rating) => `<span class="seed-rating">${"★".repeat(rating)}</span>`;
const halfStarRatingHtml = (rating) => {
  const stars = [...Array(5)].map((_, index) => {
    const fill = Math.max(0, Math.min(1, rating - index)) * 100;
    return `<span class="star-slot"><span class="star-bg">★</span><span class="star-fg" style="width:${fill}%">★</span></span>`;
  }).join("");
  return `<span class="seed-rating seed-rating-half">${stars}</span>`;
};
const seedAverageRating = (seed) => {
  const values = [seed.tasteRating, seed.productivityRating].filter((v) => v != null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
};
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
    check: '<path d="m5 13 4 4L19 7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "chevron-left": '<path d="m15 6-6 6 6 6"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.garden}</svg>`;
}

function toast(message, kind = "") {
  if (state.tab === "garden") return;
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

const TAB_ORDER = ["garden", "year", "seeds", "settings"];
function withTransition(kind, fn) {
  // View Transitions API disabled: it was producing a stuck, oversized
  // ::view-transition-group(main-view) overlay that broke the bottom nav's
  // layout (grew huge, detached from the bottom, varied per tab). Falling
  // back to a plain re-render until this can be root-caused safely.
  fn();
}

function saveFlash() {
  const node = document.createElement("div");
  node.className = "save-flash";
  node.innerHTML = `<span class="save-flash-badge">${icon("check")}</span>`;
  document.body.append(node);
  setTimeout(() => node.remove(), 1050);
}

function confettiBurst() {
  const colors = ["#4f8d5b", "#d8a62d", "#df7435", "#c94c49", "#a95a87"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight * 0.35;
  for (let index = 0; index < 22; index++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 110;
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    piece.style.setProperty("--r", `${(Math.random() * 2 - 1) * 320}deg`);
    piece.style.animationDelay = `${Math.random() * 90}ms`;
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1000);
}

function enableElasticScroll(selector) {
  let active = null;
  document.addEventListener("touchstart", (event) => {
    const container = event.target.closest(selector);
    if (!container) return;
    active = { container, startY: event.touches[0].clientY };
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!active || !event.touches[0]) return;
    const { container, startY } = active;
    const delta = event.touches[0].clientY - startY;
    const atTop = container.scrollTop <= 0 && delta > 0;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 1 && delta < 0;
    if (atTop || atBottom) {
      container.style.transition = "none";
      container.style.transform = `translateY(${clamp(delta * 0.3, -56, 56)}px)`;
    }
  }, { passive: true });
  const release = () => {
    if (!active) return;
    active.container.style.transition = "transform .32s cubic-bezier(.17,.89,.32,1.15)";
    active.container.style.transform = "";
    active = null;
  };
  document.addEventListener("touchend", release);
  document.addEventListener("touchcancel", release);
}
enableElasticScroll(".tab-page:not(.garden-page),.modal-body,.year-pane,.year-card");

function render() {
  if (!state.user) {
    root.innerHTML = renderSignIn();
    return;
  }
  if (!state.year) state.year = Number(state.data.settings.activeYear || CURRENT_YEAR);
  const years = [...new Set([state.data.settings.activeYear, ...state.data.years.map((item) => item.year), ...state.data.weather.map((item) => item.year)])].filter(Boolean).sort((a, b) => b - a);
  const scrollTops = $$(".tab-page, .year-pane").map((el) => el.scrollTop);
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
        ${navButton("year", String(state.year), "year")}
        ${navButton("seeds", "Seeds", "seeds")}
        ${navButton("settings", "Settings", "settings")}
      </nav>
    </div>
    ${renderModal()}
  `;
  $$(".tab-page, .year-pane").forEach((el, index) => { if (scrollTops[index] != null) el.scrollTop = scrollTops[index]; });
  if (state.tab === "garden") requestAnimationFrame(bindMap);
  syncOverlayHistory();
}

let overlayHistoryDepth = 0;
let ignorePopstates = 0;

function overlayDepth() {
  return (state.selected ? 1 : 0) + (state.modal ? 1 : 0);
}

function syncOverlayHistory() {
  const depth = overlayDepth();
  if (depth === overlayHistoryDepth) return;
  if (depth > overlayHistoryDepth) {
    for (let i = overlayHistoryDepth; i < depth; i++) history.pushState({ sproutOverlay: i + 1 }, "");
  } else {
    for (let i = depth; i < overlayHistoryDepth; i++) { ignorePopstates++; history.back(); }
  }
  overlayHistoryDepth = depth;
}

window.addEventListener("popstate", () => {
  if (ignorePopstates > 0) { ignorePopstates--; overlayHistoryDepth = overlayDepth(); return; }
  if (state.modal) { state.modal = null; state.modalAnim = null; }
  else if (state.selected) { state.selected = null; }
  else return;
  overlayHistoryDepth = overlayDepth();
  render();
});

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

const NAV_ICONS = {
  garden: {
    viewBox: "0 0 21 20",
    outline: `<path d="M19 14.5H2V18H19V14.5ZM13.5 9.5C13.5 7.84313 12.1569 6.5 10.5 6.5C8.84313 6.5 7.5 7.84313 7.5 9.5C7.5 10.0523 7.05228 10.5 6.5 10.5C5.94772 10.5 5.5 10.0523 5.5 9.5C5.5 6.73856 7.73856 4.5 10.5 4.5C13.2614 4.5 15.5 6.73857 15.5 9.5C15.5 10.0523 15.0523 10.5 14.5 10.5C13.9477 10.5 13.5 10.0523 13.5 9.5ZM3.79297 2.29297C4.18349 1.90244 4.81651 1.90244 5.20703 2.29297L5.91406 3C6.30459 3.39052 6.30459 4.02354 5.91406 4.41406C5.52354 4.80459 4.89052 4.80459 4.5 4.41406L3.79297 3.70703C3.40244 3.31651 3.40244 2.68349 3.79297 2.29297ZM15.5 2.29297C15.8905 1.90247 16.5235 1.90247 16.9141 2.29297C17.3046 2.6835 17.3046 3.31652 16.9141 3.70703L16.207 4.41406C15.8165 4.80456 15.1835 4.80456 14.793 4.41406C14.4025 4.02352 14.4024 3.39051 14.793 3L15.5 2.29297ZM9.5 2V1C9.5 0.447715 9.94771 0 10.5 0C11.0523 0 11.5 0.447715 11.5 1V2C11.5 2.55228 11.0523 3 10.5 3C9.94771 3 9.5 2.55228 9.5 2ZM21 18C21 19.1046 20.1046 20 19 20H2C0.89544 20 0 19.1046 0 18V10C0 9.44771 0.447715 9 1 9C1.55228 9 2 9.44771 2 10V12.5H19V10C19 9.44771 19.4477 9 20 9C20.5523 9 21 9.44771 21 10V18Z" fill="currentColor"/>`,
    filled: `<path d="M13.5 9.5C13.5 7.84313 12.1569 6.5 10.5 6.5C8.84313 6.5 7.5 7.84313 7.5 9.5C7.5 10.0523 7.05228 10.5 6.5 10.5C5.94772 10.5 5.5 10.0523 5.5 9.5C5.5 6.73856 7.73856 4.5 10.5 4.5C13.2614 4.5 15.5 6.73857 15.5 9.5C15.5 10.0523 15.0523 10.5 14.5 10.5C13.9477 10.5 13.5 10.0523 13.5 9.5ZM3.79297 2.29297C4.18349 1.90244 4.81651 1.90244 5.20703 2.29297L5.91406 3C6.30459 3.39052 6.30459 4.02354 5.91406 4.41406C5.52354 4.80459 4.89052 4.80459 4.5 4.41406L3.79297 3.70703C3.40244 3.31651 3.40244 2.68349 3.79297 2.29297ZM15.5 2.29297C15.8905 1.90247 16.5235 1.90247 16.9141 2.29297C17.3046 2.6835 17.3046 3.31652 16.9141 3.70703L16.207 4.41406C15.8165 4.80456 15.1835 4.80456 14.793 4.41406C14.4025 4.02352 14.4024 3.39051 14.793 3L15.5 2.29297ZM9.5 2V1C9.5 0.447715 9.94771 0 10.5 0C11.0523 0 11.5 0.447715 11.5 1V2C11.5 2.55228 11.0523 3 10.5 3C9.94771 3 9.5 2.55228 9.5 2ZM21 18C21 19.1046 20.1046 20 19 20H2C0.89544 20 0 19.1046 0 18V10C0 9.44771 0.447715 9 1 9C1.55228 9 2 9.44771 2 10V12.5H19V10C19 9.44771 19.4477 9 20 9C20.5523 9 21 9.44771 21 10V18Z" fill="currentColor"/><path d="M6.80232 7.77914C6.91486 6.76627 7.77099 6 8.79009 6H12.2099C13.229 6 14.0851 6.76627 14.1977 7.77914L14.5 10.5H6.5L6.80232 7.77914Z" fill="currentColor"/>`,
  },
  seeds: {
    viewBox: "0 0 21 19",
    outline: `<path d="M19.9742 0.175773C19.7221 0.133519 13.8809 -0.84889 10.7187 2.33074C10.0148 3.03849 9.52104 3.88358 9.17435 4.76035C8.99575 4.50682 8.80665 4.26386 8.58603 4.03147C5.98061 1.41171 1.20051 2.21454 0.990396 2.24623C0.549156 2.32017 0.212973 2.66877 0.139433 3.10187C0.107916 3.30258 -0.690519 8.11955 1.9149 10.7393C3.51177 12.345 5.92808 12.6619 7.59849 12.6619C7.89265 12.6619 8.15529 12.6619 8.39693 12.6407V19H10.4981V12.6091C10.8553 12.6407 11.286 12.6619 11.7693 12.6619C13.8179 12.6619 16.749 12.271 18.682 10.3273C21.8442 7.14771 20.8672 1.26382 20.8252 1.02086C20.789 0.80714 20.6877 0.610001 20.5353 0.456711C20.3828 0.303421 20.1868 0.201557 19.9742 0.16521V0.175773ZM8.36541 10.5386C7.13624 10.6231 4.71992 10.5914 3.3962 9.26042C2.06198 7.91885 2.04097 5.4998 2.12501 4.2533C3.35418 4.16879 5.7705 4.20048 7.09422 5.53149C8.42844 6.87306 8.44945 9.29211 8.36541 10.5386ZM17.2007 8.859C15.3832 10.6865 12.0529 10.6442 10.5506 10.5175C10.4245 9.00689 10.3825 5.66881 12.2 3.83076C14.0175 2.00327 17.3478 2.04552 18.8501 2.17228C18.9762 3.68287 19.0182 7.02095 17.2007 8.859Z" fill="currentColor"/>`,
    filled: `<path d="M10.7232 2.32897C13.8837 -0.848281 19.7221 0.133432 19.9741 0.175655C20.1865 0.21198 20.3823 0.313551 20.5347 0.46667C20.687 0.619803 20.7886 0.816659 20.8247 1.03015C20.8667 1.27293 21.8427 7.1527 18.6821 10.33C16.7502 12.2719 13.8213 12.6629 11.7739 12.663C11.2911 12.663 10.8604 12.6419 10.5034 12.6102V18.996H8.40285V9.49597C8.38185 7.43773 8.71798 4.34511 10.7232 2.32897Z" fill="currentColor"/><path d="M0.989765 2.25476C1.18926 2.22309 5.76734 1.46349 8.40285 3.88073C7.52101 5.7912 7.33205 7.92328 7.35305 9.49597V12.663C5.68355 12.6313 3.43608 12.2716 1.91359 10.7411C-0.687876 8.12514 0.106554 3.31755 0.139179 3.11022C0.212662 2.67754 0.548909 2.32875 0.989765 2.25476Z" fill="currentColor"/>`,
  },
  year: {
    viewBox: "0 0 20 20",
    outline: `<path d="M17.7778 8.88889H2.22222V17.7778H17.7778V8.88889ZM5.56641 14.4444C6.18006 14.4444 6.67752 14.9419 6.67752 15.5556V15.5664C6.67752 16.1801 6.18006 16.6775 5.56641 16.6775H5.55556C4.94191 16.6775 4.44444 16.1801 4.44444 15.5664V15.5556C4.44444 14.9419 4.94191 14.4444 5.55556 14.4444H5.56641ZM10.0109 14.4444C10.6245 14.4444 11.122 14.9419 11.122 15.5556V15.5664C11.122 16.1801 10.6245 16.6775 10.0109 16.6775H10C9.38635 16.6775 8.88889 16.1801 8.88889 15.5664V15.5556C8.88889 14.9419 9.38635 14.4444 10 14.4444H10.0109ZM14.4553 14.4444C15.0689 14.4444 15.5664 14.9419 15.5664 15.5556V15.5664C15.5664 16.1801 15.0689 16.6775 14.4553 16.6775H14.4444C13.8308 16.6775 13.3333 16.1801 13.3333 15.5664V15.5556C13.3333 14.9419 13.8308 14.4444 14.4444 14.4444H14.4553ZM5.56641 10C6.18006 10 6.67752 10.4975 6.67752 11.1111V11.122C6.67752 11.7356 6.18006 12.2331 5.56641 12.2331H5.55556C4.94191 12.2331 4.44444 11.7356 4.44444 11.122V11.1111C4.44444 10.4975 4.94191 10 5.55556 10H5.56641ZM10.0109 10C10.6245 10 11.122 10.4975 11.122 11.1111V11.122C11.122 11.7356 10.6245 12.2331 10.0109 12.2331H10C9.38635 12.2331 8.88889 11.7356 8.88889 11.122V11.1111C8.88889 10.4975 9.38635 10 10 10H10.0109ZM14.4553 10C15.0689 10 15.5664 10.4975 15.5664 11.1111V11.122C15.5664 11.7356 15.0689 12.2331 14.4553 12.2331H14.4444C13.8308 12.2331 13.3333 11.7356 13.3333 11.122V11.1111C13.3333 10.4975 13.8308 10 14.4444 10H14.4553ZM14.4444 4.44444H11.1111C11.1111 5.05809 10.6137 5.55556 10 5.55556C9.38635 5.55556 8.88889 5.05809 8.88889 4.44444H5.55556C5.55556 5.05809 5.05809 5.55556 4.44444 5.55556C3.83079 5.55556 3.33333 5.05809 3.33333 4.44444H2.22222V6.66667H17.7778V4.44444H16.6667C16.6667 5.05809 16.1692 5.55556 15.5556 5.55556C14.9419 5.55556 14.4444 5.05809 14.4444 4.44444ZM20 17.7778C20 18.3671 19.7657 18.9322 19.349 19.349C18.9322 19.7657 18.3671 20 17.7778 20H2.22222C1.63285 20 1.06779 19.7657 0.651042 19.349C0.234295 18.9322 0 18.3671 0 17.7778V4.44444C0 3.85507 0.234295 3.29001 0.651042 2.87326C1.06779 2.45652 1.63285 2.22222 2.22222 2.22222H3.33333V1.11111C3.33333 0.497461 3.83079 0 4.44444 0C5.05809 0 5.55556 0.497461 5.55556 1.11111V2.22222H8.88889V1.11111C8.88889 0.497461 9.38635 0 10 0C10.6137 0 11.1111 0.497461 11.1111 1.11111V2.22222H14.4444V1.11111C14.4444 0.497461 14.9419 0 15.5556 0C16.1692 0 16.6667 0.497461 16.6667 1.11111V2.22222H17.7778C18.3671 2.22222 18.9322 2.45652 19.349 2.87326C19.7657 3.29001 20 3.85508 20 4.44444V17.7778Z" fill="currentColor"/>`,
    filled: `<path fill-rule="evenodd" clip-rule="evenodd" d="M2.22222 2.22222C2.51691 2.22222 2.79952 2.10516 3.0079 1.89679C3.21627 1.68841 3.33333 1.4058 3.33333 1.11111C3.33333 0.816426 3.4504 0.533811 3.65877 0.325437C3.86714 0.117063 4.14976 0 4.44444 0C4.73913 0 5.02174 0.117063 5.23012 0.325437C5.43849 0.533811 5.55556 0.816426 5.55556 1.11111C5.55556 1.4058 5.67262 1.68841 5.88099 1.89679C6.08937 2.10516 6.37198 2.22222 6.66667 2.22222H7.77778C8.07246 2.22222 8.35508 2.10516 8.56345 1.89679C8.77183 1.68841 8.88889 1.4058 8.88889 1.11111C8.88889 0.816426 9.00595 0.533811 9.21433 0.325437C9.4227 0.117063 9.70532 0 10 0C10.2947 0 10.5773 0.117063 10.7857 0.325437C10.994 0.533811 11.1111 0.816426 11.1111 1.11111C11.1111 1.4058 11.2282 1.68841 11.4365 1.89679C11.6449 2.10516 11.9275 2.22222 12.2222 2.22222H13.3333C13.628 2.22222 13.9106 2.10516 14.119 1.89679C14.3274 1.68841 14.4444 1.4058 14.4444 1.11111C14.4444 0.816426 14.5615 0.533811 14.7699 0.325437C14.9783 0.117063 15.2609 0 15.5556 0C15.8502 0 16.1329 0.117063 16.3412 0.325437C16.5496 0.533811 16.6667 0.816426 16.6667 1.11111C16.6667 1.4058 16.7837 1.68841 16.9921 1.89679C17.2005 2.10516 17.4831 2.22222 17.7778 2.22222C18.3671 2.22222 18.9324 2.45635 19.3491 2.8731C19.7659 3.28984 20 3.85507 20 4.44444V5.55556C20 5.85024 19.8829 6.13286 19.6746 6.34123C19.4662 6.5496 19.1836 6.66667 18.8889 6.66667H1.11111C0.816426 6.66667 0.533811 6.5496 0.325437 6.34123C0.117063 6.13286 0 5.85024 0 5.55556V4.44444C0 3.85507 0.234126 3.28984 0.650874 2.8731C1.06762 2.45635 1.63285 2.22222 2.22222 2.22222ZM0 17.7778V10C0 9.70532 0.117063 9.4227 0.325437 9.21433C0.533811 9.00595 0.816426 8.88889 1.11111 8.88889H18.8889C19.1836 8.88889 19.4662 9.00595 19.6746 9.21433C19.8829 9.4227 20 9.70532 20 10V17.7778C20 18.3671 19.7659 18.9324 19.3491 19.3491C18.9324 19.7659 18.3671 20 17.7778 20H2.22222C1.63285 20 1.06762 19.7659 0.650874 19.3491C0.234126 18.9324 0 18.3671 0 17.7778ZM6.67778 11.1111C6.67778 10.8164 6.56071 10.5338 6.35234 10.3254C6.14397 10.1171 5.86135 10 5.56667 10C5.27198 10 4.98937 10.1171 4.78099 10.3254C4.57262 10.5338 4.45556 10.8164 4.45556 11.1111C4.45556 11.4058 4.57262 11.6884 4.78099 11.8968C4.98937 12.1052 5.27198 12.2222 5.56667 12.2222C5.86135 12.2222 6.14397 12.1052 6.35234 11.8968C6.56071 11.6884 6.67778 11.4058 6.67778 11.1111ZM8.9 11.1111C8.9 10.8164 9.01706 10.5338 9.22544 10.3254C9.43381 10.1171 9.71643 10 10.0111 10C10.3058 10 10.5884 10.1171 10.7968 10.3254C11.0052 10.5338 11.1222 10.8164 11.1222 11.1111C11.1222 11.4058 11.0052 11.6884 10.7968 11.8968C10.5884 12.1052 10.3058 12.2222 10.0111 12.2222C9.71643 12.2222 9.43381 12.1052 9.22544 11.8968C9.01706 11.6884 8.9 11.4058 8.9 11.1111ZM15.5667 11.1111C15.5667 10.8164 15.4496 10.5338 15.2412 10.3254C15.0329 10.1171 14.7502 10 14.4556 10C14.1609 10 13.8783 10.1171 13.6699 10.3254C13.4615 10.5338 13.3444 10.8164 13.3444 11.1111C13.3444 11.4058 13.4615 11.6884 13.6699 11.8968C13.8783 12.1052 14.1609 12.2222 14.4556 12.2222C14.7502 12.2222 15.0329 12.1052 15.2412 11.8968C15.4496 11.6884 15.5667 11.4058 15.5667 11.1111ZM4.45556 15.5556C4.45556 15.2609 4.57262 14.9783 4.78099 14.7699C4.98937 14.5615 5.27198 14.4444 5.56667 14.4444C5.86135 14.4444 6.14397 14.5615 6.35234 14.7699C6.56071 14.9783 6.67778 15.2609 6.67778 15.5556C6.67778 15.8502 6.56071 16.1329 6.35234 16.3412C6.14397 16.5496 5.86135 16.6667 5.56667 16.6667C5.27198 16.6667 4.98937 16.5496 4.78099 16.3412C4.57262 16.1329 4.45556 15.8502 4.45556 15.5556ZM11.1222 15.5556C11.1222 15.2609 11.0052 14.9783 10.7968 14.7699C10.5884 14.5615 10.3058 14.4444 10.0111 14.4444C9.71643 14.4444 9.43381 14.5615 9.22544 14.7699C9.01706 14.9783 8.9 15.2609 8.9 15.5556C8.9 15.8502 9.01706 16.1329 9.22544 16.3412C9.43381 16.5496 9.71643 16.6667 10.0111 16.6667C10.3058 16.6667 10.5884 16.5496 10.7968 16.3412C11.0052 16.1329 11.1222 15.8502 11.1222 15.5556ZM13.3444 15.5556C13.3444 15.2609 13.4615 14.9783 13.6699 14.7699C13.8783 14.5615 14.1609 14.4444 14.4556 14.4444C14.7502 14.4444 15.0329 14.5615 15.2412 14.7699C15.4496 14.9783 15.5667 15.2609 15.5667 15.5556C15.5667 15.8502 15.4496 16.1329 15.2412 16.3412C15.0329 16.5496 14.7502 16.6667 14.4556 16.6667C14.1609 16.6667 13.8783 16.5496 13.6699 16.3412C13.4615 16.1329 13.3444 15.8502 13.3444 15.5556Z" fill="currentColor"/>`,
  },
  settings: {
    viewBox: "0 0 20 21",
    outline: `<path fill-rule="evenodd" clip-rule="evenodd" d="M9.99988 6.825C12.0346 6.82507 13.6841 8.4704 13.6841 10.5C13.6841 12.5296 12.0346 14.1749 9.99988 14.175C7.96514 14.175 6.31566 12.5296 6.31566 10.5C6.31566 8.47035 7.96514 6.825 9.99988 6.825ZM9.99988 8.925C9.12785 8.925 8.42093 9.63015 8.42093 10.5C8.42093 11.3698 9.12785 12.075 9.99988 12.075C10.8718 12.0749 11.5788 11.3698 11.5788 10.5C11.5788 9.63019 10.8718 8.92507 9.99988 8.925Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.99165 0C10.4553 3.08815e-05 10.9041 0.0326941 11.3434 0.0881836L11.7793 0.150732L11.8122 0.156885C12.1226 0.216834 12.4091 0.362795 12.6387 0.577295L12.7343 0.673682L12.8206 0.777246C13.0084 1.02067 13.1252 1.31203 13.1578 1.61909L13.3469 3.27305C13.7836 3.4747 14.1994 3.71468 14.5866 3.98467L16.1121 3.33252C16.4342 3.18989 16.7936 3.15083 17.1391 3.2228C17.4961 3.29731 17.8196 3.48629 18.0601 3.76011L18.0694 3.76934L18.0766 3.77959C18.837 4.68879 19.4454 5.72912 19.8662 6.84551C20.1729 7.61001 19.8409 8.38029 19.307 8.78965L19.3009 8.79477L19.2937 8.79888L17.9625 9.78735C18.0063 10.2601 18.006 10.7358 17.9625 11.2085L19.3081 12.198L19.3245 12.2104C19.8518 12.6148 20.1806 13.3705 19.893 14.1258L19.895 14.1268C19.4716 15.2772 18.8564 16.3088 18.094 17.2204L18.093 17.2194C17.5722 17.8617 16.7431 17.9295 16.1543 17.6952L16.1296 17.6849L14.6072 17.0317C14.2143 17.3072 13.7996 17.5453 13.3634 17.7454L13.1752 19.3819L13.1742 19.3932C13.0836 20.1149 12.5378 20.7073 11.806 20.8441L11.7926 20.8472L11.7793 20.8493C11.201 20.9422 10.6096 21 9.99165 21C9.37398 21 8.78023 20.9422 8.21431 20.8482L8.19375 20.8441C7.46184 20.7074 6.91614 20.115 6.82553 19.3932L6.8245 19.3819L6.63536 17.7444C6.198 17.5424 5.78139 17.3022 5.39358 17.0317L3.87014 17.6849L3.84547 17.6952C3.20036 17.952 2.39438 17.8045 1.90571 17.2204C1.14328 16.3088 0.528159 15.2772 0.10472 14.1268L0.106776 14.1258C-0.180942 13.3704 0.147799 12.6148 0.675238 12.2104L0.682434 12.2052L0.688602 12.2011L2.01878 11.2116C1.97495 10.7379 1.97489 10.2611 2.01878 9.78735L0.688602 8.79888L0.68963 8.79785C0.110867 8.37879 -0.166319 7.59043 0.106776 6.87319H0.10472C0.527912 5.72345 1.14419 4.68772 1.9129 3.78779C2.43425 3.15439 3.25964 3.08896 3.84547 3.32227L3.85986 3.32739L3.87323 3.33354L5.37611 3.98262C5.76976 3.70685 6.18594 3.4691 6.62302 3.26895L6.82553 1.61089V1.60679C6.91078 0.927708 7.40391 0.30026 8.17627 0.155859L8.18964 0.152783L8.203 0.150732C8.78143 0.0578004 9.37345 0 9.99165 0ZM9.99165 2.1C9.61904 2.1 9.25027 2.12678 8.87734 2.17485L8.63885 4.1313L8.56176 4.77217L7.9532 4.99263C7.30918 5.22601 6.72563 5.55992 6.19847 5.99751L5.70094 6.41074L3.32224 5.38433C2.86486 5.96193 2.48523 6.60345 2.19662 7.30181L4.29675 8.8604L4.18059 9.50024C4.06131 10.1613 4.06131 10.8387 4.18059 11.4998L4.29675 12.1396L2.19662 13.6972C2.48499 14.3954 2.86544 15.0401 3.32635 15.6321L5.12631 14.861L5.71739 14.6087L6.21287 15.0179C6.72724 15.4425 7.32997 15.7927 7.97068 16.0248L8.58334 16.2473L8.87837 18.8241C9.24411 18.8726 9.61531 18.9 9.99165 18.9C10.3692 18.9 10.7423 18.8714 11.1204 18.8221L11.4164 16.2473L12.0291 16.0248C12.6733 15.7913 13.2575 15.4567 13.7848 15.0189L14.2803 14.6077L14.8734 14.861L16.6724 15.6321C17.1329 15.0407 17.5128 14.3966 17.8011 13.6992L15.6855 12.1427L15.8017 11.4998C15.921 10.8387 15.921 10.1613 15.8017 9.50024L15.6866 8.8604L16.2088 8.47178L17.7836 7.30283C17.4959 6.61529 17.1185 5.96697 16.6652 5.38022L14.2649 6.40869L13.7694 5.99956C13.255 5.57494 12.6523 5.2248 12.0116 4.99263L11.3989 4.77012L11.1029 2.17485C10.7309 2.12697 10.3634 2.10003 9.99165 2.1Z" fill="currentColor"/>`,
    filled: `<path d="M17.9989 10.5006C17.9989 9.94928 17.9456 9.41113 17.8256 8.89922L19.7187 7.53415C19.9587 7.36352 20.0653 7.0485 19.9587 6.77286C19.5454 5.7228 18.9721 4.7515 18.2656 3.89833C18.1717 3.78886 18.0446 3.71194 17.903 3.67886C17.7614 3.64578 17.6128 3.6583 17.479 3.71457L15.3326 4.6465C14.5194 3.92458 13.5595 3.3733 12.5063 3.03204L12.2397 0.708788C12.2246 0.567172 12.1631 0.434245 12.0645 0.330065C11.9659 0.225886 11.8355 0.156107 11.6931 0.131257C11.1465 0.0525028 10.5733 0 10 0C9.42674 0 8.86682 0.0393771 8.32023 0.131257C8.02693 0.170634 7.8003 0.420022 7.77363 0.708788L7.507 3.01891C6.44048 3.36018 5.49394 3.91146 4.68072 4.63337L2.53434 3.70145C2.39987 3.64263 2.24989 3.62746 2.10609 3.65814C1.96229 3.68882 1.83213 3.76374 1.73445 3.87208C1.02788 4.72525 0.454619 5.69655 0.0413416 6.74661C-0.0653107 7.02225 0.0413416 7.33727 0.281309 7.5079L2.17439 8.87297C2.06774 9.398 2.00108 9.94928 2.00108 10.5006C2.00108 11.0518 2.0544 11.59 2.17439 12.1019L0.281309 13.467C0.0413416 13.6376 -0.0653107 13.9526 0.0413416 14.2283C0.454619 15.2783 1.02788 16.2496 1.73445 17.1028C1.92109 17.3259 2.25438 17.4047 2.52101 17.2865L4.66739 16.3546C5.48061 17.0765 6.44048 17.6278 7.49367 17.9691L7.74697 20.2792C7.77363 20.568 8.00027 20.8174 8.29356 20.8567C9.41399 21.0432 10.5579 21.0477 11.6798 20.8699C11.9731 20.8305 12.1997 20.5811 12.2264 20.2923L12.493 17.9822C13.5595 17.6409 14.5061 17.0897 15.3193 16.3677L17.4657 17.2997C17.7323 17.4178 18.0656 17.3522 18.2522 17.129C18.9588 16.2759 19.532 15.3046 19.9453 14.2545C20.052 13.9789 19.9453 13.6639 19.7054 13.4932L17.8123 12.1281C17.9323 11.6031 17.9989 11.0518 17.9989 10.5006ZM10 13.1257C8.53353 13.1257 7.33369 11.9444 7.33369 10.5006C7.33369 9.05673 8.53353 7.87542 10 7.87542C11.4665 7.87542 12.6663 9.05673 12.6663 10.5006C12.6663 11.9444 11.4665 13.1257 10 13.1257Z" fill="currentColor"/>`,
  },
};

function navIcon(name, active) {
  const spec = NAV_ICONS[name];
  if (!spec) return icon(name);
  return `<svg viewBox="${spec.viewBox}" aria-hidden="true">${active ? spec.filled : spec.outline}</svg>`;
}

function navButton(tab, label, iconName) {
  const active = state.tab === tab;
  return `<button class="nav-item ${active ? "active" : ""}" data-action="tab" data-tab="${tab}">${navIcon(iconName, active)}<span>${label}</span></button>`;
}

function renderPage() {
  if (state.tab === "garden") return renderGarden();
  if (state.tab === "year") return renderYearTab();
  if (state.tab === "seeds") return renderSeeds();
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
        <button data-action="mode" data-mode="browse" class="${state.mode === "browse" ? "active" : ""}">View</button>
        <button class="mode-beds-btn ${state.mode === "layout" ? "active" : ""}" data-action="mode" data-mode="layout" ${readOnly ? "disabled" : ""}>Beds</button>
        <button data-action="mode" data-mode="plants" class="${state.mode === "plants" ? "active" : ""}" ${readOnly ? "disabled" : ""}>Plants</button>
      </div>
      <span class="tool-divider"></span>
      <button class="tool-button primary add-plant-btn" data-action="add-plant" ${readOnly || !seeds.length ? "disabled" : ""}>${icon("plus")}<span>Add plant</span></button>
      ${readOnly ? `<button class="tool-button" data-action="duplicate-year">${icon("duplicate")}<span>Duplicate year</span></button>` : ""}
      <div class="zoom-group">
        <button class="icon-button" data-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button>
        <button class="icon-button" data-action="fit-map" aria-label="Fit garden">${icon("fit")}</button>
        <button class="icon-button" data-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button>
      </div>
      ${!readOnly && state.mode === "plants" && selectedPlant ? `<button class="icon-button" data-action="duplicate-plant" aria-label="Duplicate plant">${icon("duplicate")}</button>` : ""}
    </div>
    <div class="garden-body">
      <div class="map-viewport" aria-label="Garden plan">
        <div class="garden-world ${readOnly ? "readonly" : ""} ${state.mode !== "layout" ? "beds-inert" : ""} ${state.mode === "layout" ? "layout-mode" : ""}" style="width:${settings.widthIn * PX_PER_INCH * (state.map.zoom || 1)}px;height:${settings.heightIn * PX_PER_INCH * (state.map.zoom || 1)}px;background-size:${settings.gridIn * PX_PER_INCH * (state.map.zoom || 1)}px ${settings.gridIn * PX_PER_INCH * (state.map.zoom || 1)}px">
          ${beds.map((bed) => renderBed(bed, PX_PER_INCH * (state.map.zoom || 1))).join("")}
          ${plants.map((plant) => renderPlantMarker(plant, PX_PER_INCH * (state.map.zoom || 1), plants)).join("")}
        </div>
        ${!beds.length && !plants.length ? `<div class="map-empty"><h2>${readOnly ? "No beds in this snapshot" : "Start planning your garden"}</h2><p>${readOnly ? "This year does not contain a saved layout." : "Copy a bed from another year (⌘/Ctrl+C) and paste it here (⌘/Ctrl+V) to get started, or add seeds and place plants anywhere on the grid."}</p></div>` : ""}
        ${selectedPlant ? renderSelectionPlant(selectedPlant) : selectedBed ? renderSelectionBed(selectedBed) : ""}
      </div>
    </div>
  </section>`;
}

function resizeHandles(kind, id) {
  return ["nw", "ne", "sw", "se"].map((corner) => `<span class="resize-handle rh-${corner}" data-resize="${kind}" data-corner="${corner}" data-id="${id}"></span>`).join("");
}

function renderBed(bed, scale) {
  const width = bed.widthIn * scale;
  const height = bed.heightIn * scale;
  const rotation = Number(bed.rotation || 0);
  const selected = state.selected?.type === "bed" && state.selected.id === bed.id;
  const showHandles = !yearIsReadOnly() && state.mode === "layout" && selected;
  return `<div class="bed-wrap" data-kind="bed" data-id="${bed.id}" style="left:${bed.x * scale}px;top:${bed.y * scale}px;width:${width}px;height:${height}px">
    <div class="bed ${state.mode === "layout" && selected ? "selected" : ""}" style="transform:rotate(${rotation}deg)"></div>
    ${showHandles ? resizeHandles("bed", bed.id) : ""}
  </div>`;
}

function plantEdgeInsets(plant, allPlants) {
  const EPS = 0.01;
  const left = plant.x, right = plant.x + plant.widthIn, top = plant.y, bottom = plant.y + plant.heightIn;
  const insets = { top: 7.5, right: 7.5, bottom: 7.5, left: 7.5 };
  for (const other of allPlants) {
    if (other.id === plant.id) continue;
    const oLeft = other.x, oRight = other.x + other.widthIn, oTop = other.y, oBottom = other.y + other.heightIn;
    const vOverlap = Math.min(bottom, oBottom) - Math.max(top, oTop) > EPS;
    const hOverlap = Math.min(right, oRight) - Math.max(left, oLeft) > EPS;
    if (vOverlap && Math.abs(left - oRight) < EPS) insets.left = 0;
    if (vOverlap && Math.abs(right - oLeft) < EPS) insets.right = 0;
    if (hOverlap && Math.abs(top - oBottom) < EPS) insets.top = 0;
    if (hOverlap && Math.abs(bottom - oTop) < EPS) insets.bottom = 0;
  }
  return insets;
}

function renderPlantMarker(plant, scale, allPlants) {
  const seed = seedFor(plant);
  const selected = state.selected?.type === "plant" && state.selected.id === plant.id;
  const showHandles = !yearIsReadOnly() && state.mode === "plants" && selected;
  const insets = plantEdgeInsets(plant, allPlants);
  return `<div class="plant-marker ${selected ? "selected" : ""}" data-kind="plant" data-id="${plant.id}" style="left:${plant.x * scale}px;top:${plant.y * scale}px;width:${plant.widthIn * scale}px;height:${plant.heightIn * scale}px"><div class="plant-visual" style="--plant-color:${esc(seed.color || "#4f8d5b")};inset:${insets.top}% ${insets.right}% ${insets.bottom}% ${insets.left}%"><span class="plant-icon">${esc(iconForSeed(seed))}</span><span class="plant-label">${esc(seed.commonName || "Plant")}</span></div>${showHandles ? resizeHandles("plant", plant.id) : ""}</div>`;
}

function renderSelectionPlant(plant) {
  const seed = seedFor(plant);
  const statusIndex = STATUSES.indexOf(plant.status);
  const prevStatus = statusIndex > 0 ? STATUSES[statusIndex - 1] : null;
  const nextStatus = statusIndex >= 0 && statusIndex < STATUSES.length - 1 ? STATUSES[statusIndex + 1] : null;
  const statusShortcuts = !yearIsReadOnly() && (prevStatus || nextStatus) ? `<div class="status-shortcuts">${prevStatus ? `<button class="status-shortcut" data-action="set-plant-status" data-id="${plant.id}" data-status="${prevStatus}">← ${title(prevStatus)}</button>` : ""}${nextStatus ? `<button class="status-shortcut" data-action="set-plant-status" data-id="${plant.id}" data-status="${nextStatus}">${title(nextStatus)} →</button>` : ""}</div>` : "";
  const addPhoto = yearIsReadOnly() ? "" : `<label class="secondary-button full photo-capture">${icon("camera")}Add Photo<input class="hidden" type="file" accept="image/*" capture="environment" data-photo-plant="${plant.id}"></label>`;
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon" style="--plant-color:${esc(seed.color)}">${seedAvatarInner(seed)}</div><div class="selection-copy"><h3>${esc(seed.commonName || "Plant")}</h3><p>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)} · ${title(plant.status)}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div>${statusShortcuts}${addPhoto}<div class="selection-actions"><button class="secondary-button" data-action="plant-details" data-id="${plant.id}">Details</button>${yearIsReadOnly() ? "" : `<button class="primary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button>`}</div></aside>`;
}

function renderSelectionBed(bed) {
  return `<aside class="selection-card"><div class="selection-head"><div class="selection-icon">▦</div><div class="selection-copy"><h3>Bed</h3><p>${dimensions(bed.widthIn)} × ${dimensions(bed.heightIn)}${bed.notes ? ` · ${esc(bed.notes)}` : ""}</p></div><button class="close-button" data-action="clear-selection" aria-label="Close">×</button></div>${yearIsReadOnly() ? "" : `<div class="selection-actions"><button class="primary-button" data-action="edit-bed" data-id="${bed.id}">Edit bed</button></div>`}</aside>`;
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
      ${readOnly ? "" : `<label class="year-cover-upload" aria-label="${record.coverPhoto ? "Change photo" : "Add cover photo"}">${icon("edit")}<input class="hidden" type="file" accept="image/*" data-year-cover="${year}"></label>`}
    </div>
    <div class="year-card-body">
      <div class="section-head"><h3>${year} Updates</h3><div class="section-head-actions">${readOnly ? "" : `<button class="text-button" data-action="log-monthly-update">Log Monthly Update</button>`}${readOnly || state.addUpdateOpen ? "" : `<button class="text-button" data-action="toggle-add-update">+ Add Update</button>`}</div></div>
      ${!readOnly && state.addUpdateOpen ? `<form id="year-update-form" class="year-update-form"><input type="hidden" name="year" value="${year}"><input name="date" type="date" value="${today}" max="${today}" required><textarea name="text" maxlength="1000" placeholder="What happened in the garden today?"></textarea><label class="text-button year-update-photo-label">${icon("camera")} Add photo<input class="hidden" type="file" accept="image/*" name="photo"></label><div class="year-update-form-actions"><button class="secondary-button" type="button" data-action="cancel-add-update">Cancel</button><button class="primary-button" type="submit">Save</button></div></form>` : ""}
      <div class="year-timeline">${!state.dataReady ? skeletonTimelineRows() : updates.length ? renderUpdateEntries(updates, readOnly) : '<div class="form-note">No updates yet this year.</div>'}</div>
    </div>
  </aside>`;
}

function yearUpdatePhotos(year) {
  return yearUpdatesForYear(year).filter((entry) => entry.photo).map((entry) => entry.photo);
}

function renderUpdateEntries(updates, readOnly) {
  const photoIndexById = new Map();
  updates.filter((entry) => entry.photo).forEach((entry, index) => photoIndexById.set(entry.id, index));
  return updates.map((entry) => renderUpdateEntry(entry, readOnly, photoIndexById.get(entry.id))).join("");
}

function renderUpdateEntry(entry, readOnly, photoIndex) {
  if (entry.type === "monthly") {
    const chips = (entry.ratings || []).map((r) => `<span class="rating-chip">${esc(seedById(r.seedId)?.commonName || "Plant")}: ${r.rating == null ? "N/A" : "★".repeat(r.rating)}</span>`).join("");
    return `<article class="timeline-entry timeline-monthly">
      <div class="timeline-date">${monthLabel(entry.month)} ${entry.year} <span class="timeline-badge">Monthly</span></div>
      <div class="monthly-summary">${chips}</div>
      ${entry.note ? `<p>${esc(entry.note)}</p>` : ""}
      ${readOnly ? "" : `<button class="text-button" data-action="edit-monthly-update" data-id="${entry.id}">Edit</button> · <button class="text-button" data-action="delete-year-update" data-id="${entry.id}">Delete</button>`}
    </article>`;
  }
  return `<article class="timeline-entry">${entry.photo ? `<img class="timeline-photo" src="${esc(entry.photo.url)}" alt="Update photo" loading="lazy" data-action="open-lightbox" data-gallery="year-update" data-gallery-id="${entry.year}" data-index="${photoIndex}">` : ""}<div class="timeline-date">${shortDate(entry.date)}</div>${entry.text ? `<p>${esc(entry.text)}</p>` : ""}${readOnly ? "" : `<button class="text-button" data-action="delete-year-update" data-id="${entry.id}">Delete</button>`}</article>`;
}

function renderYearTab() {
  const year = state.year;
  return `<section class="tab-page year-tab">
    <div class="year-subtabs segmented" role="tablist" aria-label="Year view">
      <button data-action="year-subtab" data-subtab="updates" class="${state.yearSubTab === "updates" ? "active" : ""}">Updates</button>
      <button data-action="year-subtab" data-subtab="insights" class="${state.yearSubTab === "insights" ? "active" : ""}">Insights</button>
      <button data-action="year-subtab" data-subtab="calendar" class="${state.yearSubTab === "calendar" ? "active" : ""}">Calendar</button>
    </div>
    <div class="year-tab-body">
      <div class="year-pane year-pane-updates ${state.yearSubTab === "updates" ? "active" : ""}">${renderYearCard()}</div>
      <div class="year-pane ${state.yearSubTab === "insights" ? "active" : ""}">${renderInsights(year)}</div>
      <div class="year-pane ${state.yearSubTab === "calendar" ? "active" : ""}">${renderCalendar(year)}</div>
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
  const groups = new Map();
  for (const event of events) {
    const month = Number(event.mmdd.slice(0, 2));
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(event);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([month, monthEvents]) => {
    const rows = monthEvents.map((event) => {
      const date = new Date(`${year}-${event.mmdd}T12:00:00`);
      const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
      const category = categoryById(event.categoryId);
      const title = `${event.eventType === "plant" ? "Plant Date" : "Start Indoors"}: ${esc(category?.label || "Other")}`;
      return `<div class="plant-row cal-card"><span class="plant-avatar cal-avatar">${category?.icon || "🌱"}</span><span class="plant-main"><h3>${title}</h3><p>${esc([...event.names].join(", "))}</p></span><span class="status-pill">${dayLabel}</span></div>`;
    }).join("");
    return `<h3 class="cal-month">${monthLabel(month)}</h3><div class="plant-list">${rows}</div>`;
  }).join("");
}

function monthlyWeatherStats(weather) {
  const months = Array.from({ length: 12 }, () => ({ count: 0, highSum: 0, lowSum: 0, precipSum: 0, sunSum: 0, sunCount: 0 }));
  let hot90 = 0, hot95 = 0, cold32 = 0;
  for (const day of weather.days || []) {
    const monthIndex = Number(day.date.slice(5, 7)) - 1;
    if (!months[monthIndex]) continue;
    if (day.tempHighF != null) { months[monthIndex].highSum += day.tempHighF; months[monthIndex].count++; if (day.tempHighF >= 90) hot90++; if (day.tempHighF >= 95) hot95++; }
    if (day.tempLowF != null) { months[monthIndex].lowSum += day.tempLowF; if (day.tempLowF <= 32) cold32++; }
    if (day.precipIn != null) months[monthIndex].precipSum += day.precipIn;
    if (day.sunshineHrs != null) { months[monthIndex].sunSum += day.sunshineHrs; months[monthIndex].sunCount++; }
  }
  return {
    months: months.map((m, index) => ({ month: index + 1, avgHigh: m.count ? m.highSum / m.count : null, avgLow: m.count ? m.lowSum / m.count : null, precip: m.count ? m.precipSum : null, avgSun: m.sunCount ? m.sunSum / m.sunCount : null })),
    hot90, hot95, cold32,
  };
}

function historicalWeatherStats() {
  const byMonth = Array.from({ length: 12 }, () => ({ highs: [], lows: [], precipTotals: [], suns: [] }));
  for (const yearDoc of state.data.weather) {
    const perMonth = Array.from({ length: 12 }, () => ({ highSum: 0, highCount: 0, lowSum: 0, lowCount: 0, precipSum: 0, sunSum: 0, sunCount: 0, any: false }));
    for (const day of yearDoc.days || []) {
      const monthIndex = Number(day.date.slice(5, 7)) - 1;
      if (!perMonth[monthIndex]) continue;
      const bucket = perMonth[monthIndex];
      bucket.any = true;
      if (day.tempHighF != null) { bucket.highSum += day.tempHighF; bucket.highCount++; }
      if (day.tempLowF != null) { bucket.lowSum += day.tempLowF; bucket.lowCount++; }
      if (day.precipIn != null) bucket.precipSum += day.precipIn;
      if (day.sunshineHrs != null) { bucket.sunSum += day.sunshineHrs; bucket.sunCount++; }
    }
    perMonth.forEach((bucket, index) => {
      if (!bucket.any) return;
      if (bucket.highCount) byMonth[index].highs.push(bucket.highSum / bucket.highCount);
      if (bucket.lowCount) byMonth[index].lows.push(bucket.lowSum / bucket.lowCount);
      byMonth[index].precipTotals.push(bucket.precipSum);
      if (bucket.sunCount) byMonth[index].suns.push(bucket.sunSum / bucket.sunCount);
    });
  }
  const avg = (values) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  const monthly = byMonth.map((bucket, index) => ({ month: index + 1, avgHigh: avg(bucket.highs), avgLow: avg(bucket.lows), avgPrecip: avg(bucket.precipTotals), avgSun: avg(bucket.suns) }));
  const overallHigh = avg(monthly.map((m) => m.avgHigh).filter((v) => v != null));
  const overallLow = avg(monthly.map((m) => m.avgLow).filter((v) => v != null));
  const overallPrecip = monthly.reduce((sum, m) => sum + (m.avgPrecip || 0), 0);
  const overallSun = avg(monthly.map((m) => m.avgSun).filter((v) => v != null));
  return { monthly, overallHigh, overallLow, overallPrecip, overallSun, yearsCount: state.data.weather.length };
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
        const x = months.length > 1 ? (index / (months.length - 1)) * 100 : 50;
        const y = 100 - Math.max(0, Math.min(100, (v / axisMax) * 100));
        return [x, y];
      }).filter(Boolean);
      if (points.length < 2) return "";
      return `<path d="${smoothPath(points)}" fill="none" stroke="${h.color}" stroke-width="2" vector-effect="non-scaling-stroke" opacity="0.5"/>`;
    }).join("");
    overlaySvg = `<svg class="chart-hist-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>`;
  }
  const yAxisHtml = yAxis ? `<div class="chart-y-axis">${[4, 3, 2, 1, 0].map((i) => `<span>${Math.round((axisMax * i) / 4)}${unit}</span>`).join("")}</div>` : "";
  const gridlines = yAxis ? [1, 2, 3, 4].map((i) => `<div class="chart-gridline" style="bottom:${i * 25}%"></div>`).join("") : "";
  return `${legend}<div class="chart-plot">${yAxisHtml}<div class="chart-frame-wrap"><div class="chart-frame">${gridlines}${cols}${overlaySvg}<div class="chart-x-axis"></div></div><div class="chart-labels-row">${labelCols}</div></div></div>`;
}

function statTile(label, value) {
  return `<div class="stat-tile"><strong>${value}</strong><span>${esc(label)}</span></div>`;
}

function skel(width, height, extra = "") {
  return `<span class="skeleton" style="width:${width};height:${height};${extra}"></span>`;
}

function skeletonChartCard() {
  return `<div class="chart-card">${skel("55%", "14px", "margin-bottom:14px")}${skel("100%", "160px", "border-radius:12px")}</div>`;
}

function renderInsightsSkeleton() {
  return `<div class="insights-pane">
    <div class="insights-section"><div class="section-head">${skel("90px", "18px")}</div>${skeletonChartCard()}${skeletonChartCard()}<div class="stat-tiles">${skel("100%", "68px", "border-radius:14px")}${skel("100%", "68px", "border-radius:14px")}${skel("100%", "68px", "border-radius:14px")}</div></div>
    <div class="insights-section"><div class="section-head">${skel("110px", "18px")}</div>${skeletonChartCard()}</div>
  </div>`;
}

function skeletonPlantRows(count = 4) {
  return Array.from({ length: count }, () => `<div class="plant-row">${skel("48px", "48px", "border-radius:50%")}<span class="plant-main">${skel("60%", "14px", "margin-bottom:6px")}${skel("38%", "11px")}</span></div>`).join("");
}

function skeletonActivityRows(count = 4) {
  return Array.from({ length: count }, () => `<div class="activity-row">${skel("38px", "38px", "border-radius:50%")}<div>${skel("70%", "13px", "margin-bottom:6px")}${skel("45%", "11px")}</div></div>`).join("");
}

function skeletonTimelineRows(count = 3) {
  return Array.from({ length: count }, () => `<article class="timeline-entry">${skel("35%", "11px", "margin-bottom:8px")}${skel("100%", "13px", "margin-bottom:5px")}${skel("80%", "13px")}</article>`).join("");
}

function renderInsights(year) {
  if (!state.dataReady) return renderInsightsSkeleton();
  const weather = state.data.weather.find((w) => Number(w.year) === Number(year));
  const monthlyEntries = state.data.yearUpdates.filter((u) => u.type === "monthly" && Number(u.year) === Number(year));

  const weatherBody = weather ? (() => {
    const stats = monthlyWeatherStats(weather);
    const hist = historicalWeatherStats();
    const hasHistory = state.data.weather.some((w) => Number(w.year) !== Number(year));
    const monthsMerged = stats.months.map((m, index) => ({ ...m, histHigh: hist.monthly[index]?.avgHigh, histLow: hist.monthly[index]?.avgLow, histPrecip: hist.monthly[index]?.avgPrecip, histSun: hist.monthly[index]?.avgSun }));
    const tempChart = verticalBarChart({
      series: [{ key: "avgHigh", label: "Avg High", color: "#e34948" }, { key: "avgLow", label: "Avg Low", color: "#2a78d6" }],
      months: monthsMerged, unit: "°F", yAxis: true,
      historical: hasHistory ? [{ key: "histHigh", color: "#e34948", label: "Historical Avg High" }, { key: "histLow", color: "#2a78d6", label: "Historical Avg Low" }] : null,
    });
    const rainChart = verticalBarChart({
      series: [{ key: "precip", label: "Rainfall", color: "#1baf7a" }],
      months: monthsMerged, unit: "in", labels: true,
      historical: hasHistory ? [{ key: "histPrecip", color: "#1baf7a", label: "Historical Avg" }] : null,
    });
    const hasSunData = monthsMerged.some((m) => m.avgSun != null) || monthsMerged.some((m) => m.histSun != null);
    const sunChart = hasSunData ? verticalBarChart({
      series: [{ key: "avgSun", label: "Avg Sunshine", color: "#eda100" }],
      months: monthsMerged, unit: "hr", labels: true,
      historical: hasHistory ? [{ key: "histSun", color: "#eda100", label: "Historical Avg" }] : null,
    }) : "";
    const histSummary = hasHistory ? `<p class="hist-summary">Historical average (since 2021, ${hist.yearsCount} yr${hist.yearsCount === 1 ? "" : "s"} of data): ${hist.overallHigh != null ? hist.overallHigh.toFixed(0) : "—"}°F high · ${hist.overallLow != null ? hist.overallLow.toFixed(0) : "—"}°F low · ${hist.overallPrecip.toFixed(1)}in/yr rainfall${hist.overallSun != null ? ` · ${hist.overallSun.toFixed(1)}hr/day sunshine` : ""}</p>` : "";
    return `${histSummary}<div class="chart-card"><h4>Monthly Temperatures (avg high/low, °F)</h4>${tempChart}</div>
      <div class="chart-card"><h4>Monthly Rainfall (in)</h4>${rainChart}</div>
      ${sunChart ? `<div class="chart-card"><h4>Monthly Sunshine (avg hrs/day)</h4>${sunChart}</div>` : ""}
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
    .filter((seed) => state.seedCategory === "all" || (state.seedCategory === "year" ? plantsForSeedThisYear(seed.id).length > 0 : categoryForSeed(seed) === state.seedCategory))
    .filter((seed) => !query || seed.commonName.toLowerCase().includes(query) || seed.notes?.toLowerCase().includes(query))
    .sort((a, b) => {
      const yearDiff = (lastPlantedYear(b.id) || 0) - (lastPlantedYear(a.id) || 0);
      if (yearDiff) return yearDiff;
      const categoryDiff = categoryById(categoryForSeed(a)).label.localeCompare(categoryById(categoryForSeed(b)).label);
      if (categoryDiff) return categoryDiff;
      return a.commonName.localeCompare(b.commonName);
    });
  const cards = (seed) => {
    const activeCount = plantsForSeedThisYear(seed.id).length;
    const lastYear = lastPlantedYear(seed.id);
    const avgRating = seedAverageRating(seed);
    const caption = `${esc(seed.commonName)}${avgRating ? ` ${halfStarRatingHtml(avgRating)}` : ""}`;
    const meta = `${title(categoryForSeed(seed))}${lastYear ? ` • Last planted ${lastYear}` : ""}`;
    if (state.seedView === "grid") {
      return `<button class="seed-card" data-action="seed-details" data-id="${seed.id}"><span class="seed-card-photo" style="--plant-color:${esc(seed.color)}">${seed.coverPhoto?.url ? `<img src="${esc(seed.coverPhoto.url)}" alt="${esc(seed.commonName)} photo" loading="lazy">` : esc(iconForSeed(seed))}</span><span class="seed-card-caption"><h3>${esc(seed.commonName)}</h3><p>${avgRating ? halfStarRatingHtml(avgRating) : "—"}</p></span></button>`;
    }
    return `<button class="plant-row" data-action="seed-details" data-id="${seed.id}" style="--plant-color:${esc(seed.color)}"><span class="plant-avatar">${seedAvatarInner(seed)}</span><span class="plant-main"><h3>${caption}</h3><p>${meta}</p></span>${activeCount ? `<span class="status-pill">${activeCount} planted</span>` : ""}</button>`;
  };
  const listClass = state.seedView === "grid" ? "seed-grid" : "plant-list";
  return `<section class="tab-page content-page"><div class="page-heading"><div><h1>Seeds</h1></div><div class="page-actions">
    <div class="segmented seed-view-toggle" aria-label="Seed view"><button data-action="seed-view" data-view="list" class="${state.seedView !== "grid" ? "active" : ""}" aria-label="List view" aria-pressed="${state.seedView !== "grid"}">${icon("list")}</button><button data-action="seed-view" data-view="grid" class="${state.seedView === "grid" ? "active" : ""}" aria-label="Grid view" aria-pressed="${state.seedView === "grid"}">${icon("grid")}</button></div>
    <button class="icon-button" data-action="category-dates" aria-label="Category planting dates">${icon("settings")}</button><button class="primary-button" data-action="add-seed">Add seed</button></div></div>
    <div class="search-row"><label class="search-wrap">${icon("search")}<input id="plant-search" type="search" placeholder="Search seeds" value="${esc(state.search)}"></label></div>
    <div class="plant-category-tabs" role="tablist" aria-label="Seed categories"><button role="tab" aria-selected="${state.seedCategory === "year"}" class="${state.seedCategory === "year" ? "active" : ""}" data-action="seed-category" data-category="year">${state.year}</button><button role="tab" aria-selected="${state.seedCategory === "all"}" class="${state.seedCategory === "all" ? "active" : ""}" data-action="seed-category" data-category="all">All</button>${PLANT_CATEGORIES.map((category) => `<button role="tab" aria-selected="${state.seedCategory === category.id}" class="${state.seedCategory === category.id ? "active" : ""}" data-action="seed-category" data-category="${category.id}"><span>${category.icon}</span>${category.label}</button>`).join("")}</div>
    <div class="${listClass}">${!state.dataReady ? skeletonPlantRows() : seeds.length ? seeds.map(cards).join("") : '<div class="empty-state">No seeds match this view. Add your first seed to get started.</div>'}</div>
  </section>`;
}

function renderActivityCard() {
  const entries = [...state.data.activity].filter((entry) => Number(entry.year) === Number(state.year)).sort((a, b) => b.createdAt - a.createdAt);
  return `<section class="settings-card wide"><h2>Activity</h2><p>Everything changed in ${state.year}, and who changed it.</p><div class="activity-list">${!state.dataReady ? skeletonActivityRows() : entries.length ? entries.map((entry, index) => `<div class="activity-row"><div class="activity-badge">${entry.subjectType === "plant" ? "🌱" : entry.subjectType === "bed" ? "▦" : "✓"}</div><div><p><strong>${esc(entry.actorName || entry.actorEmail || "Someone")}</strong> ${esc(entry.action)}${entry.label && entry.label !== "Sprout" ? ` <strong>${esc(entry.label)}</strong>` : ""}${entry.undoneAt ? " <em>(undone)</em>" : ""}</p><p class="activity-meta">${entry.sourceYear ? `Copied ${entry.sourceYear} into ${entry.targetYear}` : esc(entry.actorEmail || "")}</p></div><span class="activity-time">${dateText(entry.createdAt)}${index === 0 && !yearIsReadOnly() && entry.undo?.operations?.length && !entry.undoneAt ? `<button class="text-button" data-action="undo-activity" data-id="${entry.id}">Undo</button>` : ""}</span></div>`).join("") : '<div class="empty-state">No activity has been recorded for this year yet.</div>'}</div></section>`;
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
    <section class="settings-card"><h2>App</h2>
      <p>Install Sprout to your home screen for a native app feel.</p>
      ${isStandaloneDisplay()
        ? '<p class="form-note">Already installed as an app.</p>'
        : state.installPromptAvailable
          ? `<div class="button-row"><button class="secondary-button" data-action="install-app">${icon("download")} Install app</button></div>`
          : '<p class="form-note">On iPhone/iPad: tap the Share icon in Safari, then "Add to Home Screen". On Android/desktop Chrome, an install button will appear here once the browser offers it.</p>'}
      <p>Sprout stays open like a native app, so it won't always notice a new version on its own. Refresh to grab the latest.</p>
      <div class="button-row"><button class="secondary-button" data-action="refresh-app">${icon("refresh")} Refresh app</button></div>
    </section>
    ${renderActivityCard()}
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
  if (state.modal.type === "lightbox") return renderLightbox();
  return "";
}

function modalShell(titleText, body, actions = "", large = false) {
  const anim = state.modalAnim || "";
  return `<div class="modal-layer ${anim}" data-action="modal-backdrop"><section class="modal ${large ? "large" : ""} ${anim}" role="dialog" aria-modal="true" aria-label="${esc(titleText)}"><header class="modal-header"><h2>${esc(titleText)}</h2><button class="close-button" data-action="close-modal" aria-label="Close">×</button></header><div class="modal-body">${body}</div>${actions ? `<footer class="modal-actions">${actions}</footer>` : ""}</section></div>`;
}

function renderBedModal(bed) {
  const width = splitInches(bed.widthIn);
  const height = splitInches(bed.heightIn);
  const body = `<form id="bed-form" class="form-grid"><input type="hidden" name="id" value="${bed.id}"><label class="field"><span>Width</span>${dimensionInputs("bed-width", width)}</label><label class="field"><span>Length</span>${dimensionInputs("bed-height", height)}</label><label class="field full"><span>Rotation</span><div class="choice-row"><button type="button" class="choice ${!bed.rotation ? "selected" : ""}" data-field-choice="rotation" data-value="0">0°</button><button type="button" class="choice ${Number(bed.rotation) === 90 ? "selected" : ""}" data-field-choice="rotation" data-value="90">90°</button></div><input type="hidden" name="rotation" value="${bed.rotation || 0}"></label><label class="field full"><span>Notes (optional)</span><textarea name="notes" maxlength="1000" placeholder="Anything useful about this bed…">${esc(bed.notes || "")}</textarea></label></form>`;
  const isLastBed = bedsForYear().length <= 1;
  const deleteButton = isLastBed ? `<button class="danger-button" disabled title="The last bed can’t be deleted">Delete bed</button>` : '<button class="danger-button" data-action="delete-bed">Delete bed</button>';
  return modalShell("Edit Bed", body, `${deleteButton}<button class="primary-button" type="button" data-action="save-bed">Save</button>`);
}

function seedSuggestItems(query) {
  const seeds = [...state.data.seeds].sort((a, b) => a.commonName.localeCompare(b.commonName));
  const trimmedQuery = (query || "").trim().toLowerCase();
  const matches = trimmedQuery ? seeds.filter((seed) => seed.commonName.toLowerCase().includes(trimmedQuery)) : seeds;
  return matches.length ? matches.map((seed) => `<button type="button" class="seed-suggest-item" data-action="select-seed-suggestion" data-id="${seed.id}"><span class="seed-suggest-avatar">${seedAvatarInner(seed)}</span><span>${esc(seed.commonName)}</span></button>`).join("") : '<div class="seed-suggest-empty">No matching seeds</div>';
}

function renderPlantModal(plant) {
  const initial = plant || {};
  const sizeW = splitInches(initial.widthIn || 12);
  const sizeH = splitInches(initial.heightIn || 12);
  const seeds = [...state.data.seeds].sort((a, b) => a.commonName.localeCompare(b.commonName));
  const selectedSeedId = state.modal.seedId !== undefined ? state.modal.seedId : (initial.seedId || "");
  const selectedSeed = seeds.find((seed) => seed.id === selectedSeedId);
  const query = state.modal.seedQuery ?? (selectedSeed?.commonName || "");
  const suggestList = state.modal.seedSuggestOpen ? `<div class="seed-suggest-list">${seedSuggestItems(query)}</div>` : "";
  const body = `<form id="plant-form" class="form-grid"><input type="hidden" name="id" value="${plant?.id || ""}"><input type="hidden" name="seedId" value="${esc(selectedSeedId)}"><label class="field full seed-typeahead"><span>Seed</span><input type="text" data-seed-search autocomplete="off" placeholder="Search your seeds…" value="${esc(query)}" required>${suggestList}${!selectedSeed ? '<small class="form-note">Type to search, then tap a seed to select it.</small>' : ""}</label><label class="field"><span>Plant width</span>${dimensionInputs("plant-width", sizeW)}</label><label class="field"><span>Plant length</span>${dimensionInputs("plant-height", sizeH)}</label><label class="field"><span>Status</span><select name="status">${STATUSES.map((status) => `<option value="${status}" ${status === (initial.status || "planned") ? "selected" : ""}>${title(status)}</option>`).join("")}</select></label><label class="field full"><span>Notes</span><textarea name="notes" maxlength="3000" placeholder="Anything specific to this planting…">${esc(initial.notes || "")}</textarea></label></form>`;
  const archive = plant ? `<button class="${plant.archived ? "secondary-button" : "danger-button"}" data-action="archive-plant" data-id="${plant.id}">${plant.archived ? "Restore" : "Archive"}</button>` : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(plant ? `Edit ${seedFor(plant).commonName || "Plant"}` : "Add a Plant", body, `${archive}<button class="primary-button" type="button" data-action="save-plant">Save</button>`, true);
}

function renderSeedModal(seed) {
  const initial = seed || {};
  const commonName = initial.commonName || "";
  const selectedCategory = initial.category || initial.icon ? categoryForSeed(initial) : PLANT_CATEGORIES[0].id;
  const selectedIcon = categoryById(selectedCategory).icon;
  const selectedColor = initial.color || COLORS[0];
  const body = `<form id="seed-form" class="form-grid"><input type="hidden" name="id" value="${seed?.id || ""}"><label class="field full"><span>Common name</span><input id="seed-name" name="commonName" value="${esc(commonName)}" maxlength="80" autocomplete="off" required></label><label class="field full"><span>Category</span><div class="choice-row plant-category-choices">${PLANT_CATEGORIES.map((category) => `<button type="button" class="choice plant-category-choice ${category.id === selectedCategory ? "selected" : ""}" data-field-choice="category" data-value="${category.id}" data-icon="${category.icon}"><span>${category.icon}</span><small>${category.label}</small></button>`).join("")}</div><input type="hidden" name="category" value="${selectedCategory}"><input type="hidden" name="icon" value="${esc(selectedIcon)}"></label><label class="field full"><span>Colour</span><div class="choice-row">${COLORS.map((item) => `<button type="button" class="color-choice ${item === selectedColor ? "selected" : ""}" style="--choice-color:${item}" data-field-choice="color" data-value="${item}" aria-label="${item}"></button>`).join("")}</div><input type="hidden" name="color" value="${selectedColor}"></label><label class="field full"><span>Taste</span><div class="rating-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star ${initial.tasteRating && n <= initial.tasteRating ? "selected" : ""}" data-rating-choice data-seed="taste" data-value="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div><input type="hidden" name="rating-taste" value="${initial.tasteRating || ""}"></label><label class="field full"><span>Productivity</span><div class="rating-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star ${initial.productivityRating && n <= initial.productivityRating ? "selected" : ""}" data-rating-choice data-seed="productivity" data-value="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div><input type="hidden" name="rating-productivity" value="${initial.productivityRating || ""}"></label><label class="field full"><span>Seed link</span><input name="seedLink" type="url" placeholder="https://…" value="${esc(initial.seedLink || "")}"></label><label class="field full"><span>Notes</span><textarea name="notes" maxlength="3000" placeholder="Care details, source, or anything useful…">${esc(initial.notes || "")}</textarea></label></form>`;
  const deleteButton = seed ? '<button class="danger-button" data-action="delete-seed" data-id="'+seed.id+'">Delete seed</button>' : '<button class="secondary-button" data-action="close-modal">Cancel</button>';
  return modalShell(seed ? `Edit ${seed.commonName}` : "Add a Seed", body, `${deleteButton}<button class="primary-button" type="button" data-action="save-seed">Save</button>`, true);
}

function seedGalleryPhotos(seedId) {
  return state.data.plants
    .filter((plant) => plant.seedId === seedId)
    .flatMap((plant) => (plant.photos || []).map((photo) => ({ ...photo, plantId: plant.id })))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderSeedDetails(seed) {
  if (!seed) return "";
  const plants = plantsForSeedThisYear(seed.id);
  const categoryId = categoryForSeed(seed);
  const dates = categoryDatesFor(categoryId);
  const gallery = seedGalleryPhotos(seed.id);
  const heroIcon = seed.coverPhoto
    ? `<button type="button" class="detail-icon photo-tap" style="--plant-color:${esc(seed.color)}" data-action="open-lightbox" data-gallery="seed-cover" data-gallery-id="${seed.id}" aria-label="View cover photo">${seedAvatarInner(seed)}</button>`
    : `<div class="detail-icon" style="--plant-color:${esc(seed.color)}">${seedAvatarInner(seed)}</div>`;
  const body = `<div class="detail-hero">${heroIcon}<div class="detail-title"><h2>${esc(seed.commonName)}</h2><p>${title(categoryId)}</p></div><div class="detail-actions"><label class="text-button">${seed.coverPhoto ? "Change photo" : "Add photo"}<input class="hidden" type="file" accept="image/*" data-seed-cover="${seed.id}"></label><button class="secondary-button" data-action="edit-seed" data-id="${seed.id}">Edit</button></div></div><div class="fact-grid"><div class="fact"><span>Plant date</span><strong>📅 ${monthDayLabel(dates.plantDate)}</strong></div>${dates.startIndoors ? `<div class="fact"><span>Start indoors</span><strong>📅 ${monthDayLabel(dates.startIndoorsDate)}</strong></div>` : ""}<div class="fact"><span>Seed link</span><strong>${safeHttpUrl(seed.seedLink) ? `🔗 <a href="${esc(safeHttpUrl(seed.seedLink))}" target="_blank" rel="noopener noreferrer">Buy</a>` : "🔗 —"}</strong></div><div class="fact"><span>Taste</span><strong>${seed.tasteRating ? starRatingHtml(seed.tasteRating) : "—"}</strong></div><div class="fact"><span>Productivity</span><strong>${seed.productivityRating ? starRatingHtml(seed.productivityRating) : "—"}</strong></div></div>${seed.notes ? `<div class="section-head"><h3>Notes</h3></div><div class="notes-box">${esc(seed.notes)}</div>` : ""}<div class="section-head"><h3>Photos</h3></div><div class="photo-grid">${gallery.length ? gallery.map((photo, index) => `<div class="photo"><img src="${esc(photo.url)}" alt="${esc(seed.commonName || "Seed")} photo" loading="lazy" data-action="open-lightbox" data-gallery="seed-gallery" data-gallery-id="${seed.id}" data-index="${index}"></div>`).join("") : '<div class="form-note" style="grid-column:1/-1">No photos yet.</div>'}</div><div class="section-head"><h3>Plants in ${state.year}</h3></div><div class="plant-list">${plants.length ? plants.map((plant) => `<button class="plant-row" data-action="plant-details" data-id="${plant.id}" style="--plant-color:${esc(seed.color)}"><span class="plant-avatar">${seedAvatarInner(seed)}</span><span class="plant-main"><h3>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</h3><p>${plant.notes ? esc(plant.notes) : "No notes"}</p></span><span class="status-pill ${esc(plant.status)}">${esc(plant.status)}</span></button>`).join("") : '<div class="form-note">No active plants from this seed in the current year.</div>'}</div>`;
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

function renderPlantDetails(plant) {
  if (!plant) return "";
  const seed = seedFor(plant);
  const dates = categoryDatesFor(categoryForSeed(seed));
  const logs = state.data.logs.filter((entry) => entry.plantId === plant.id).sort((a, b) => b.createdAt - a.createdAt);
  const body = `<div class="detail-hero"><div class="detail-icon" style="--plant-color:${esc(seed.color)}">${seedAvatarInner(seed)}</div><div class="detail-title"><h2>${esc(seed.commonName || "Plant")}</h2><p>${title(plant.status)}</p></div>${yearIsReadOnly() ? "" : `<div class="detail-actions"><button class="secondary-button" data-action="edit-plant" data-id="${plant.id}">Edit</button></div>`}</div><div class="fact-grid"><div class="fact"><span>Size</span><strong>${dimensions(plant.widthIn)} × ${dimensions(plant.heightIn)}</strong></div><div class="fact"><span>Plant date</span><strong>${dates.plantDate ? shortDate(`${plant.year}-${dates.plantDate}`) : "Not set"}</strong></div>${dates.startIndoors ? `<div class="fact"><span>Start indoors</span><strong>${dates.startIndoorsDate ? shortDate(`${plant.year}-${dates.startIndoorsDate}`) : "Not set"}</strong></div>` : ""}</div><div class="section-head"><h3>Seed</h3><button class="text-button" data-action="seed-details" data-id="${seed.id}">View seed</button></div>${plant.notes ? `<div class="section-head"><h3>Notes</h3></div><div class="notes-box">${esc(plant.notes)}</div>` : ""}<div class="section-head"><h3>Photos</h3>${yearIsReadOnly() ? "" : `<label class="text-button">Add photo<input class="hidden" type="file" accept="image/*" data-photo-plant="${plant.id}"></label>`}</div><div class="photo-grid">${(plant.photos || []).map((photo, index) => `<div class="photo"><img src="${esc(photo.url)}" alt="${esc(seed.commonName || "Plant")} photo" loading="lazy" data-action="open-lightbox" data-gallery="plant" data-gallery-id="${plant.id}" data-index="${index}">${yearIsReadOnly() ? "" : `<button class="photo-delete" data-action="delete-photo" data-id="${plant.id}" data-index="${index}" aria-label="Delete photo">×</button>`}</div>`).join("")}${!(plant.photos || []).length ? '<div class="form-note" style="grid-column:1/-1">No photos yet.</div>' : ""}</div><div class="section-head"><h3>Journal</h3>${yearIsReadOnly() ? "" : `<button class="text-button" data-action="add-log" data-id="${plant.id}">Add entry</button>`}</div><div class="journal-list">${logs.length ? logs.map((entry) => `<article class="journal-entry"><div class="journal-head"><span class="journal-type">${esc(entry.type)}</span><span class="journal-date">${dateText(entry.createdAt)}</span></div>${entry.note ? `<p>${esc(entry.note)}</p>` : ""}${entry.photos?.[0] ? `<img class="journal-photo" src="${esc(entry.photos[0].url)}" alt="Journal photo" loading="lazy">` : ""}<div class="journal-meta">${esc(entry.actorName || entry.actorEmail || "Someone")}${yearIsReadOnly() ? "" : ` · <button class="text-button" data-action="delete-log" data-id="${entry.id}">Delete</button>`}</div></article>`).join("") : '<div class="form-note">No journal entries yet.</div>'}</div>`;
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

function renderLightbox() {
  const { photos, index } = state.modal;
  const photo = photos[index];
  if (!photo) return "";
  const anim = state.modalAnim || "";
  const showNav = photos.length > 1;
  return `<div class="lightbox-layer ${anim}" data-action="modal-backdrop">
    <button class="lightbox-close" data-action="close-modal" aria-label="Close">${icon("close")}</button>
    ${showNav ? `<button class="lightbox-nav lightbox-prev" data-action="lightbox-prev" aria-label="Previous photo">${icon("chevron-left")}</button>` : ""}
    <img class="lightbox-image" src="${esc(photo.url)}" alt="Photo">
    ${showNav ? `<button class="lightbox-nav lightbox-next" data-action="lightbox-next" aria-label="Next photo">${icon("chevron-right")}</button>` : ""}
    ${photo.createdAt ? `<div class="lightbox-caption">${dateText(photo.createdAt)}</div>` : ""}
  </div>`;
}

function openModal(modal) {
  state.modal = modal;
  state.modalAnim = "opening";
  render();
  state.modalAnim = null;
  requestAnimationFrame(() => $(".modal input:not([type=hidden]),.modal select,.modal textarea")?.focus());
}
function closeModal() {
  if (!state.modal) return;
  state.modalAnim = "closing";
  render();
  setTimeout(() => { state.modal = null; state.modalAnim = null; render(); }, 240);
}

async function ensureInitialYear() {
  if (!state.user || ensuringInitialYear || !state.data.yearsLoaded) return;
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
  if (!existing) throw new Error("The bed editor could not be found. Close it and try again.");
  const widthIn = snap(toInches(values.get("bed-width-ft"), values.get("bed-width-in")));
  const heightIn = snap(toInches(values.get("bed-height-ft"), values.get("bed-height-in")));
  if (widthIn < 12 || heightIn < 12) throw new Error("Beds must be at least one foot in each direction.");
  const saving = window.SproutStore.saveBed({ ...existing, widthIn, heightIn, rotation: Number(values.get("rotation")), notes: values.get("notes") });
  state.modal = null;
  state.mode = "layout";
  render();
  await saving;
  saveFlash();
  toast("Bed updated.");
}

async function savePlant(form) {
  const values = new FormData(form);
  const existing = state.data.plants.find((item) => item.id === values.get("id"));
  const seed = state.data.seeds.find((item) => item.id === values.get("seedId"));
  if (!seed) throw new Error("Search for a seed and tap it to select it.");
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
  saveFlash();
  toast(existing ? "Plant updated." : "Plant added. Drag it into place in Plants mode.");
}

async function saveSeed(form) {
  const values = new FormData(form);
  const existing = state.data.seeds.find((item) => item.id === values.get("id"));
  const commonName = String(values.get("commonName") || "").trim();
  const category = categoryById(values.get("category"))?.id || "greens";
  const seedIcon = categoryById(category).icon;
  const tasteRating = values.get("rating-taste");
  const productivityRating = values.get("rating-productivity");
  const seedLinkInput = String(values.get("seedLink") || "").trim();
  if (seedLinkInput && !safeHttpUrl(seedLinkInput)) throw new Error("Seed link must be a valid http:// or https:// URL.");
  const seed = { id: existing?.id, commonName, category, icon: seedIcon, color: values.get("color"), tasteRating: tasteRating ? Number(tasteRating) : null, productivityRating: productivityRating ? Number(productivityRating) : null, seedLink: seedLinkInput, notes: values.get("notes") };
  const saved = await window.SproutStore.saveSeed(seed);
  state.modal = { type: "seedDetails", id: saved.id };
  render();
  saveFlash();
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
  saveFlash();
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
  saveFlash();
  toast(`${monthLabel(month)} update saved.`);
}

function latestCachedDate() {
  let latest = null;
  for (const yearDoc of state.data.weather) {
    for (const day of yearDoc.days || []) {
      if (!latest || day.date > latest) latest = day.date;
    }
  }
  return latest;
}

async function fetchWeatherHistory() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const latest = latestCachedDate();
  const start = latest ? new Date(new Date(latest + "T00:00:00").getTime() + 86400000).toISOString().slice(0, 10) : "2021-01-01";
  if (start > yesterday) return;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${GARDEN_LOCATION.lat}&longitude=${GARDEN_LOCATION.lon}&start_date=${start}&end_date=${yesterday}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FLos_Angeles`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch weather data.");
  const json = await response.json();
  const byYear = new Map();
  const times = json.daily?.time || [];
  for (let index = 0; index < times.length; index++) {
    const date = times[index];
    const year = Number(date.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    const sunshineSeconds = json.daily.sunshine_duration?.[index];
    byYear.get(year).push({
      date,
      tempHighF: json.daily.temperature_2m_max[index],
      tempLowF: json.daily.temperature_2m_min[index],
      precipIn: json.daily.precipitation_sum[index],
      sunshineHrs: sunshineSeconds != null ? sunshineSeconds / 3600 : null,
    });
  }
  for (const [year, newDays] of byYear) {
    const existingYear = state.data.weather.find((w) => Number(w.year) === year);
    const mergedDays = existingYear ? [...existingYear.days.filter((d) => !newDays.some((nd) => nd.date === d.date)), ...newDays].sort((a, b) => a.date.localeCompare(b.date)) : newDays;
    await window.SproutStore.saveWeatherYear(year, mergedDays);
  }
}

async function saveYearUpdate(form) {
  const values = new FormData(form);
  const year = Number(values.get("year"));
  const text = String(values.get("text") || "").trim();
  const file = values.get("photo");
  if (!text && !file?.size) throw new Error("Add a note or a photo before saving.");
  const photo = file?.size ? await uploadPhoto(file, `update-${year}-${Date.now()}`) : null;
  await window.SproutStore.addYearUpdate({ year, date: values.get("date"), text, photo });
  state.addUpdateOpen = false;
  render();
  saveFlash();
  toast("Update added.");
}

async function saveLog(form) {
  const values = new FormData(form);
  const plant = state.data.plants.find((item) => item.id === values.get("plantId"));
  let photos = [];
  const file = values.get("photo");
  if (file?.size) photos = [await uploadPhoto(file, plant.id)];
  await window.SproutStore.addLog({ plantId: plant.id, year: plant.year, type: values.get("type"), note: values.get("note"), photos });
  state.modal = { type: "details", id: plant.id }; render();
  if (values.get("type") === "harvested") confettiBurst(); else saveFlash();
  toast("Journal entry added.");
}

async function duplicateYear(form) {
  const values = new FormData(form);
  const target = Number(values.get("targetYear"));
  await window.SproutStore.duplicateYear(Number(values.get("sourceYear")), target);
  state.year = target; state.selected = null; state.modal = null; state.mode = "browse"; state.map.initializedYear = null; render(); saveFlash();
  toast(`${target} is now the active garden plan.`);
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
  const apply = () => { world.style.transform = `translate3d(${state.map.panX}px,${state.map.panY}px,0)`; };
  const fit = () => {
    const width = state.data.settings.widthIn * PX_PER_INCH;
    const height = state.data.settings.heightIn * PX_PER_INCH;
    const zoom = clamp(Math.min((viewport.clientWidth - 36) / width, (viewport.clientHeight - 36) / height), .22, 2.5);
    state.map.zoom = zoom;
    state.map.panX = (viewport.clientWidth - width * zoom) / 2;
    state.map.panY = (viewport.clientHeight - height * zoom) / 2;
    state.map.initializedYear = state.year;
    render();
  };
  const resetView = () => {
    const width = state.data.settings.widthIn * PX_PER_INCH;
    const height = state.data.settings.heightIn * PX_PER_INCH;
    state.map.zoom = 1;
    state.map.panX = Math.max(20, (viewport.clientWidth - width) / 2);
    state.map.panY = Math.max(20, (viewport.clientHeight - height) / 2);
    state.map.initializedYear = state.year;
    render();
  };
  if (state.map.initializedYear !== state.year) resetView(); else apply();
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
    render();
  };

  const pointers = new Map();
  let interaction = null;
  let inertiaRAF = null;
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const findItem = (kind, itemId) => (kind === "bed" ? state.data.beds.find((entry) => entry.id === itemId) : state.data.plants.find((entry) => entry.id === itemId));
  const stopInertia = () => { if (inertiaRAF) { cancelAnimationFrame(inertiaRAF); inertiaRAF = null; } };
  const runInertia = (vx, vy) => {
    let lastT = performance.now();
    const step = (now) => {
      if (!world.isConnected) { inertiaRAF = null; return; }
      const dt = Math.min(48, now - lastT);
      lastT = now;
      const decay = Math.pow(0.94, dt / 16.67);
      vx *= decay; vy *= decay;
      state.map.panX += vx * dt;
      state.map.panY += vy * dt;
      apply();
      if (Math.hypot(vx, vy) > 0.02) inertiaRAF = requestAnimationFrame(step);
      else inertiaRAF = null;
    };
    inertiaRAF = requestAnimationFrame(step);
  };
  viewport.onpointerdown = (event) => {
    if (event.target.closest(".selection-card,button,input,select,textarea,label")) return;
    stopInertia();
    pointers.set(event.pointerId, point(event));
    viewport.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      interaction?.node?.classList.remove("item-lifted");
      const [p1, p2] = [...pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const bakedZoom = state.map.zoom;
      interaction = {
        type: "pinch",
        startDist: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
        bakedZoom,
        anchorInchX: (midX - state.map.panX) / (bakedZoom * PX_PER_INCH),
        anchorInchY: (midY - state.map.panY) / (bakedZoom * PX_PER_INCH),
        pendingZoom: bakedZoom,
        pendingPanX: state.map.panX,
        pendingPanY: state.map.panY,
      };
      return;
    }
    if (pointers.size > 2) return;
    const handle = event.target.closest("[data-resize]");
    if (handle) {
      const kind = handle.dataset.resize;
      const handleId = handle.dataset.id;
      const allowed = !yearIsReadOnly() && ((kind === "bed" && state.mode === "layout") || (kind === "plant" && state.mode === "plants"));
      if (allowed) {
        const item = findItem(kind, handleId);
        const node = handle.closest(kind === "bed" ? ".bed-wrap" : ".plant-marker");
        node?.classList.add("item-lifted");
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
        target.classList.add("item-lifted");
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
    if (pointers.size >= 2) {
      if (interaction?.type === "pinch") {
        const [p1, p2] = [...pointers.values()];
        const rect = viewport.getBoundingClientRect();
        const midX = (p1.x + p2.x) / 2 - rect.left;
        const midY = (p1.y + p2.y) / 2 - rect.top;
        const currentDist = Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y));
        const targetZoom = clamp(interaction.bakedZoom * (currentDist / interaction.startDist), .2, 4);
        const liveFactor = targetZoom / interaction.bakedZoom;
        const panX = midX - targetZoom * PX_PER_INCH * interaction.anchorInchX;
        const panY = midY - targetZoom * PX_PER_INCH * interaction.anchorInchY;
        interaction.pendingZoom = targetZoom;
        interaction.pendingPanX = panX;
        interaction.pendingPanY = panY;
        world.style.transform = `translate3d(${panX}px,${panY}px,0) scale(${liveFactor})`;
      }
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
      const now = performance.now();
      if (interaction.lastT != null) {
        const dt = now - interaction.lastT;
        if (dt > 0) {
          interaction.vx = (event.clientX - interaction.lastX) / dt;
          interaction.vy = (event.clientY - interaction.lastY) / dt;
        }
      }
      interaction.lastT = now;
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
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
      interaction.node.style.left = `${x * PX_PER_INCH * state.map.zoom}px`;
      interaction.node.style.top = `${y * PX_PER_INCH * state.map.zoom}px`;
      interaction.node.style.width = `${w * PX_PER_INCH * state.map.zoom}px`;
      interaction.node.style.height = `${h * PX_PER_INCH * state.map.zoom}px`;
      return;
    }
    const item = findItem(interaction.type, interaction.id);
    const parent = state.data.settings;
    const maxX = parent.widthIn - item.widthIn;
    const maxY = parent.heightIn - item.heightIn;
    const x = clamp(snap(interaction.originalX + dx / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxX));
    const y = clamp(snap(interaction.originalY + dy / state.map.zoom / PX_PER_INCH), 0, Math.max(0,maxY));
    interaction.nextX = x; interaction.nextY = y;
    interaction.node.style.left = `${x * PX_PER_INCH * state.map.zoom}px`;
    interaction.node.style.top = `${y * PX_PER_INCH * state.map.zoom}px`;
  };
  viewport.onpointerup = async (event) => {
    pointers.delete(event.pointerId);
    viewport.classList.remove("dragging");
    if (interaction?.type === "pinch") {
      if (pointers.size < 2) {
        state.map.zoom = interaction.pendingZoom;
        state.map.panX = interaction.pendingPanX;
        state.map.panY = interaction.pendingPanY;
        interaction = null;
        render();
      }
      return;
    }
    interaction?.node?.classList.remove("item-lifted");
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
    } else if (interaction?.type === "pan" && interaction.moved && (Math.abs(interaction.vx) > 0.05 || Math.abs(interaction.vy) > 0.05)) {
      runInertia(interaction.vx || 0, interaction.vy || 0);
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
    if (action === "tab") {
      const nextTab = button.dataset.tab;
      document.documentElement.dataset.navDir = TAB_ORDER.indexOf(nextTab) >= TAB_ORDER.indexOf(state.tab) ? "fwd" : "back";
      withTransition("tab", () => { state.tab = nextTab; state.selected = null; state.modal = null; render(); });
    }
    if (action === "seed-category") { state.seedCategory = button.dataset.category; render(); }
    if (action === "seed-view") { state.seedView = button.dataset.view; render(); }
    if (action === "year-subtab") { state.yearSubTab = button.dataset.subtab; render(); }
    if (action === "mode") { state.mode = button.dataset.mode; state.selected = null; render(); }
    if (action === "edit-bed") openModal({ type: "bed", id: button.dataset.id });
    if (action === "add-plant") { if (!state.data.seeds.length) throw new Error("Add a seed first."); openModal({ type: "plant" }); }
    if (action === "edit-plant") openModal({ type: "plant", id: button.dataset.id });
    if (action === "plant-details") openModal({ type: "details", id: button.dataset.id });
    if (action === "add-log") openModal({ type: "log", id: button.dataset.id });
    if (action === "add-seed") openModal({ type: "seed" });
    if (action === "edit-seed") openModal({ type: "seed", id: button.dataset.id });
    if (action === "seed-details") openModal({ type: "seedDetails", id: button.dataset.id });
    if (action === "open-lightbox") {
      const source = button.dataset.gallery;
      let photos = [];
      if (source === "plant") { const plant = state.data.plants.find((item) => item.id === button.dataset.galleryId); photos = plant?.photos || []; }
      else if (source === "seed-gallery") { photos = seedGalleryPhotos(button.dataset.galleryId); }
      else if (source === "seed-cover") { const seed = seedById(button.dataset.galleryId); photos = seed?.coverPhoto ? [seed.coverPhoto] : []; }
      else if (source === "year-update") { photos = yearUpdatePhotos(Number(button.dataset.galleryId)); }
      if (photos.length) {
        const index = Math.min(Number(button.dataset.index || 0), photos.length - 1);
        openModal({ type: "lightbox", photos, index });
      }
    }
    if (action === "lightbox-prev" && state.modal) { state.modal.index = (state.modal.index - 1 + state.modal.photos.length) % state.modal.photos.length; render(); }
    if (action === "lightbox-next" && state.modal) { state.modal.index = (state.modal.index + 1) % state.modal.photos.length; render(); }
    if (action === "select-seed-suggestion") {
      const seed = seedById(button.dataset.id);
      if (seed && state.modal) { state.modal.seedId = seed.id; state.modal.seedQuery = seed.commonName; state.modal.seedSuggestOpen = false; }
      render();
    }
    if (action === "category-dates") openModal({ type: "categoryDates" });
    if (action === "log-monthly-update") openModal({ type: "monthlyUpdate", year: state.year, month: defaultMonthlyMonth(state.year) });
    if (action === "toggle-add-update") { state.addUpdateOpen = true; render(); }
    if (action === "cancel-add-update") { state.addUpdateOpen = false; render(); }
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
    if (action === "duplicate-plant") { copySelected(); await pasteClipboard(); }
    if (action === "view-year") {
      document.documentElement.dataset.navDir = TAB_ORDER.indexOf("garden") >= TAB_ORDER.indexOf(state.tab) ? "fwd" : "back";
      withTransition("tab", () => { state.year = Number(button.dataset.year); state.tab = "garden"; state.map.initializedYear = null; render(); });
    }
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
    if (action === "delete-bed") {
      const bed = state.data.beds.find((item) => item.id === state.modal.id);
      if (bedsForYear().length <= 1) { toast("The last bed can’t be deleted.", "error"); return; }
      state.modal = { type: "confirm", title: "Delete this bed?", message: "This removes the bed from the grid. It is purely visual and does not affect any plants.", confirmLabel: "Delete bed", run: async () => { await window.SproutStore.deleteBed(bed); state.selected = null; } };
      render();
    }
    if (action === "delete-seed") { const seed = state.data.seeds.find((item) => item.id === button.dataset.id); state.modal = { type: "confirm", title: `Delete ${seed.commonName}?`, message: "This removes the seed. Plants already using it will keep their history but lose their seed details.", confirmLabel: "Delete seed", run: async () => { await window.SproutStore.deleteSeed(seed); state.selected = null; } }; render(); }
    if (action === "archive-plant") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); await window.SproutStore.archivePlant(plant, !plant.archived); state.modal = null; state.selected = null; render(); toast(plant.archived ? "Plant restored." : "Plant moved to the archive."); }
    if (action === "set-plant-status") {
      const plant = state.data.plants.find((item) => item.id === button.dataset.id);
      await window.SproutStore.savePlant({ ...plant, status: button.dataset.status });
      render();
      saveFlash();
    }
    if (action === "delete-log") { const log = state.data.logs.find((item) => item.id === button.dataset.id); if (confirm("Delete this journal entry?")) { await window.SproutStore.deleteLog(log); render(); } }
    if (action === "delete-photo") { const plant = state.data.plants.find((item) => item.id === button.dataset.id); if (confirm("Remove this photo from the plant?")) { await window.SproutStore.savePlant({ ...plant, photos: plant.photos.filter((_, index) => index !== Number(button.dataset.index)) }); render(); } }
    if (action === "delete-year-update") { const entry = state.data.yearUpdates.find((item) => item.id === button.dataset.id); if (confirm("Delete this update?")) { await window.SproutStore.deleteYearUpdate(entry); render(); } }
    if (action === "undo-activity") { const entry = state.data.activity.find((item) => item.id === button.dataset.id); await window.SproutStore.undoLast(entry); toast("Last action undone."); }
    if (action === "confirm-action") { const run = state.modal.run; await run(); state.modal = null; render(); }
    if (action === "install-app") {
      if (!deferredInstallPrompt) return;
      button.disabled = true;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      state.installPromptAvailable = false;
      render();
      if (choice.outcome === "accepted") toast("Sprout installed.");
    }
    if (action === "refresh-app") {
      button.disabled = true;
      button.textContent = "Refreshing…";
      await refreshApp();
    }
    if (action === "export") exportBackup();
    if (action === "import") importBackup();
  } catch (error) {
    toast(error?.message || "Sprout couldn’t save that change.", "error");
    button.disabled = false;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches('[data-action="change-year"]')) { state.year = Number(event.target.value); state.selected = null; state.map.initializedYear = null; state.addUpdateOpen = false; if (yearIsReadOnly()) state.mode = "browse"; render(); }
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
  if (event.target.matches("[data-seed-cover]")) {
    const seed = seedById(event.target.dataset.seedCover);
    const file = event.target.files?.[0];
    if (!file || !seed) return;
    try { toast("Preparing photo…"); const photo = await uploadPhoto(file, `seed-${seed.id}`); await window.SproutStore.saveSeed({ ...seed, coverPhoto: photo }); render(); toast("Cover photo updated."); } catch (error) { toast(error.message || "Photo upload failed.", "error"); }
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
  if (event.target.matches("[data-seed-search]") && state.modal) {
    state.modal.seedQuery = event.target.value;
    state.modal.seedId = "";
    state.modal.seedSuggestOpen = true;
    const label = event.target.closest(".seed-typeahead");
    if (label) {
      const hiddenSeedId = $("[name=seedId]");
      if (hiddenSeedId) hiddenSeedId.value = "";
      let list = label.querySelector(".seed-suggest-list");
      if (!list) {
        list = document.createElement("div");
        list.className = "seed-suggest-list";
        event.target.insertAdjacentElement("afterend", list);
      }
      list.innerHTML = seedSuggestItems(state.modal.seedQuery);
      if (!label.querySelector(".form-note")) {
        const note = document.createElement("small");
        note.className = "form-note";
        note.textContent = "Type to search, then tap a seed to select it.";
        label.appendChild(note);
      }
    } else {
      const position = event.target.selectionStart;
      render();
      requestAnimationFrame(() => {
        const input = $("[data-seed-search]");
        input?.focus();
        input?.setSelectionRange(position, position);
      });
    }
  }
});

document.addEventListener("focusin", (event) => {
  if (!event.target.matches("[data-seed-search]") || !state.modal || state.modal.seedSuggestOpen) return;
  state.modal.seedSuggestOpen = true;
  const position = event.target.selectionStart;
  render();
  requestAnimationFrame(() => {
    const input = $("[data-seed-search]");
    input?.focus();
    input?.setSelectionRange(position, position);
  });
});

document.addEventListener("focusout", (event) => {
  if (!event.target.matches("[data-seed-search]")) return;
  setTimeout(() => {
    if (state.modal?.seedSuggestOpen && !document.activeElement?.matches("[data-seed-search]")) {
      state.modal.seedSuggestOpen = false;
      render();
    }
  }, 160);
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
    if (bed) { state.clipboard = { type: "bed", data: bed }; toast("Bed copied."); }
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
    if (number > 10 || bedsForYear().length >= 10) { toast("This year already has the maximum of 10 beds.", "error"); return; }
    const saved = await window.SproutStore.saveBed({ year: state.year, number, widthIn: source.widthIn, heightIn: source.heightIn, rotation: source.rotation, notes: source.notes, x, y });
    state.selected = { type: "bed", id: saved.id };
    render();
    saveFlash();
    toast("Bed added.");
  } else if (state.clipboard.type === "plant" && state.mode === "plants") {
    const saved = await window.SproutStore.savePlant({ year: state.year, seedId: source.seedId, widthIn: source.widthIn, heightIn: source.heightIn, status: source.status, notes: source.notes, x, y });
    state.selected = { type: "plant", id: saved.id };
    render();
    toast("Plant pasted.");
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) { closeModal(); return; }
  if (state.modal?.type === "lightbox" && state.modal.photos.length > 1) {
    if (event.key === "ArrowLeft") { state.modal.index = (state.modal.index - 1 + state.modal.photos.length) % state.modal.photos.length; render(); return; }
    if (event.key === "ArrowRight") { state.modal.index = (state.modal.index + 1) % state.modal.photos.length; render(); return; }
  }
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
window.addEventListener("sprout:data", (event) => { state.data = event.detail; state.dataReady = true; if (!state.year) state.year = Number(state.data.settings.activeYear || CURRENT_YEAR); render(); if (state.user) { ensureInitialYear(); ensureWeatherFresh(); } });
window.addEventListener("sprout:error", (event) => toast(event.detail, "error"));

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));

async function refreshApp() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } finally {
    window.location.href = `${window.location.pathname}?refresh=${Date.now()}`;
  }
}
render();
if (state.user) { ensureInitialYear(); ensureWeatherFresh(); }
