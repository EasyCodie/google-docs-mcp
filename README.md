# google-docs-mcp-server

A Model Context Protocol (MCP) server for Google Docs and Google Drive, built with TypeScript and Streamable HTTP transport.

## Tools Available

| Tool | Description |
|------|-------------|
| `gdocs_list_documents` | List Google Docs in your Drive, with optional name search and pagination |
| `gdocs_read_document` | Read the full text content of a document by its ID |
| `gdocs_create_document` | Create a new Google Doc with an optional initial body |
| `gdocs_update_document` | Append text or perform find-and-replace on an existing document |

---

## Step 1 — Google Cloud Credentials Setup

You need a Google Cloud project with OAuth 2.0 credentials. This is a one-time setup.

### 1.1 Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Give it a name (e.g. `my-mcp-server`) → **Create**
4. Make sure the new project is selected in the dropdown

### 1.2 Enable Required APIs

1. In the left sidebar go to **APIs & Services → Library**
2. Search for and enable each of the following:
   - **Google Docs API**
   - **Google Drive API**

### 1.3 Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted to configure the consent screen first:
   - Choose **External** (or Internal if using Google Workspace)
   - Fill in App name (e.g. `MCP Server`), support email, and developer email
   - On the **Scopes** step, click **Add or remove scopes** and add:
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/drive`
   - Add your Google account email as a **Test user**
   - Save and continue through to the end
4. Back in **Create OAuth client ID**:
   - Application type: **Desktop app**
   - Name: `google-docs-mcp`
   - Click **Create**
5. A dialog will show your **Client ID** and **Client Secret** — download the JSON or copy them now

### 1.4 Get a Refresh Token

You need to exchange your credentials for a long-lived refresh token. The easiest way is using the OAuth Playground:

1. Go to [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the **gear icon** (top right) → check **Use your own OAuth credentials**
3. Enter your **Client ID** and **Client Secret** from step 1.3
4. In the left panel, scroll to find and select:
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive`
5. Click **Authorize APIs** → sign in with your Google account → Allow
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token** value from the response

> **Keep these values safe.** They give full access to your Google Docs and Drive.

---

## Step 2 — Installation

```bash
# Clone or download this project, then:
npm install
npm run build
```

---

## Step 3 — Configuration

Create a `.env` file in the project root:

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
PORT=3000
```

> **Never commit your `.env` file.** Add it to `.gitignore`.

---

## Step 4 — Running the Server

```bash
# Start the server
npm start

# The server will print:
# Google Docs MCP server running on http://localhost:3000/mcp
# Health check available at http://localhost:3000/health
```

Verify it's running:
```bash
curl http://localhost:3000/health
# → {"status":"ok","server":"google-docs-mcp-server","version":"1.0.0"}
```

---

## Step 5 — Connect to an MCP Client

### Claude Desktop

Add this to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/absolute/path/to/google-docs-mcp-server/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_REFRESH_TOKEN": "your_refresh_token",
        "TRANSPORT": "http",
        "PORT": "3000"
      }
    }
  }
}
```

Or if running as a remote HTTP server, point the client at `http://your-host:3000/mcp`.

---

## Tool Reference

### `gdocs_list_documents`

List documents from your Google Drive.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Filter by document name (partial match) |
| `limit` | number | No | Max results (1–100, default 20) |
| `page_token` | string | No | Token for fetching next page |
| `response_format` | `markdown` \| `json` | No | Output format (default: markdown) |

### `gdocs_read_document`

Read the text content of a document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_id` | string | Yes | The document ID from its URL |
| `response_format` | `markdown` \| `json` | No | Output format (default: markdown) |

**Finding the document ID**: In the URL `https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit`, the ID is `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`.

### `gdocs_create_document`

Create a new Google Doc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Document title |
| `initial_content` | string | No | Text to insert on creation (max 50,000 chars) |

### `gdocs_update_document`

Update an existing document. At least one update operation must be provided.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_id` | string | Yes | The document ID |
| `append_text` | string | No | Text to add at the end |
| `replace_all_text` | array | No | Array of `{find, replace}` pairs (max 20) |

---

## Troubleshooting

**`Missing required environment variables`**
→ Check your `.env` file exists and all three Google variables are set.

**`Authentication failed` / 401**
→ Your refresh token may have expired. Repeat Step 1.4 to generate a new one.

**`Permission denied` / 403**
→ Ensure you added the correct Google account as a Test User in the OAuth consent screen, and that you granted both Docs and Drive scopes during authorization.

**`Not found` / 404**
→ Double-check the document ID. It's case-sensitive.

**`Rate limit exceeded` / 429**
→ Wait a few seconds and retry. Google's free tier limits are generous for normal use.
