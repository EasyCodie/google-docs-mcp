import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDocsClient, getDriveClient, handleGoogleError } from "../services/googleClient.js";
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  FormatDocumentSchema,
  CreateDocumentInput,
  UpdateDocumentInput,
  FormatDocumentInput,
} from "../schemas/index.js";
import { CreateDocumentResult, UpdateDocumentResult, FormatDocumentResult } from "../types.js";
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

  // ── gdocs_format_document ─────────────────────────────────────────────────
  server.registerTool(
    "gdocs_format_document",
    {
      title: "Format Google Document",
      description: `Format text in a Google Docs document based on exact text matching.
Features: bold, italic, text color, font size, headings, alignment, and bullet points.

Args:
  - document_id (string, required): The Google Docs document ID
  - requests (array, required): List of formatting operations.
      Each item needs:
        - match_text: Exact string to format
        - style: { bold, italic, underline, strikethrough, fontFamily, fontSize, textColor(r,g,b), backgroundColor(r,g,b) }
        - heading: "TITLE", "HEADING_1", etc.
        - alignment: "START", "CENTER", "END", "JUSTIFIED"
        - bullet_preset: "BULLET_DISC_CIRCLE_SQUARE", etc.

Returns:
  {
    "documentId": string,
    "title": string,
    "revisionId": string,
    "formattedSections": number
  }

Examples:
  - "Make 'Summary' heading 1" -> requests=[{match_text:'Summary', heading:'HEADING_1'}]
  - "Bold the word 'Important'" -> requests=[{match_text:'Important', style:{bold:true}}]
  - "Turn this into a bullet list" -> requests=[{match_text:'Item 1\\nItem 2', bullet_preset:'BULLET_DISC_CIRCLE_SQUARE'}]`,
      inputSchema: FormatDocumentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: FormatDocumentInput) => {
      try {
        const docs = getDocsClient();
        
        // Fetch to find exact indices for match_text
        const docRes = await docs.documents.get({ documentId: params.document_id });
        const doc = docRes.data;
        const bodyText = extractBodyText(doc.body ?? undefined);
        
        const apiRequests: docs_v1.Schema$Request[] = [];
        
        for (const req of params.requests) {
          const matchIndex = bodyText.indexOf(req.match_text);
          if (matchIndex === -1) {
            console.error(`Text not found: "${req.match_text.substring(0, 20)}..."`);
            continue; // Skip if text not found
          }
          
          // Docs indices are 1-based (0 is the virtual beginning)
          const startIndex = matchIndex + 1;
          const endIndex = startIndex + req.match_text.length;
          
          const range = { startIndex, endIndex };
          
          // 1. Text Style
          if (req.style) {
            const fields: string[] = [];
            const textStyle: docs_v1.Schema$TextStyle = {};
            
            if (req.style.bold !== undefined) { textStyle.bold = req.style.bold; fields.push("bold"); }
            if (req.style.italic !== undefined) { textStyle.italic = req.style.italic; fields.push("italic"); }
            if (req.style.underline !== undefined) { textStyle.underline = req.style.underline; fields.push("underline"); }
            if (req.style.strikethrough !== undefined) { textStyle.strikethrough = req.style.strikethrough; fields.push("strikethrough"); }
            if (req.style.fontFamily) {
              textStyle.weightedFontFamily = { fontFamily: req.style.fontFamily };
              fields.push("weightedFontFamily");
            }
            if (req.style.fontSize) {
              textStyle.fontSize = { magnitude: req.style.fontSize, unit: "PT" };
              fields.push("fontSize");
            }
            if (req.style.textColor) {
              textStyle.foregroundColor = { color: { rgbColor: { red: req.style.textColor.r, green: req.style.textColor.g, blue: req.style.textColor.b } } };
              fields.push("foregroundColor");
            }
            if (req.style.backgroundColor) {
              textStyle.backgroundColor = { color: { rgbColor: { red: req.style.backgroundColor.r, green: req.style.backgroundColor.g, blue: req.style.backgroundColor.b } } };
              fields.push("backgroundColor");
            }
            
            if (fields.length > 0) {
              apiRequests.push({
                updateTextStyle: { range, textStyle, fields: fields.join(",") }
              });
            }
          }
          
          // 2. Paragraph Style (Alignment & Headings)
          if (req.heading || req.alignment) {
            const fields: string[] = [];
            const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
            
            if (req.heading) {
              paragraphStyle.namedStyleType = req.heading;
              fields.push("namedStyleType");
            }
            if (req.alignment) {
              paragraphStyle.alignment = req.alignment;
              fields.push("alignment");
            }
            
            if (fields.length > 0) {
              apiRequests.push({
                updateParagraphStyle: { range, paragraphStyle, fields: fields.join(",") }
              });
            }
          }
          
          // 3. Bullets
          if (req.bullet_preset) {
            apiRequests.push({
              createParagraphBullets: { range, bulletPreset: req.bullet_preset }
            });
          }
        }
        
        if (apiRequests.length === 0) {
          throw new Error("No formatting applied. Either requests were empty or text to match was not found.");
        }
        
        await docs.documents.batchUpdate({
          documentId: params.document_id,
          requestBody: { requests: apiRequests },
        });

        const updated = await docs.documents.get({ documentId: params.document_id });

        const result: FormatDocumentResult = {
          documentId: params.document_id,
          title: updated.data.title ?? "Untitled",
          revisionId: updated.data.revisionId ?? "",
          formattedSections: apiRequests.length,
        };

        return {
          content: [
            {
              type: "text",
              text:
                `✅ Document formatted successfully!\n\n` +
                `**Title**: ${result.title}\n` +
                `**Commands processed**: ${result.formattedSections}\n` +
                `**New revision**: ${result.revisionId}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error formatting document: ${handleGoogleError(error)}` }],
        };
      }
    }
  );
}
