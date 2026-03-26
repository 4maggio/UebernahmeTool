'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');

let client;

function getClient() {
    if (!client) {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * Erstellt einen strukturierten KB-Update-Vorschlag basierend auf einem gescrapten Gesetzestext.
 * Gibt null zurück wenn der API-Call fehlschlägt.
 */
async function generateKbUpdateProposal(paragraph, scrapedText, sourceUrl) {
    try {
        const systemPrompt = `Du bist ein Experte für deutsches Wirtschafts-, Steuer- und Gesellschaftsrecht mit Schwerpunkt Unternehmensübernahmen und -verkäufe. Deine Aufgabe ist es, Gesetzestexte in präzise, praxisorientierte Wissensbasen-Einträge für ein Unternehmensübernahme-Analyse-Tool zu übersetzen. Die Zielgruppe sind Unternehmer, Gründer und KMU-Käufer, keine Juristen. Antworte immer auf Deutsch UND Englisch.`;

        const userPrompt = `Der folgende Gesetzestext (${paragraph}) wurde von gesetze-im-internet.de abgerufen und möglicherweise aktualisiert.

GESETZESTEXT:
${scrapedText.substring(0, 4000)}

Erstelle einen strukturierten Wissensbasen-Eintrag mit:
1. content_de: Praxisorientierte Erklärung des Paragraphen für Unternehmenskäufer/-verkäufer (Markdown, max. 600 Wörter). Fokus auf: Was bedeutet das für den Asset Deal / Share Deal? Welche Risiken/Chancen entstehen?
2. content_en: Englische Übersetzung (Markdown, max. 600 Wörter)
3. summary_de: Kurzzusammenfassung (max. 300 Zeichen)
4. summary_en: English summary (max. 300 Zeichen)
5. diff_summary: Was hat sich im Vergleich zur klassischen Interpretation geändert? (max. 200 Zeichen)

Antworte AUSSCHLIESSLICH als gültiges JSON-Objekt mit den Schlüsseln: content_de, content_en, summary_de, summary_en, diff_summary`;

        const response = await getClient().chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 2000,
            temperature: 0.1, // Low temperature for factual legal content
        });

        const result = JSON.parse(response.choices[0].message.content);
        return result;
    } catch (err) {
        logger.error(`[AI] generateKbUpdateProposal failed for ${paragraph}:`, err.message);
        return null;
    }
}

/**
 * Erweitert einen Analysebericht mit einer KI-generierten Empfehlung.
 */
async function generateAnalysisNarrative(valuationResult, inputData, lang = 'de') {
    try {
        const prompt = lang === 'de'
            ? `Du bist ein erfahrener M&A-Berater für KMU. Anhand der folgenden Bewertungsdaten erstelle eine kurze, klar verständliche Zusammenfassung für den Käufer (3-5 Sätze). Fokus auf die wichtigsten Risiken und die Kaufempfehlung. Antworte auf Deutsch.`
            : `You are an experienced M&A advisor for SMEs. Based on the following valuation data, write a brief executive summary for the buyer (3-5 sentences). Focus on key risks and the acquisition recommendation. Answer in English.`;

        const data = JSON.stringify({
            recommendedValue: valuationResult.summary?.recommendedValue,
            riskScore: valuationResult.summary?.riskScore,
            riskFactors: valuationResult.risk?.factors?.filter(f => f.status === 'red').map(f => f.label),
            legalForm: inputData.legalForm,
            dealRecommendation: valuationResult.dealRecommendation?.recommended,
            warnings: valuationResult.warnings?.map(w => w.title),
        });

        const response = await getClient().chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: `Bewertungsdaten: ${data}` },
            ],
            max_tokens: 400,
            temperature: 0.3,
        });

        return response.choices[0].message.content;
    } catch (err) {
        logger.error('[AI] generateAnalysisNarrative failed:', err.message);
        return null;
    }
}

module.exports = { generateKbUpdateProposal, generateAnalysisNarrative };
