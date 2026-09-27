/**
 * Cloudinary signing Worker for Sprout.
 * Required Worker secrets: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 * CLOUDINARY_API_SECRET. Variables: ALLOWED_ORIGIN and FIREBASE_API_KEY.
 */
const ALLOWED_UIDS = ["FRSVgPioqZfYkWlBWYUdnPjEEO03", "eVuZNR5ZMtcBGsksyepA9fDkGVv1"];
const json = (body, status = 200, origin = "*") =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      vary: "Origin",
    },
  });

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha1(value) {
  return hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)));
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || requestOrigin || "*";
    if (env.ALLOWED_ORIGIN && requestOrigin && requestOrigin !== env.ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed." }, 403, env.ALLOWED_ORIGIN);
    }
    if (request.method === "OPTIONS") return json({}, 204, allowedOrigin);
    if (request.method !== "POST") return json({ error: "POST only." }, 405, allowedOrigin);

    try {
      const authorization = request.headers.get("Authorization") || "";
      const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!idToken) return json({ error: "Sign-in required." }, 401, allowedOrigin);
      const firebaseKey = env.FIREBASE_API_KEY || "AIzaSyACBAbzQtldDbDLBRKt4mSUQuzNrjps4f0";
      const identityResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!identityResponse.ok) return json({ error: "Invalid sign-in." }, 401, allowedOrigin);
      const identity = await identityResponse.json();
      const user = identity.users?.[0];
      if (!user?.localId || !ALLOWED_UIDS.includes(user.localId)) {
        return json({ error: "Account not allowed." }, 403, allowedOrigin);
      }

      const body = await request.json();
      if (body.action === "destroy") {
        const publicId = String(body.publicId || "");
        if (!publicId.startsWith("Sprout/")) {
          return json({ error: "Invalid asset." }, 400, allowedOrigin);
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = await sha1(`public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);
        const form = new FormData();
        form.set("public_id", publicId);
        form.set("timestamp", String(timestamp));
        form.set("api_key", env.CLOUDINARY_API_KEY);
        form.set("signature", signature);
        const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
          method: "POST",
          body: form,
        });
        return json(await response.json(), response.status, allowedOrigin);
      }

      const folder = String(body.folder || "Sprout");
      if (!(folder === "Sprout" || folder.startsWith("Sprout/")) || folder.includes("..")) {
        return json({ error: "Invalid folder." }, 400, allowedOrigin);
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await sha1(`folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);
      return json({
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        timestamp,
        folder,
        signature,
      }, 200, allowedOrigin);
    } catch (error) {
      return json({ error: error?.message || "Signing failed." }, 500, allowedOrigin);
    }
  },
};
