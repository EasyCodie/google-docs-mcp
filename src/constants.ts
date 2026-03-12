// ── Google API Constants ───────────────────────────────────────────────────────

/** MIME type used to filter Google Docs files in Drive queries */
export const GOOGLE_DOCS_MIME_TYPE = "application/vnd.google-apps.document";

/** Fields to request when listing Drive files */
export const DRIVE_FIELDS =
  "nextPageToken, files(id, name, createdTime, modifiedTime, webViewLink, owners)";

/** Maximum number of characters to return from a document body */
export const CHARACTER_LIMIT = 100_000;

// ── Pagination Constants ───────────────────────────────────────────────────────

/** Maximum number of documents per page */
export const MAX_PAGE_SIZE = 100;

/** Default number of documents per page */
export const DEFAULT_PAGE_SIZE = 20;
