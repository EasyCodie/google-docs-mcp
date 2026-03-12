import { google, docs_v1, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

let _docsClient: docs_v1.Docs | null = null;
let _driveClient: drive_v3.Drive | null = null;
let _auth: OAuth2Client | null = null;

function getAuth(): OAuth2Client {
  if (_auth) return _auth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing required environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN. " +
        "See README.md for setup instructions."
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  _auth = auth;
  return auth;
}

export function getDocsClient(): docs_v1.Docs {
  if (!_docsClient) {
    _docsClient = google.docs({ version: "v1", auth: getAuth() });
  }
  return _docsClient;
}

export function getDriveClient(): drive_v3.Drive {
  if (!_driveClient) {
    _driveClient = google.drive({ version: "v3", auth: getAuth() });
  }
  return _driveClient;
}

export function handleGoogleError(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    "errors" in error
  ) {
    const gErr = error as Error & { code: number; errors: Array<{ message: string }> };
    const msg = gErr.errors?.[0]?.message ?? error.message;
    if (gErr.code === 401) {
      return `Authentication failed: ${msg}. Check your GOOGLE_REFRESH_TOKEN is valid and not expired.`;
    }
    if (gErr.code === 403) {
      return `Permission denied: ${msg}. Ensure the Google account has access to this document and the required OAuth scopes are granted.`;
    }
    if (gErr.code === 404) {
      return `Not found: ${msg}. Verify the document ID is correct.`;
    }
    if (gErr.code === 429) {
      return `Rate limit exceeded: ${msg}. Wait a few seconds and retry.`;
    }
    return `Google API error (${gErr.code}): ${msg}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}
