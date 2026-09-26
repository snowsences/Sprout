// Create a new Firebase web app, then replace the values below with its config.
export const FIREBASE_CONFIG = {
  apiKey: "PASTE_FIREBASE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
  appId: "PASTE_APP_ID",
};

export const SPROUT_CONFIG = {
  householdId: "shared",
  allowedEmails: ["allenkevinc@gmail.com", "meganec96@gmail.com"],
  // Reuse the existing signed-upload Worker, or deploy cloudflare-worker.js.
  cloudinaryWorkerUrl: "PASTE_CLOUDFLARE_WORKER_URL",
  cloudinaryFolder: "Sprout",
  photoMaxDimension: 1500,
  photoMaxBytes: 3.5 * 1024 * 1024,
};
