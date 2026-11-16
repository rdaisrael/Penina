(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./cards') : root.PeninaKnowledgeCards);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PeninaKnowledgeSpreadsheet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cardsAPI) {
    'use strict';
    const {FORMAT, normalizeDeck, validChoices} = cardsAPI;
    const HEADERS = ['Picture', 'Question', 'Correct Answer', 'Distractor 1', 'Distractor 2', 'Distractor 3', 'Additional Information'];
    const LEGACY_HEADERS = ['Picture', 'Question', 'A', 'B', 'C', 'D', 'E', 'F', 'Correct Answer', 'Additional Information'];
    const LETTERS = 'ABCDEF';
    const IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
    let excelPromise, zipPromise;
    function loadScript(src, name) {
        if (window[name]) return Promise.resolve(window[name]);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const fail = () => {clearTimeout(timer); script.remove(); reject(Error('The spreadsheet tools could not be loaded. Try again.'));};
            const timer = setTimeout(fail, 15000);
            script.src = src; script.onerror = fail;
            script.onload = () => {clearTimeout(timer); window[name] ? resolve(window[name]) : fail();};
            document.head.append(script);
        });
    }
    function loadExcel() {
        return excelPromise ||= loadScript('/PeninaPlus-Reader/vendor/exceljs-4.4.0.min.js', 'ExcelJS').catch(error => {excelPromise = null; throw error;});
    }
    function loadZip() {
        return zipPromise ||= loadScript('/PeninaPlus-knowledge-builder/vendor/jszip-3.10.1.min.js', 'JSZip').catch(error => {zipPromise = null; throw error;});
    }
    function cellText(value) {
        if (value == null) return '';
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).replace(/^\uFEFF/, '').trim();
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
        throw Error('Use text or numbers, not formulas, dates, or cell errors.');
    }
    function imageSource(image) {
        const type = String(image.extension || '').toLowerCase().replace(/^jpg$/, 'jpeg');
        if (!['png', 'jpeg', 'gif', 'webp'].includes(type)) throw Error('Use a PNG, JPEG, GIF, or WebP picture.');
        if (image.base64) {
            const source = image.base64.startsWith('data:') ? image.base64 : `data:image/${type};base64,${image.base64}`;
            if (IMAGE.test(source)) return source;
        }
        if (image.buffer) {
            const bytes = new Uint8Array(image.buffer);
            let binary = '';
            for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
            return `data:image/${type};base64,${btoa(binary)}`;
        }
        throw Error('A picture could not be read. Insert it again and save the workbook.');
    }
    // ExcelJS reads floating pictures. Excel's newer in-cell pictures are stored in
    // rich-data parts; follow their metadata and relationships instead of treating #VALUE! as text.
    async function readCellPictures(zip, Parser = globalThis.DOMParser) {
        const result = new Map();
        if (!zip.file('xl/richData/richValueRel.xml')) return result;
        if (!Parser) throw Error('This browser cannot read in-cell pictures.');
        const elements = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
        const children = (node, tag) => [...node.children].filter(child => child.localName === tag);
        const readXML = async file => {
            const entry = zip.file(file);
            if (!entry) throw Error('The workbook has incomplete picture data. Insert the pictures again and save it.');
            const xml = new Parser().parseFromString(await entry.async('string'), 'application/xml');
            if (elements(xml, 'parsererror').length) throw Error('The workbook contains unreadable picture data.');
            return xml;
        };
        const resolve = (base, target) => {
            const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
            for (const part of target.split('/')) {
                if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
            }
            return parts.join('/');
        };
        const relationId = node => node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const relationships = xml => new Map(elements(xml, 'Relationship').map(node => [node.getAttribute('Id'), node]));
        const [metadata, valuesXML, structuresXML, relsXML, imageRelsXML, bookXML, bookRelsXML] = await Promise.all([
            'xl/metadata.xml', 'xl/richData/rdrichvalue.xml', 'xl/richData/rdrichvaluestructure.xml',
            'xl/richData/richValueRel.xml', 'xl/richData/_rels/richValueRel.xml.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'
        ].map(readXML));
        const types = elements(metadata, 'metadataType');
        const future = elements(metadata, 'futureMetadata').find(node => node.getAttribute('name') === 'XLRICHVALUE');
        const futureValues = future ? children(future, 'bk') : [];
        const valueMetadata = elements(metadata, 'valueMetadata')[0];
        const metadataValues = valueMetadata ? children(valueMetadata, 'bk') : [];
        const values = elements(valuesXML, 'rv'), structures = elements(structuresXML, 's');
        const rels = elements(relsXML, 'rel'), imageRels = relationships(imageRelsXML), bookRels = relationships(bookRelsXML);
        const sources = new Map();
        for (const sheet of elements(bookXML, 'sheet')) {
            const relation = bookRels.get(relationId(sheet));
            if (!relation || relation.getAttribute('TargetMode') === 'External') throw Error('A worksheet could not be read.');
            const xml = await readXML(resolve('xl/workbook.xml', relation.getAttribute('Target')));
            const pictures = new Map();
            for (const cell of elements(xml, 'c').filter(node => node.hasAttribute('vm'))) {
                const location = `${sheet.getAttribute('name')}!${cell.getAttribute('r')}`;
                const fail = () => {throw Error(`${location}: The in-cell picture could not be read. Insert it again and save the workbook.`);};
                const block = metadataValues[Number(cell.getAttribute('vm')) - 1];
                const record = block && elements(block, 'rc').find(node => types[Number(node.getAttribute('t')) - 1]?.getAttribute('name') === 'XLRICHVALUE');
                const futureBlock = record && futureValues[Number(record.getAttribute('v'))];
                const valueIndex = futureBlock && elements(futureBlock, 'rvb')[0]?.getAttribute('i');
                const value = valueIndex != null && values[Number(valueIndex)];
                const structure = value && structures[Number(value.getAttribute('s'))];
                if (!structure || structure.getAttribute('t') !== '_localImage') fail();
                const keyIndex = children(structure, 'k').findIndex(key => key.getAttribute('n') === '_rvRel:LocalImageIdentifier');
                const imageIndex = children(value, 'v')[keyIndex]?.textContent;
                const rel = imageIndex != null && rels[Number(imageIndex)];
                const imageRel = rel && imageRels.get(relationId(rel));
                if (!imageRel || imageRel.getAttribute('TargetMode') === 'External') fail();
                const file = resolve('xl/richData/richValueRel.xml', imageRel.getAttribute('Target'));
                if (!sources.has(file)) {
                    const entry = zip.file(file);
                    if (!entry) fail();
                    sources.set(file, imageSource({extension:file.split('.').pop(), base64:await entry.async('base64')}));
                }
                pictures.set(cell.getAttribute('r'), sources.get(file));
            }
            result.set(sheet.getAttribute('name'), pictures);
        }
        return result;
    }
    function parseWorkbook(workbook, {title = 'Imported knowledge set', language = 'english', cellPictures = new Map()} = {}) {
        if (!['english', 'hebrew'].includes(language)) throw Error('Choose English or Hebrew for the imported practice answers.');
        const cards = [];
        for (const sheet of workbook.worksheets) {
            if (!sheet.actualRowCount) continue;
            const header = sheet.getRow(1);
            const legacy = header.values.some(value => cellText(value).toUpperCase() === 'A');
            const extraHeaders = ['Distractor 4', 'Distractor 5'].filter(name => header.values.some(value => cellText(value).toLowerCase() === name.toLowerCase()));
            const columns = (legacy ? LEGACY_HEADERS : [...HEADERS.slice(0, -1), ...extraHeaders, HEADERS[HEADERS.length - 1]]).map(name => {
                const matches = [];
                header.eachCell((cell, column) => {if (cellText(cell.value).toLowerCase() === name.toLowerCase()) matches.push(column);});
                if (matches.length !== 1) throw Error(`${sheet.name}: Keep one column named “${name}” in the first row. Use the downloadable template.`);
                return matches[0];
            });
            header.eachCell((cell, column) => {if (!columns.includes(column) && cellText(cell.value)) throw Error(`${sheet.name}: Unrecognized column “${cellText(cell.value)}”. Use the downloadable template.`);});
            const pictures = new Map(cellPictures.get(sheet.name) || []);
            for (const embedded of sheet.getImages()) {
                const row = Math.floor(embedded.range.tl.nativeRow) + 1, column = Math.floor(embedded.range.tl.nativeCol) + 1;
                if (row < 2 || column !== columns[0]) throw Error(`${sheet.name}, row ${row}: Place each picture in its question's Picture column.`);
                const address = sheet.getCell(row, column).address;
                if (pictures.has(address)) throw Error(`${sheet.name}, row ${row}: Use one picture per question.`);
                pictures.set(address, imageSource(workbook.getImage(embedded.imageId)));
            }
            const usedPictures = new Set();
            sheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const location = `${sheet.name}, row ${rowNumber}`;
                try {
                    const pictureAddress = row.getCell(columns[0]).address;
                    let source = pictures.get(pictureAddress);
                    if (source) usedPictures.add(pictureAddress);
                    const values = columns.map((column, i) => i === 0 && source ? '' : cellText(row.getCell(column).value));
                    row.eachCell((cell, column) => {if (!columns.includes(column) && cellText(cell.value)) throw Error('Move all data into the template columns.');});
                    if (!source && values[0]) {
                        if (!IMAGE.test(values[0])) throw Error('Insert a picture in or over the Picture cell. Picture links and formulas are not supported.');
                        source = values[0];
                    }
                    if (!source && values.every(value => !value)) return;
                    if (!values[1]) throw Error('Enter a question.');
                    let answer = values[2], distractors = values.slice(3, -1);
                    if (legacy) {
                        const letter = values[8].toUpperCase();
                        if (!/^[A-F]$/.test(letter)) throw Error('Correct Answer must be one letter from A to F.');
                        const correctIndex = LETTERS.indexOf(letter);
                        answer = values[correctIndex + 2];
                        if (!answer) throw Error(`Correct Answer points to ${letter}, but that choice is blank.`);
                        distractors = values.slice(2, 8).filter((value, i) => i !== correctIndex && value);
                    }
                    if (!answer) throw Error('Enter the answer text in Correct Answer.');
                    const filledChoices = distractors.filter(Boolean);
                    if (filledChoices.length && !validChoices(answer, filledChoices)) throw Error('Use different incorrect choices of up to 500 characters. None may match the correct answer.');
                    cards.push({id:`import-${cards.length + 1}`, question:values[1], answer, additionalInformation:values[values.length - 1],
                        picture:source ? {src:source,alt:'',target:null} : null, distractors:filledChoices.length ? {[language]:distractors} : {}});
                    if (cards.length > 500) throw Error('A set can contain up to 500 cards.');
                } catch (error) {throw Error(`${location}: ${error.message}`);}
            });
            if ([...pictures.keys()].some(address => !usedPictures.has(address))) throw Error(`${sheet.name}: Each picture must be in the Picture column on a row with a question.`);
        }
        if (!cards.length) throw Error('The template is empty. Add a question and its Correct Answer, then upload again.');
        return normalizeDeck({format:FORMAT,version:1,title,cards});
    }
    async function readExcel(buffer, ExcelJS, JSZip, options = {}) {
        let workbook, zip;
        try {
            zip = await JSZip.loadAsync(buffer);
            workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
        } catch (_) {throw Error('This file could not be opened. Save it as an Excel Workbook (.xlsx), then upload again.');}
        const cellPictures = await readCellPictures(zip, options.DOMParser);
        return parseWorkbook(workbook, {...options,cellPictures});
    }
    return {HEADERS, LEGACY_HEADERS, loadExcel, loadZip, parseWorkbook, readExcel, readCellPictures};
});
