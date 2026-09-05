import ExcelJS from "exceljs";

export interface ExcelColumn {
    header: string;
    key: string;
    width?: number;
}

export async function buildExcelBuffer(
    sheetName: string,
    columns: ExcelColumn[],
    rows: Record<string, unknown>[]
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
    sheet.getRow(1).font = { bold: true };
    rows.forEach((row) => sheet.addRow(row));
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Reads the first worksheet of an uploaded .xlsx file into plain objects,
 * keyed by lower-cased header text (row 1) — e.g. a "Rent Amount" column
 * header becomes the key "rent amount". Used for bulk imports (see
 * properties.service.ts's importUnitsFromExcel); the caller owns validating
 * the resulting values, this only handles the file-format parsing.
 */
export async function readExcelRows(buffer: Buffer): Promise<Record<string, unknown>[]> {
    const workbook = new ExcelJS.Workbook();
    // exceljs's own .d.ts shadows the global `Buffer` name with a local,
    // narrower ambient interface (`declare interface Buffer extends
    // ArrayBuffer {}`), so Node's real Buffer doesn't structurally match its
    // declared param type even though it's the exact right value at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        headers[colNumber] = String(cell.value ?? "").trim().toLowerCase();
    });

    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const record: Record<string, unknown> = {};
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const key = headers[colNumber];
            if (key) record[key] = cell.value;
        });
        if (Object.keys(record).length > 0) rows.push(record);
    });
    return rows;
}
