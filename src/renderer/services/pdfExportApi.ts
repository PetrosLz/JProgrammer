import type { PdfExportRequest } from "../../shared/types";

export class PdfExportError extends Error {
  code: string;
  cancelled: boolean;

  constructor(code: string, message: string, cancelled = false) {
    super(message);
    this.name = "PdfExportError";
    this.code = code;
    this.cancelled = cancelled;
  }
}

export const pdfExportApi = {
  exportPdf: async (request: PdfExportRequest): Promise<string> => {
    const result = await window.jprogrammer.exportPdf(request);

    if (result.ok) {
      return result.filePath;
    }

    throw new PdfExportError(
      result.error.code,
      result.error.message,
      Boolean(result.cancelled)
    );
  }
};
