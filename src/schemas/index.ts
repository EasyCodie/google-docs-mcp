import { z } from "zod";
import { ResponseFormat } from "../types.js";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../constants.js";

export const ListDocumentsSchema = z
  .object({
    query: z
      .string()
      .max(500, "Query must not exceed 500 characters")
      .optional()
      .describe(
        "Optional search query to filter documents by name. Example: 'meeting notes'"
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .describe(`Maximum number of documents to return (1-${MAX_PAGE_SIZE}, default: ${DEFAULT_PAGE_SIZE})`),
    page_token: z
      .string()
      .optional()
      .describe(
        "Pagination token from a previous response's next_page_token field"
      ),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for human-readable, 'json' for structured data"),
  })
  .strict();

export const ReadDocumentSchema = z
  .object({
    document_id: z
      .string()
      .min(1, "document_id is required")
      .describe(
        "Google Docs document ID. Found in the URL: docs.google.com/document/d/{document_id}/edit"
      ),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' for human-readable, 'json' for structured data"),
  })
  .strict();

export const CreateDocumentSchema = z
  .object({
    title: z
      .string()
      .min(1, "title is required")
      .max(255, "title must not exceed 255 characters")
      .describe("Title of the new Google Doc. Example: 'Q4 Planning Notes'"),
    initial_content: z
      .string()
      .max(50000, "Initial content must not exceed 50,000 characters")
      .optional()
      .describe(
        "Optional plain text content to insert into the document after creation"
      ),
  })
  .strict();

export const UpdateDocumentSchema = z
  .object({
    document_id: z
      .string()
      .min(1, "document_id is required")
      .describe(
        "Google Docs document ID. Found in the URL: docs.google.com/document/d/{document_id}/edit"
      ),
    append_text: z
      .string()
      .max(50000, "Text must not exceed 50,000 characters")
      .optional()
      .describe("Text to append at the end of the document"),
    replace_all_text: z
      .array(
        z.object({
          find: z
            .string()
            .min(1)
            .describe("Exact text to search for within the document"),
          replace: z
            .string()
            .describe("Text to replace all occurrences of 'find' with"),
        })
      )
      .max(20, "Cannot perform more than 20 replacements per update")
      .optional()
      .describe(
        "List of find-and-replace operations to perform. Example: [{find: 'old term', replace: 'new term'}]"
      ),
  })
  .strict()
  .refine(
    (data) => data.append_text !== undefined || (data.replace_all_text && data.replace_all_text.length > 0),
    { message: "At least one of append_text or replace_all_text must be provided" }
  );

export const FormatDocumentSchema = z
  .object({
    document_id: z
      .string()
      .min(1, "document_id is required")
      .describe(
        "Google Docs document ID. Found in the URL: docs.google.com/document/d/{document_id}/edit"
      ),
    requests: z
      .array(
        z.object({
          match_text: z
            .string()
            .min(1)
            .describe("Exact text to search for and format"),
          style: z
            .object({
              bold: z.boolean().optional(),
              italic: z.boolean().optional(),
              underline: z.boolean().optional(),
              strikethrough: z.boolean().optional(),
              fontFamily: z.string().optional(),
              fontSize: z.number().optional().describe("Font size in pt"),
              textColor: z
                .object({ r: z.number(), g: z.number(), b: z.number() })
                .optional()
                .describe("RGB values 0-1"),
              backgroundColor: z
                .object({ r: z.number(), g: z.number(), b: z.number() })
                .optional()
                .describe("RGB values 0-1"),
            })
            .optional(),
          heading: z
            .enum(["NORMAL_TEXT", "TITLE", "SUBTITLE", "HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"])
            .optional(),
          alignment: z
            .enum(["START", "CENTER", "END", "JUSTIFIED"])
            .optional(),
          bullet_preset: z
            .enum(["BULLET_DISC_CIRCLE_SQUARE", "NUMBERED_DECIMAL_ALPHA_ROMAN"])
            .optional(),
        })
      )
      .min(1, "At least one formatting request must be provided")
      .max(20, "Cannot perform more than 20 formatting requests per operation")
      .describe("List of formatting operations to apply"),
  })
  .strict();

export type ListDocumentsInput = z.infer<typeof ListDocumentsSchema>;
export type ReadDocumentInput = z.infer<typeof ReadDocumentSchema>;
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;
export type FormatDocumentInput = z.infer<typeof FormatDocumentSchema>;
