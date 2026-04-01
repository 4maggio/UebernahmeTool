'use strict';

/**
 * contractExport.js — Export contract text as PDF or DOCX
 * Uses `docx` for Word and `pdfkit` for PDF.
 */

const docx = require('docx');
const PDFDocument = require('pdfkit');

// ──────────────────────────────────────────────
//  DOCX Export
// ──────────────────────────────────────────────
async function toDocx(contractText, data) {
    const lines = contractText.split('\n');
    const children = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Empty line → spacing paragraph
        if (!trimmed) {
            children.push(new docx.Paragraph({ spacing: { after: 120 } }));
            continue;
        }

        // Main title: "ASSET-KAUFVERTRAG"
        if (trimmed.startsWith('ASSET-KAUFVERTRAG')) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, bold: true, size: 28, font: 'Arial' })],
                alignment: docx.AlignmentType.CENTER,
                spacing: { after: 80 },
            }));
            continue;
        }

        // Section headers: "§ X Titel"
        if (/^§\s*\d+/.test(trimmed)) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, bold: true, size: 24, font: 'Arial' })],
                spacing: { before: 360, after: 160 },
                heading: docx.HeadingLevel.HEADING_2,
            }));
            continue;
        }

        // Sub-headers like "(1)", "(2)", "(3)" etc. at start of line
        if (/^\(\d+[a-z]?\)/.test(trimmed)) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, size: 20, font: 'Arial' })],
                spacing: { before: 120, after: 60 },
                indent: { left: 360 },
            }));
            continue;
        }

        // Signature lines
        if (trimmed.startsWith('_____')) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, size: 20, font: 'Arial' })],
                spacing: { before: 480, after: 40 },
            }));
            continue;
        }

        // "ANLAGENVERZEICHNIS" header
        if (trimmed === 'ANLAGENVERZEICHNIS') {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, bold: true, size: 24, font: 'Arial' })],
                spacing: { before: 360, after: 160 },
                heading: docx.HeadingLevel.HEADING_2,
            }));
            continue;
        }

        // Anlage references
        if (trimmed.startsWith('Anlage ')) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, size: 20, font: 'Arial' })],
                spacing: { after: 40 },
                indent: { left: 360 },
            }));
            continue;
        }

        // "— nachfolgend" party designations
        if (trimmed.startsWith('—') && trimmed.includes('nachfolgend')) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: trimmed, italics: true, size: 20, font: 'Arial' })],
                alignment: docx.AlignmentType.CENTER,
                spacing: { before: 80, after: 80 },
            }));
            continue;
        }

        // Regular indented content (starts with spaces)
        const indentLevel = line.search(/\S/) >= 4 ? 720 : (line.search(/\S/) >= 2 ? 360 : 0);
        children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: trimmed, size: 20, font: 'Arial' })],
            spacing: { after: 40 },
            indent: { left: indentLevel },
        }));
    }

    const doc = new docx.Document({
        creator: 'Übernahme-Tool Vertragsgenerator',
        title: `Asset-Kaufvertrag ${data.UNTERNEHMENSNAME || ''}`.trim(),
        description: 'Automatisch generierter Asset-Kaufvertrag',
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: 1440,    // 1 inch
                        bottom: 1440,
                        left: 1440,
                        right: 1080,
                    },
                },
            },
            children,
        }],
    });

    return docx.Packer.toBuffer(doc);
}

// ──────────────────────────────────────────────
//  PDF Export
// ──────────────────────────────────────────────
async function toPdf(contractText, data) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 72, bottom: 72, left: 72, right: 56 },
            info: {
                Title: `Asset-Kaufvertrag ${data.UNTERNEHMENSNAME || ''}`.trim(),
                Author: 'Übernahme-Tool Vertragsgenerator',
            },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const lines = contractText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            if (!trimmed) {
                doc.moveDown(0.3);
                continue;
            }

            // Title
            if (trimmed.startsWith('ASSET-KAUFVERTRAG')) {
                doc.font('Helvetica-Bold').fontSize(14).text(trimmed, { align: 'center' });
                doc.moveDown(0.2);
                continue;
            }

            // Subtitle
            if (trimmed.startsWith('(Unternehmenskaufvertrag')) {
                doc.font('Helvetica').fontSize(10).text(trimmed, { align: 'center' });
                doc.moveDown(0.5);
                continue;
            }

            // Section headers
            if (/^§\s*\d+/.test(trimmed)) {
                doc.moveDown(0.6);
                doc.font('Helvetica-Bold').fontSize(11).text(trimmed);
                doc.moveDown(0.3);
                continue;
            }

            // Sub-paragraphs
            if (/^\(\d+[a-z]?\)/.test(trimmed)) {
                doc.font('Helvetica').fontSize(9.5).text(trimmed, { indent: 20 });
                doc.moveDown(0.15);
                continue;
            }

            // Signature lines
            if (trimmed.startsWith('_____')) {
                doc.moveDown(1.5);
                doc.font('Helvetica').fontSize(9.5).text(trimmed);
                continue;
            }

            // ANLAGENVERZEICHNIS
            if (trimmed === 'ANLAGENVERZEICHNIS') {
                doc.moveDown(0.6);
                doc.font('Helvetica-Bold').fontSize(11).text(trimmed);
                doc.moveDown(0.3);
                continue;
            }

            // Party designation
            if (trimmed.startsWith('—') && trimmed.includes('nachfolgend')) {
                doc.font('Helvetica-Oblique').fontSize(9.5).text(trimmed, { align: 'center' });
                doc.moveDown(0.2);
                continue;
            }

            // Regular text
            const indent = lines[i].search(/\S/) >= 4 ? 40 : (lines[i].search(/\S/) >= 2 ? 20 : 0);
            doc.font('Helvetica').fontSize(9.5).text(trimmed, { indent });
            doc.moveDown(0.08);
        }

        doc.end();
    });
}

module.exports = { toDocx, toPdf };
