import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDriveClient, getDocsClient, handleGoogleError } from "../services/googleClient.js";
import {
  ListDocumentsSchema,
  ReadDocumentSchema,
  ListDocumentsInput,
  ReadDocumentInput,
} from "../schemas/index.js";
import { ResponseFormat, GoogleDocFile, DocumentContent } from "../types.js";
import { GOOGLE_DOCS_MIME_TYPE, DRIVE_FIELDS, CHARACTER_LIMIT } from "../constants.js";
import { docs_v1 } from "googleapis";

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractBodyText(body: docs_v1.Schema$Body | undefined): string {
  if (!body?.content) return "";
  const parts: string[] = [];
  for (const element of body.content) {
    if (element.paragraph) {
      for (const pe of element.paragraph.elements ?? []) {
        if (pe.textRun?.content) {
          parts.push(pe.textRun.content);
        }
      }
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          parts.push(extractBodyText(cell.content ? { content: cell.content } : undefined));
        }
      }
    }
  }
  return parts.join("");
}

function formatDocList(docs: GoogleDocFile[], format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ count: docs.length, documents: docs }, null, 2);
  }
  if (docs.length === 0) return "No documents found.";
  return docs
    .map(
      (d) =>
        `### ${d.name}\n` +
        `- **ID**: \`${d.id}\`\n` +
        `- **Modified**: ${new Date(d.modifiedTime).toLocaleString()}\n` +
        `- **Link**: ${d.webViewLink}`
    )
    .join("\n\n");
}

function formatDocContent(doc: DocumentContent, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(doc, null, 2);
  }
  return (
    `# ${doc.title}\n\n` +
    `**Document ID**: \`${doc.documentId}\`\n` +
    `**Link**: ${doc.webViewLink}\n\n` +
    `---\n\n${doc.bodyText}`
  );
}

// ── Tool Registrations ────────────────────────────────────────────────────────

export function registerReadTools(server: McpServer): void {
  // ── gdocs_list_documents ──────────────────────────────────────────────────
  server.registerTool(
    "gdocs_list_documents",
    {
      title: "List Google Documents",
      description: `List Google Docs documents accessible to the authenticated account, with optional name filtering and pagination.

Args:
  - query (string, optional): Filter documents by name. Partial matches supported. Example: 'meeting notes'
  - limit (number): Max documents to return, 1-100 (default: 20)
  - page_token (string, optional): Token from a previous response to fetch the next page
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns (JSON format):
  {
    "count": number,
    "documents": [
      {
        "id": string,          // Document ID used in other tools
        "name": string,
        "createdTime": string,
        "modifiedTime": string,
        "webViewLink": string
      }
    ],
    "has_more": boolean,
    "next_page_token": string  // Present when has_more is true
  }

Examples:
  - "List my recent Google Docs" → use with no query
  - "Find documents about budgets" → query="budget"
  - "Get next page" → pass page_token from previous response

Error Handling:
  - Returns auth error if credentials are invalid
  - Returns empty list if no documents match the query`,
      inputSchema: ListDocumentsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ListDocumentsInput) => {
      try {
        const drive = getDriveClient();
        const q = [
          `mimeType='${GOOGLE_DOCS_MIME_TYPE}'`,
          "trashed=false",
          ...(params.query ? [`name contains '${params.query.replace(/'/g, "\\'")}'`] : []),
        ].join(" and ");

        const res = await drive.files.list({
          q,
          fields: DRIVE_FIELDS,
          pageSize: params.limit,
          pageToken: params.page_token,
          orderBy: "modifiedTime desc",
        });

        const files = (res.data.files ?? []) as GoogleDocFile[];
        const nextPageToken = res.data.nextPageToken ?? undefined;

        const paginatedResult = {
          count: files.length,
          documents: files,
          has_more: !!nextPageToken,
          ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
        };

        const text = formatDocList(files, params.response_format);
        return {
          content: [{ type: "text", text }],
          structuredContent: paginatedResult,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error listing documents: ${handleGoogleError(error)}` }],
        };
      }
    }
  );

  // ── gdocs_read_document ───────────────────────────────────────────────────
  server.registerTool(
    "gdocs_read_document",
    {
      title: "Read Google Document Content",
      description: `Read the full text content of a Google Docs document by its ID.

Args:
  - document_id (string): The Google Docs document ID from the URL. Example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns (JSON format):
  {
    "documentId": string,
    "title": string,
    "bodyText": string,      // Full plain text content of the document
    "revisionId": string,
    "webViewLink": string
  }

Note: Content is truncated at ${CHARACTER_LIMIT.toLocaleString()} characters for very large documents.

Examples:
  - "What does document X say?" → read_document with that doc's ID
  - "Summarize the content of my meeting notes" → read then summarize

Error Handling:
  - Returns 404 error if document ID is invalid or document was deleted
  - Returns 403 error if the account doesn't have read access`,
      inputSchema: ReadDocumentSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ReadDocumentInput) => {
      try {
        const docs = getDocsClient();
        const drive = getDriveClient();

        const [docRes, metaRes] = await Promise.all([
          docs.documents.get({ documentId: params.document_id }),
          drive.files.get({
            fileId: params.document_id,
            fields: "webViewLink",
          }),
        ]);

        const doc = docRes.data;
        let bodyText = extractBodyText(doc.body ?? undefined);

        if (bodyText.length > CHARACTER_LIMIT) {
          bodyText =
            bodyText.slice(0, CHARACTER_LIMIT) +
            `\n\n[Content truncated at ${CHARACTER_LIMIT.toLocaleString()} characters]`;
        }

        const result: DocumentContent = {
          documentId: params.document_id,
          title: doc.title ?? "Untitled",
          bodyText,
          revisionId: doc.revisionId ?? "",
          webViewLink: metaRes.data.webViewLink ?? "",
        };

        return {
          content: [{ type: "text", text: formatDocContent(result, params.response_format) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error reading document: ${handleGoogleError(error)}` }],
        };
      }
    }
  );
}
