import { initializeApp } from "./vendor/firebase-app.js";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "./vendor/firebase-auth.js";
import {
  initializeFirestore,
  collection,
  doc,
  onSnapshot,
  writeBatch,
} from "./vendor/firebase-firestore.js";
import { FIREBASE_CONFIG, SPROUT_CONFIG } from "./config.js";

const configured = !Object.values(FIREBASE_CONFIG).some((value) => String(value).startsWith("PASTE_"));
const event = (name, detail) => window.dispatchEvent(new CustomEvent(`sprout:${name}`, { detail }));

let auth = null;
let db = null;
let stops = [];
let data = {
  settings: { widthIn: 360, heightIn: 240, gridIn: 6, activeYear: new Date().getFullYear() },
  categoryDates: {},
  years: [],
  beds: [],
  seeds: [],
  plants: [],
  logs: [],
  yearUpdates: [],
  weather: [],
  activity: [],
  fromCache: false,
};

const emit = () => {
  window.SproutData = data;
  event("data", data);
};

const actor = () => ({
  actorUid: auth?.currentUser?.uid || "",
  actorEmail: auth?.currentUser?.email || "",
  actorName: auth?.currentUser?.displayName || auth?.currentUser?.email?.split("@")[0] || "Someone",
});

const now = () => Date.now();
const id = () => crypto.randomUUID();
const refs = {};
const activityEntry = (action, subject, extra = {}) => ({
  id: id(),
  action,
  subjectType: subject?.subjectType || extra.subjectType || "garden",
  subjectId: subject?.id || extra.subjectId || "",
  label: subject?.commonName || subject?.label || subject?.number ? String(subject.commonName || subject.label || `Bed ${subject.number}`) : "Sprout",
  year: Number(subject?.year || extra.year || data.settings.activeYear),
  createdAt: now(),
  ...actor(),
  ...extra,
});

function requireUser() {
  if (!auth?.currentUser) throw new Error("Sign in to save changes.");
}

function patchLocal(key, item, remove = false) {
  const previous = data[key];
  data = {
    ...data,
    [key]: remove
      ? previous.filter((entry) => entry.id !== item.id)
      : [...previous.filter((entry) => entry.id !== item.id), item],
  };
  emit();
  return previous;
}

async function commitDocument(key, item, options = {}) {
  requireUser();
  const previous = patchLocal(key, item, options.remove);
  const beforeItem = previous.find((entry) => entry.id === item.id);
  const batch = writeBatch(db);
  if (options.remove) batch.delete(doc(refs[key], item.id));
  else batch.set(doc(refs[key], item.id), item);
  if (options.activity) {
    const undo = options.remove
      ? { operations: [{ key, kind: "set", item }] }
      : beforeItem
        ? { operations: [{ key, kind: "set", item: beforeItem }] }
        : { operations: [{ key, kind: "delete", id: item.id }] };
    const entry = activityEntry(options.activity, item, { ...options.activityExtra, undo });
    batch.set(doc(refs.activity, entry.id), entry);
  }
  try {
    await batch.commit();
  } catch (error) {
    data = { ...data, [key]: previous };
    emit();
    throw error;
  }
  return item;
}

async function commitMany(operations, activity) {
  requireUser();
  const batch = writeBatch(db);
  for (const operation of operations) {
    const reference = doc(refs[operation.key], operation.item.id);
    if (operation.remove) batch.delete(reference);
    else batch.set(reference, operation.item);
  }
  if (activity) batch.set(doc(refs.activity, activity.id), activity);
  await batch.commit();
}

function subscribe(key, fallback) {
  stops.push(onSnapshot(
    refs[key],
    { includeMetadataChanges: true },
    (snapshot) => {
      if (key === "settings") {
        const shared = snapshot.docs.find((entry) => entry.id === "garden")?.data();
        const categoryDates = snapshot.docs.find((entry) => entry.id === "categoryDates")?.data();
        data = { ...data, settings: { ...fallback, ...(shared || {}) }, categoryDates: categoryDates || {}, fromCache: snapshot.metadata.fromCache };
      } else {
        data = {
          ...data,
          [key]: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
          fromCache: snapshot.metadata.fromCache,
        };
      }
      emit();
    },
    (error) => event("error", error?.code === "permission-denied" ? "This Google account is not authorized for Sprout." : "Sprout could not sync."),
  ));
}

if (configured) {
  const app = initializeApp(FIREBASE_CONFIG, "sprout");
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  db = initializeFirestore(app, {});
  const base = ["sproutHouseholds", SPROUT_CONFIG.householdId];
  for (const key of ["settings", "years", "beds", "seeds", "plants", "logs", "yearUpdates", "weather", "activity"]) {
    refs[key] = collection(db, ...base, key);
  }

  onAuthStateChanged(auth, (user) => {
    stops.forEach((stop) => stop());
    stops = [];
    const allowed = Boolean(user?.uid) && SPROUT_CONFIG.allowedUids.includes(user.uid);
    window.SproutCurrentUser = user && allowed ? {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
    } : null;
    event("auth", window.SproutCurrentUser);
    if (!user) return;
    if (!allowed) {
      signOut(auth);
      event("error", "This Google account is not authorized for Sprout.");
      return;
    }
    subscribe("settings", data.settings);
    for (const key of ["years", "beds", "seeds", "plants", "logs", "yearUpdates", "activity"]) subscribe(key, []);
  });
} else {
  queueMicrotask(() => event("config", { configured: false }));
}

window.SproutStore = {
  configured,
  getIdToken: () => auth?.currentUser?.getIdToken(),
  signIn: () => {
    if (!configured) throw new Error("Add the new Firebase project values to config.js first.");
    return signInWithPopup(auth, new GoogleAuthProvider());
  },
  signOut: () => signOut(auth),
  getData: () => data,

  saveSettings: async (input) => {
    requireUser();
    const next = { ...data.settings, ...input, updatedAt: now(), ...actor() };
    const previous = data.settings;
    data = { ...data, settings: next };
    emit();
    const batch = writeBatch(db);
    batch.set(doc(refs.settings, "garden"), next);
    const entry = activityEntry("updated garden settings", null, {
      year: next.activeYear,
      undo: { operations: [{ key: "settings", kind: "set", item: { ...previous, id: "garden" } }] },
    });
    batch.set(doc(refs.activity, entry.id), entry);
    try { await batch.commit(); } catch (error) { data = { ...data, settings: previous }; emit(); throw error; }
  },

  saveCategoryDates: async (map) => {
    requireUser();
    const previous = data.categoryDates;
    const next = { ...map };
    data = { ...data, categoryDates: next };
    emit();
    const batch = writeBatch(db);
    batch.set(doc(refs.settings, "categoryDates"), next);
    const entry = activityEntry("updated category planting dates", null, {
      undo: { operations: [{ key: "settings", kind: "set", item: { ...previous, id: "categoryDates" } }] },
    });
    batch.set(doc(refs.activity, entry.id), entry);
    try { await batch.commit(); } catch (error) { data = { ...data, categoryDates: previous }; emit(); throw error; }
  },

  ensureYear: async (year) => {
    const numeric = Number(year);
    if (data.years.some((entry) => Number(entry.year) === numeric)) return;
    const item = { id: String(numeric), year: numeric, createdAt: now(), ...actor() };
    return commitDocument("years", item, { activity: "created year" });
  },

  saveBed: (input) => {
    const existing = data.beds.find((entry) => entry.id === input.id);
    const item = {
      ...(existing || {}),
      ...input,
      id: input.id || id(),
      subjectType: "bed",
      year: Number(input.year),
      number: Number(input.number),
      x: Number(input.x || 0),
      y: Number(input.y || 0),
      widthIn: Number(input.widthIn),
      heightIn: Number(input.heightIn),
      rotation: Number(input.rotation || 0),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      ...actor(),
    };
    return commitDocument("beds", item, { activity: existing ? "updated bed" : "added bed" });
  },

  deleteBed: async (bed) => commitDocument("beds", bed, { remove: true, activity: "deleted bed" }),

  saveSeed: (input) => {
    const normalized = String(input.commonName || "").trim().toLowerCase();
    const existing = data.seeds.find((entry) => entry.id === input.id || entry.normalizedName === normalized);
    const item = {
      ...(existing || {}),
      ...input,
      id: existing?.id || input.id || id(),
      commonName: String(input.commonName || "").trim(),
      normalizedName: normalized,
      icon: input.icon || "🌱",
      color: input.color || "#4f8d5b",
      sun: input.sun || "medium",
      water: input.water || "medium",
      notes: input.notes || "",
      seedLink: input.seedLink || "",
      updatedAt: now(),
      createdAt: existing?.createdAt || now(),
      ...actor(),
    };
    return commitDocument("seeds", item, { activity: existing ? "updated seed" : "added seed" });
  },

  deleteSeed: (seed) => commitDocument("seeds", seed, { remove: true, activity: "deleted seed" }),

  savePlant: (input) => {
    const existing = data.plants.find((entry) => entry.id === input.id);
    const item = {
      ...(existing || {}),
      ...input,
      id: input.id || id(),
      subjectType: "plant",
      year: Number(input.year),
      seedId: input.seedId || existing?.seedId,
      x: Number(input.x || 0),
      y: Number(input.y || 0),
      widthIn: Number(input.widthIn || 12),
      heightIn: Number(input.heightIn || 12),
      status: input.status || "planned",
      notes: input.notes || "",
      photos: input.photos || existing?.photos || [],
      archived: Boolean(input.archived),
      removedAt: input.archived ? (existing?.removedAt || now()) : null,
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      ...actor(),
    };
    delete item.bedId;
    const seed = data.seeds.find((entry) => entry.id === item.seedId);
    return commitDocument("plants", item, { activity: existing ? "updated plant" : "added plant", activityExtra: { label: seed?.commonName || "Plant" } });
  },

  archivePlant: (plant, archived = true) => {
    const item = { ...plant, archived, status: archived ? "removed" : "planned", removedAt: archived ? now() : null, updatedAt: now(), ...actor() };
    const seed = data.seeds.find((entry) => entry.id === plant.seedId);
    return commitDocument("plants", item, { activity: archived ? "archived plant" : "restored plant", activityExtra: { label: seed?.commonName || "Plant" } });
  },

  deletePlant: (plant) => commitDocument("plants", plant, { remove: true, activity: "deleted plant" }),

  addLog: (input) => {
    const item = {
      ...input,
      id: id(),
      year: Number(input.year),
      note: String(input.note || "").trim(),
      photos: input.photos || [],
      createdAt: now(),
      ...actor(),
    };
    const plant = data.plants.find((entry) => entry.id === input.plantId);
    const seed = data.seeds.find((entry) => entry.id === plant?.seedId);
    return commitDocument("logs", item, {
      activity: `logged ${input.type || "note"}`,
      activityExtra: { subjectType: "plant", subjectId: input.plantId, year: input.year, label: seed?.commonName || "Plant" },
    });
  },

  deleteLog: (log) => commitDocument("logs", log, { remove: true, activity: "deleted journal entry" }),

  undoLast: async (entry) => {
    requireUser();
    if (!entry?.undo?.operations?.length || entry.undoneAt) throw new Error("That action cannot be undone.");
    const batch = writeBatch(db);
    for (const operation of entry.undo.operations) {
      if (!refs[operation.key]) continue;
      const targetId = operation.item?.id || operation.id;
      if (!targetId) continue;
      const reference = doc(refs[operation.key], targetId);
      if (operation.kind === "delete") batch.delete(reference);
      else batch.set(reference, operation.item);
    }
    batch.set(doc(refs.activity, entry.id), { ...entry, undoneAt: now(), undoneBy: actor() });
    const undoEntry = activityEntry(`undid ${entry.action}`, null, {
      year: entry.year,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      label: entry.label,
      targetActivityId: entry.id,
    });
    batch.set(doc(refs.activity, undoEntry.id), undoEntry);
    await batch.commit();
  },

  duplicateYear: async (sourceYear, targetYear) => {
    requireUser();
    const source = Number(sourceYear);
    const target = Number(targetYear);
    if (source === target) throw new Error("Choose a different year.");
    if (data.years.some((entry) => Number(entry.year) === target)) throw new Error(`${target} already exists.`);
    const sourceBeds = data.beds.filter((bed) => Number(bed.year) === source);
    const sourcePlants = data.plants.filter((plant) => Number(plant.year) === source && !plant.archived);
    const operations = [];
    const yearItem = { id: String(target), year: target, duplicatedFrom: source, createdAt: now(), ...actor() };
    operations.push({ key: "years", item: yearItem });
    for (const bed of sourceBeds) {
      operations.push({ key: "beds", item: { ...bed, id: id(), year: target, createdAt: now(), updatedAt: now(), ...actor() } });
    }
    for (const plant of sourcePlants) {
      operations.push({ key: "plants", item: {
        ...plant,
        id: id(),
        year: target,
        status: "planned",
        archived: false,
        removedAt: null,
        photos: [],
        createdAt: now(),
        updatedAt: now(),
        ...actor(),
      } });
    }
    operations.push({ key: "settings", item: { ...data.settings, id: "garden", activeYear: target, updatedAt: now(), ...actor() } });
    if (operations.length > 440) throw new Error("This year is too large to duplicate in one step.");
    await commitMany(operations, activityEntry("duplicated year", null, { year: target, sourceYear: source, targetYear: target }));
  },

  saveYearCover: (year, photo) => {
    const existing = data.years.find((entry) => Number(entry.year) === Number(year));
    const item = { ...(existing || { id: String(year), year: Number(year), createdAt: now() }), coverPhoto: photo, updatedAt: now(), ...actor() };
    return commitDocument("years", item, { activity: "updated year cover photo" });
  },

  addYearUpdate: (input) => {
    const item = {
      id: id(),
      type: "manual",
      year: Number(input.year),
      date: input.date || new Date().toISOString().slice(0, 10),
      text: String(input.text || "").trim(),
      createdAt: now(),
      ...actor(),
    };
    return commitDocument("yearUpdates", item, { activity: "added year update", activityExtra: { subjectType: "year", year: input.year, label: `${input.year} update` } });
  },

  saveMonthlyUpdate: (input) => {
    const year = Number(input.year);
    const month = Number(input.month);
    const docId = `${year}-${String(month).padStart(2, "0")}-monthly`;
    const existing = data.yearUpdates.find((entry) => entry.id === docId);
    const item = {
      id: docId,
      type: "monthly",
      year,
      month,
      ratings: input.ratings || [],
      note: input.note || "",
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      ...actor(),
    };
    return commitDocument("yearUpdates", item, { activity: existing ? "updated monthly update" : "added monthly update", activityExtra: { subjectType: "year", year, label: `${year} monthly update` } });
  },

  deleteYearUpdate: (entry) => commitDocument("yearUpdates", entry, { remove: true, activity: "deleted year update" }),

  saveWeatherYear: async (year, days) => {
    requireUser();
    const item = { id: String(year), year: Number(year), days, fetchedAt: now(), ...actor() };
    const previous = data.weather;
    data = { ...data, weather: [...previous.filter((entry) => entry.id !== item.id), item] };
    emit();
    const batch = writeBatch(db);
    batch.set(doc(refs.weather, item.id), item);
    try { await batch.commit(); } catch (error) { data = { ...data, weather: previous }; emit(); throw error; }
    return item;
  },

  importBackup: async (payload) => {
    requireUser();
    const collections = ["years", "beds", "seeds", "plants", "logs", "yearUpdates", "weather", "activity"];
    const operations = [];
    for (const key of collections) {
      for (const item of Array.isArray(payload[key]) ? payload[key] : []) {
        if (item?.id) operations.push({ key, item });
      }
    }
    if (payload.settings) operations.push({ key: "settings", item: { ...payload.settings, id: "garden" } });
    if (payload.categoryDates) operations.push({ key: "settings", item: { ...payload.categoryDates, id: "categoryDates" } });
    for (let index = 0; index < operations.length; index += 400) {
      await commitMany(operations.slice(index, index + 400));
    }
  },
};

emit();
