/**
 * Copernicus Data Space Ecosystem (CDSE) OAuth2 Authentication Client.
 *
 * Implements the official OAuth2 client-credentials flow:
 * https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html
 *
 * Token endpoint:
 * https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token
 */

const TOKEN_ENDPOINT = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

// In-memory token cache for server lifetime
let cachedToken = null;
let tokenExpiresAt = 0;
let pendingAuthPromise = null;

/**
 * Checks whether CDSE credentials are configured in server environment.
 * @returns {boolean}
 */
export function hasCopernicusCredentials() {
  const clientId = process.env.CDSE_CLIENT_ID;
  const clientSecret = process.env.CDSE_CLIENT_SECRET;
  return Boolean(clientId && clientSecret && clientId.trim() && clientSecret.trim());
}

/**
 * Retrieves a valid Copernicus Data Space Ecosystem access token.
 * Caches the token until 60 seconds before expiry to avoid mid-flight invalidation.
 *
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function getCopernicusAccessToken() {
  const clientId = process.env.CDSE_CLIENT_ID?.trim();
  const clientSecret = process.env.CDSE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    const error = new Error("CDSE credentials not configured. Set CDSE_CLIENT_ID and CDSE_CLIENT_SECRET in environment.");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }

  const now = Date.now();
  // Reuse existing cached token if valid for at least 60 more seconds
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return { token: cachedToken, expiresAt: tokenExpiresAt };
  }

  // Deduplicate concurrent token requests
  if (pendingAuthPromise) {
    return pendingAuthPromise;
  }

  pendingAuthPromise = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const status = response.status;
        let details = "";
        try {
          const errJson = await response.json();
          details = errJson.error_description || errJson.error || "";
        } catch {
          details = await response.text();
        }

        const authError = new Error(`Copernicus authentication failed (HTTP ${status}): ${details || "Invalid client credentials"}`);
        authError.code = "AUTH_FAILED";
        authError.status = status;
        throw authError;
      }

      const payload = await response.json();
      const accessToken = payload.access_token;
      const expiresInSeconds = Number(payload.expires_in) || 600;

      if (!accessToken) {
        throw new Error("Copernicus token endpoint returned a response without access_token.");
      }

      cachedToken = accessToken;
      tokenExpiresAt = Date.now() + (expiresInSeconds * 1000);

      return { token: cachedToken, expiresAt: tokenExpiresAt };
    } finally {
      pendingAuthPromise = null;
    }
  })();

  return pendingAuthPromise;
}

/**
 * Clears the cached token (useful for handling 401 Unauthorized retries).
 */
export function invalidateCopernicusToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
  pendingAuthPromise = null;
}

