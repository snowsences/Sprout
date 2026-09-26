// Create a new Firebase web app, then replace the values below with its config.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyACBAbzQtldDbDLBRKt4mSUQuzNrjps4f0",
  authDomain: "sprout-220a7.firebaseapp.com",
  projectId: "sprout-220a7",
  storageBucket: "sprout-220a7.firebasestorage.app",
  messagingSenderId: "704777581590",
  appId: "1:704777581590:web:9749fd76f4de8603bdf137",
};

export const SPROUT_CONFIG = {
  householdId: "shared",
  allowedEmails: ["allenkevinc@gmail.com", "meganec96@gmail.com"],
  // Reuse the existing signed-upload Worker, or deploy cloudflare-worker.js.
  cloudinaryWorkerUrl: "https://sprout-images.allenkevinc.workers.dev",
  cloudinaryFolder: "Sprout",
  photoMaxDimension: 1500,
  photoMaxBytes: 3.5 * 1024 * 1024,
};
