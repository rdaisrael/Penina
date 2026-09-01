const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const path = require('path');

const TEMPLATE_PATH = path.join(
    process.cwd(),
    'PeninaPlus-vocab-builder',
    'Penina-Vocabulary-Template.xlsx'
);

const HEADERS = [
    'Term',
    'Hebrew Translation of Term',
    'English Translation of Term',
    'Context Quote',
    'Hebrew Translation of Context Quote',
    'English Translation of Context Quote',
    'Citation of Source for Context Quote (in Hebrew)',
    'Citation of Source for Context Quote (in English)'
];

const FIELD_KEYS = [
    'term',
    'hebrewTermTranslation',
    'englishTermTranslation',
    'contextQuote',
    'hebrewContextTranslation',
    'englishContextTranslation',
    'hebrewCitation',
    'englishCitation'
];

const RICH_TEXT_RUN_KEYS = {
    contextQuote: 'contextQuoteRuns',
    hebrewContextTranslation: 'hebrewContextTranslationRuns',
    englishContextTranslation: 'englishContextTranslationRuns'
};

function richTextCellValue(textValue, runs) {
    const text = String(textValue || '');
    if (!Array.isArray(runs)) return text;

    const normalizedRuns = runs
        .map(run => ({ text: String(run && run.text || ''), bold: !!(run && run.bold) }))
        .filter(run => run.text);
    if (!normalizedRuns.some(run => run.bold)) return text;
    if (normalizedRuns.map(run => run.text).join('') !== text) return text;

    return {
        richText: normalizedRuns.map(run => ({
            font: {
                name: 'Arial',
                size: 12,
                bold: run.bold,
                color: { argb: 'FF1D232A' }
            },
            text: run.text
        }))
    };
}

function cellText(cell) {
    if (!cell) return '';
    if (typeof cell.text === 'string') return cell.text.trim();
    if (cell.value === null || cell.value === undefined) return '';
    return String(cell.value).trim();
}

function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function safeFileName(value) {
    const cleaned = String(value || 'Penina Vocabulary Sheet')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return `${cleaned || 'Penina Vocabulary Sheet'}.xlsx`;
}

async function loadWorkbookFromBase64(fileBase64) {
    const value = String(fileBase64 || '');
    if (!value || value.length > 8_000_000) {
        throw new Error('The uploaded spreadsheet is missing or too large.');
    }
    return loadWorkbookBuffer(Buffer.from(value, 'base64'));
}

async function normalizePrefixedSpreadsheetXml(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const xmlPaths = Object.keys(zip.files).filter(filePath => filePath.endsWith('.xml'));

    await Promise.all(xmlPaths.map(async filePath => {
        const entry = zip.file(filePath);
        if (!entry) return;
        const xml = await entry.async('string');
        if (!/<\/?x:/.test(xml)) return;
        zip.file(
            filePath,
            xml
                .replace(/(<\/?)(?:x):/g, '$1')
                .replace(/\sxmlns:x=/g, ' xmlns=')
        );
    }));

    return zip.generateAsync({ type: 'nodebuffer' });
}

async function loadWorkbookBuffer(buffer) {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
        return workbook;
    } catch (firstError) {
        const normalizedBuffer = await normalizePrefixedSpreadsheetXml(buffer);
        const normalizedWorkbook = new ExcelJS.Workbook();
        try {
            await normalizedWorkbook.xlsx.load(normalizedBuffer);
            return normalizedWorkbook;
        } catch (_normalizedError) {
            throw firstError;
        }
    }
}

function getVocabularyWorksheet(workbook) {
    return workbook.getWorksheet('Vocabulary') || workbook.worksheets[0];
}

function validateHeaders(worksheet) {
    if (!worksheet) throw new Error('The workbook does not contain a worksheet.');
    const actual = HEADERS.map((_, index) => cellText(worksheet.getCell(1, index + 1)));
    const matches = HEADERS.every((header, index) => normalizeHeader(header) === normalizeHeader(actual[index]));
    if (!matches) {
        throw new Error('This spreadsheet does not match the Penina vocabulary template. Please download and use the current template.');
    }
}

async function importVocabularyWorkbook(fileBase64) {
    const workbook = await loadWorkbookFromBase64(fileBase64);
    const worksheet = getVocabularyWorksheet(workbook);
    validateHeaders(worksheet);

    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const values = FIELD_KEYS.map((_, index) => cellText(worksheet.getCell(rowNumber, index + 1)));
        if (values.every(value => !value)) continue;
        if (!values[0]) throw new Error(`Row ${rowNumber} contains information but is missing the required Term field.`);

        const row = {};
        FIELD_KEYS.forEach((key, index) => {
            row[key] = values[index];
        });
        rows.push(row);
    }

    if (!rows.length) throw new Error('No vocabulary terms were found below the template header.');
    if (rows.length > 500) throw new Error('Please limit each vocabulary workbook to 500 terms.');
    return rows;
}

async function exportVocabularyWorkbook(rows, title) {
    const safeRows = Array.isArray(rows) ? rows.slice(0, 500) : [];
    if (!safeRows.length) throw new Error('There are no generated vocabulary rows to export.');

    const workbook = await loadWorkbookBuffer(await require('fs').promises.readFile(TEMPLATE_PATH));
    const worksheet = getVocabularyWorksheet(workbook);
    validateHeaders(worksheet);

    safeRows.forEach((sourceRow, rowIndex) => {
        const row = worksheet.getRow(rowIndex + 2);
        FIELD_KEYS.forEach((key, columnIndex) => {
            const textValue = String(sourceRow && sourceRow[key] || '').trim();
            const runKey = RICH_TEXT_RUN_KEYS[key];
            row.getCell(columnIndex + 1).value = runKey
                ? richTextCellValue(textValue, sourceRow && sourceRow[runKey])
                : textValue;
        });
        row.height = 34;
        row.eachCell({ includeEmpty: true }, cell => {
            cell.font = { name: 'Arial', size: 12, color: { argb: 'FF1D232A' } };
            cell.alignment = { vertical: 'top', wrapText: true };
            cell.border = {
                bottom: { style: 'thin', color: { argb: 'FFD9DEE8' } },
                right: { style: 'thin', color: { argb: 'FFD9DEE8' } }
            };
        });
        [1, 2, 4, 5, 7].forEach(columnNumber => {
            row.getCell(columnNumber).alignment = { vertical: 'top', wrapText: true, horizontal: 'right', readingOrder: 'rtl' };
        });
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = `A1:H${safeRows.length + 1}`;

    const buffer = await workbook.xlsx.writeBuffer();
    return {
        fileBase64: Buffer.from(buffer).toString('base64'),
        fileName: safeFileName(title)
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const body = req.body || {};
        if (body.action === 'import') {
            const rows = await importVocabularyWorkbook(body.fileBase64);
            return res.status(200).json({ rows });
        }
        if (body.action === 'export') {
            const output = await exportVocabularyWorkbook(body.rows, body.title);
            return res.status(200).json(output);
        }
        return res.status(400).json({ error: 'Unknown workbook action.' });
    } catch (error) {
        return res.status(400).json({ error: error && error.message ? error.message : 'Workbook processing failed.' });
    }
};
