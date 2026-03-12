import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDocsClient, getDriveClient, handleGoogleError } from "../services/googleClient.js";
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  CreateDocumentInput,
  UpdateDocumentInput,
} from "../schemas/index.js";
import { CreateDocumentResult, UpdateDocumentResult } from "../types.js";
import { docs_v1 } from "googleapis";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAppendRequest(text: string, endIndex: number): docs_v1.Schema$Request {
  return {
    insertText: {
      location: { index: endIndex },
      text,
    },
  };
}

function buildReplaceRequests(
  replacements: Array<{ find: string; replace: string }>
): docs_v1.Schema$Request[] {
  return replacements.map(({ find, replace }) => ({
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace,
    },
  }));
}

// ── Tool Registrations ────────────────────────────────────────────────────────

export function registerWriteTools(server: McpServer): void {
  // ── gdocs_create_document ─────────────────────────────────────────────────
  server.registerTool(
    "gdocs_create_document",
    {
      title: "Create Google Document",
      description: `Create a new Google Docs document with an optional initial text body.

Args:
  - title (string, required): The title for the new document. Example: 'Project Kickoff Notes'
  - initial_content (string, optional): Plain text to insert as the document's initial body. Max 50,000 characters.

Returns:
  {
    "documentId": string,   // Use this ID in read/update tools
    "title": string,
    "webViewLink": string,  // Direct browser URL to open the doc
    "revisionId": string
  }

Examples:
  - "Create a blank doc called 'Meeting Notes'" → title='Meeting Notes'
  - "Create a doc with a draft agenda" → title='Agenda', initial_content='1. Introductions\n2. Q4 Review'

Error Handling:
  - Returns auth error if credentials are missing or invalid
  - Returns error if title is empty`,
      inputSchema: CreateDocumentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: CreateDocumentInput) => {
      try {
        const docs = getDocsClient();
        const drive = getDriveClient();

        // Step 1: Create the document
        const createRes = await docs.documents.create({
          requestBody: { title: params.title },
        });

        const documentId = createRes.data.documentId;
        if (!documentId) throw new Error("Failed to obtain document ID after creation");

        // Step 2: Insert initial content if provided
        if (params.initial_content) {
          const doc = await docs.documents.get({ documentId });
          // Content always starts at index 1 in an empty doc
          const endIndex = (doc.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
          await docs.documents.batchUpdate({
            documentId,
            requestBody: {
              requests: [buildAppendRequest(params.initial_content, endIndex)],
            },
          });
        }

        // Step 3: Fetch final state + web link
        const [finalDoc, meta] = await Promise.all([
          docs.documents.get({ documentId }),
          drive.files.get({ fileId: documentId, fields: "webViewLink" }),
        ]);

        const result: CreateDocumentResult = {
          documentId,
          title: finalDoc.data.title ?? params.title,
          webViewLink: meta.data.webViewLink ?? `https://docs.google.com/document/d/${documentId}/edit`,
          revisionId: finalDoc.data.revisionId ?? "",
        };

        return {
          content: [
            {
              type: "text",
              text:
                `✅ Document created successfully!\n\n` +
                `**Title**: ${result.title}\n` +
                `**ID**: \`${result.documentId}\`\n` +
                `**Link**: ${result.webViewLink}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error creating document: ${handleGoogleError(error)}` }],
        };
      }
    }
  );

  // ── gdocs_update_document ─────────────────────────────────────────────────
  server.registerTool(
    "gdocs_update_document",
    {
      title: "Update Google Document",
      description: `Update an existing Google Docs document by appending text or performing find-and-replace operations. At least one of append_text or replace_all_text must be provided.

Args:
  - document_id (string, required): The Google Docs document ID
  - append_text (string, optional): Plain text to append at the end of the document. Max 50,000 characters.
  - replace_all_text (array, optional): Up to 20 find-and-replace pairs.
      Each item: { find: string, replace: string }
      Replacements are case-sensitive.

Returns:
  {
    "documentId": string,
    "title": string,
    "revisionId": string,       // New revision ID after update
    "updatedSections": number   // Total number of update operations performed
  }

Examples:
  - "Add a summary section at the end" → append_text='\\n\\nSummary: ...'
  - "Replace all instances of draft with final" → replace_all_text=[{find:'draft', replace:'final'}]
  - "Append notes and fix a typo" → combine both append_text and replace_all_text

Error Handling:
  - Returns 404 if document ID is invalid
  - Returns 403 if account lacks edit permission on the document
  - Returns error if neither append_text nor replace_all_text is provided`,
      inputSchema: UpdateDocumentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: UpdateDocumentInput) => {
      try {
        const docs = getDocsClient();

        // Build all requests in one batch
        const requests: docs_v1.Schema$Request[] = [];

        // Replace operations go first (safer before index shifts from appending)
        if (params.replace_all_text?.length) {
          requests.push(...buildReplaceRequests(params.replace_all_text));
        }

        // Append comes last so index is always end-of-doc
        if (params.append_text) {
          const doc = await docs.documents.get({ documentId: params.document_id });
          const endIndex = (doc.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
          requests.push(buildAppendRequest(params.append_text, endIndex));
        }

        await docs.documents.batchUpdate({
          documentId: params.document_id,
          requestBody: { requests },
        });

        // Fetch updated metadata
        const updated = await docs.documents.get({ documentId: params.document_id });

        const result: UpdateDocumentResult = {
          documentId: params.document_id,
          title: updated.data.title ?? "Untitled",
          revisionId: updated.data.revisionId ?? "",
          updatedSections: requests.length,
        };

        return {
          content: [
            {
              type: "text",
              text:
                `✅ Document updated successfully!\n\n` +
                `**Title**: ${result.title}\n` +
                `**Operations performed**: ${result.updatedSections}\n` +
                `**New revision**: ${result.revisionId}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error updating document: ${handleGoogleError(error)}` }],
        };
      }
    }
  );
}
