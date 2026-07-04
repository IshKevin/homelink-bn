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
