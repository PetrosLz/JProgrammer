import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import type { PdfExportRequest, PdfExportResult } from "../../shared/types";

const pdfExportChannel = "pdf:export";

export function registerPdfExportIpc(): void {
  ipcMain.removeHandler(pdfExportChannel);

  ipcMain.handle(
    pdfExportChannel,
    async (event, request: PdfExportRequest): Promise<PdfExportResult> => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;

      try {
        if (!request.html.trim()) {
          return failure("PDF_EMPTY_HTML", "There is no schedule content to export.");
        }

        const saveOptions = {
          title: "Export PDF",
          defaultPath: sanitizePdfFileName(request.defaultFileName),
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        };
        const saveResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return {
            ok: false,
            cancelled: true,
            error: {
              code: "PDF_EXPORT_CANCELLED",
              message: "PDF export was cancelled."
            }
          };
        }

        const pdf = await renderHtmlToPdf(request.html);
        await writeFile(saveResult.filePath, pdf);

        return {
          ok: true,
          filePath: saveResult.filePath
        };
      } catch (error) {
        console.error("PDF export failed:", error);
        return failure(
          "PDF_EXPORT_FAILED",
          getErrorMessage(error) || "The PDF could not be exported."
        );
      }
    }
  );
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const printWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );

    return await printWindow.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      printBackground: true,
      margins: {
        marginType: "custom",
        top: 0.35,
        bottom: 0.35,
        left: 0.35,
        right: 0.35
      }
    });
  } finally {
    printWindow.close();
  }
}

function sanitizePdfFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_")
    .trim();

  if (!sanitized.toLowerCase().endsWith(".pdf")) {
    return `${sanitized || "JProgrammer_Weekly_Schedule"}.pdf`;
  }

  return sanitized || "JProgrammer_Weekly_Schedule.pdf";
}

function failure(code: string, message: string): PdfExportResult {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}
