export interface GoogleDocFile {
  [key: string]: unknown;
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
}

export interface DocumentContent {
  [key: string]: unknown;
  documentId: string;
  title: string;
  bodyText: string;
  revisionId: string;
  webViewLink: string;
}

export interface CreateDocumentResult {
  [key: string]: unknown;
  documentId: string;
  title: string;
  webViewLink: string;
  revisionId: string;
}

export interface UpdateDocumentResult {
  [key: string]: unknown;
  documentId: string;
  title: string;
  revisionId: string;
  updatedSections: number;
}

export interface PaginatedDocuments {
  total: number;
  count: number;
  documents: GoogleDocFile[];
  has_more: boolean;
  next_page_token?: string;
}

export enum ResponseFormat {
  JSON = "json",
  MARKDOWN = "markdown",
}
