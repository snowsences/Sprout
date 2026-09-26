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
  years: [],
  beds: [],
  varieties: [],
  plants: [],
  logs: [],
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
        data = { ...data, settings: { ...fallback, ...(shared || {}) }, fromCache: snapshot.metadata.fromCache };
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
  for (const key of ["settings", "years", "beds", "varieties", "plants", "logs", "activity"]) {
    refs[key] = collection(db, ...base, key);
  }

  onAuthStateChanged(auth, (user) => {
    stops.forEach((stop) => stop());
    stops = [];
    const email = user?.email?.toLowerCase() || "";
    const allowed = SPROUT_CONFIG.allowedEmails.map((entry) => entry.toLowerCase()).includes(email);
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
    for (const key of ["years", "beds", "varieties", "plants", "logs", "activity"]) subscribe(key, []);
  });
} else {
  queueMicrotask(() => event("config", { configured: false }));
}

window.SproutStore = {
  configured,
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

  deleteBed: async (bed) => {
    const plants = data.plants.filter((plant) => plant.bedId === bed.id);
    const archivedPlants = plants.map((plant) => ({
      ...plant,
      archived: true,
      status: "removed",
      removedAt: now(),
      updatedAt: now(),
      ...actor(),
    }));
    const operations = [
      { key: "beds", item: bed, remove: true },
      ...archivedPlants.map((plant) => ({ key: "plants", item: plant })),
    ];
    await commitMany(operations, activityEntry("deleted bed", bed, {
      removedPlants: plants.length,
      undo: { operations: [
        { key: "beds", kind: "set", item: bed },
        ...plants.map((plant) => ({ key: "plants", kind: "set", item: plant })),
      ] },
    }));
  },

  saveVariety: (input) => {
    const normalized = String(input.commonName || "").trim().toLowerCase();
    const existing = data.varieties.find((entry) => entry.id === input.id || entry.normalizedName === normalized);
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
      updatedAt: now(),
      createdAt: existing?.createdAt || now(),
      ...actor(),
    };
    return commitDocument("varieties", item, { activity: existing ? "updated plant type" : "added plant type" });
  },

  savePlant: (input) => {
    const existing = data.plants.find((entry) => entry.id === input.id);
    const item = {
      ...(existing || {}),
      ...input,
      id: input.id || id(),
      subjectType: "plant",
      year: Number(input.year),
      x: Number(input.x || 0),
      y: Number(input.y || 0),
      widthIn: Number(input.widthIn || 12),
      heightIn: Number(input.heightIn || 12),
      commonName: String(input.commonName || "").trim(),
      icon: input.icon || "🌱",
      color: input.color || "#4f8d5b",
      sun: input.sun || "medium",
      water: input.water || "medium",
      status: input.status || "planned",
      notes: input.notes || "",
      photos: input.photos || existing?.photos || [],
      archived: Boolean(input.archived),
      removedAt: input.archived ? (existing?.removedAt || now()) : null,
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
      ...actor(),
    };
    return commitDocument("plants", item, { activity: existing ? "updated plant" : "added plant" });
  },

  archivePlant: (plant, archived = true) => {
    const item = { ...plant, archived, status: archived ? "removed" : "planned", removedAt: archived ? now() : null, updatedAt: now(), ...actor() };
    return commitDocument("plants", item, { activity: archived ? "archived plant" : "restored plant" });
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
    return commitDocument("logs", item, {
      activity: `logged ${input.type || "note"}`,
      activityExtra: { subjectType: "plant", subjectId: input.plantId, year: input.year, label: plant?.commonName || "Plant" },
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
    const bedMap = new Map();
    const operations = [];
    const yearItem = { id: String(target), year: target, duplicatedFrom: source, createdAt: now(), ...actor() };
    operations.push({ key: "years", item: yearItem });
    for (const bed of sourceBeds) {
      const nextId = id();
      bedMap.set(bed.id, nextId);
      operations.push({ key: "beds", item: { ...bed, id: nextId, year: target, createdAt: now(), updatedAt: now(), ...actor() } });
    }
    for (const plant of sourcePlants) {
      operations.push({ key: "plants", item: {
        ...plant,
        id: id(),
        year: target,
        bedId: bedMap.get(plant.bedId) || "",
        status: "planned",
        plantedDate: "",
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

  importBackup: async (payload) => {
    requireUser();
    const collections = ["years", "beds", "varieties", "plants", "logs", "activity"];
    const operations = [];
    for (const key of collections) {
      for (const item of Array.isArray(payload[key]) ? payload[key] : []) {
        if (item?.id) operations.push({ key, item });
      }
    }
    if (payload.settings) operations.push({ key: "settings", item: { ...payload.settings, id: "garden" } });
    for (let index = 0; index < operations.length; index += 400) {
      await commitMany(operations.slice(index, index + 400));
    }
  },
};

emit();
