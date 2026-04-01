'use strict';

/**
 * contractGenerator.js — Contract text generation from YAML template + user data
 * Evaluates conditions, applies variants, replaces placeholders.
 */

// ──────────────────────────────────────────────
//  Condition Evaluator
// ──────────────────────────────────────────────
function evalCondition(condition, data) {
    if (!condition || condition === 'null') return true;

    let expr = condition
        .replace(/\bAND\b/gi, '&&')
        .replace(/\bOR\b/gi, '||');

    // Handle NOT IN before general NOT
    expr = expr.replace(/(\w+)\s+NOT\s+IN\s+\[([^\]]+)\]/gi, (_, v, arr) => {
        const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
        return !items.includes(data[v]) ? 'true' : 'false';
    });

    // Handle IN
    expr = expr.replace(/(\w+)\s+IN\s+\[([^\]]+)\]/gi, (_, v, arr) => {
        const items = arr.split(',').map(s => s.trim().replace(/'/g, ''));
        return items.includes(data[v]) ? 'true' : 'false';
    });

    // Handle == comparisons
    expr = expr.replace(/(\w+)\s*==\s*'([^']+)'/g, (_, v, val) => {
        return data[v] === val ? 'true' : 'false';
    });

    // Replace NOT keyword
    expr = expr.replace(/\bNOT\b/gi, '!');

    // Replace boolean variables
    for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'boolean') {
            expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), val.toString());
        }
    }

    try {
        return Function('"use strict"; return (' + expr + ')')();
    } catch (e) {
        console.warn(`[contractGenerator] evalCondition failed for "${condition}": ${e.message} — defaulting to include`);
        return true; // default include
    }
}

// ──────────────────────────────────────────────
//  Placeholder Replacer
// ──────────────────────────────────────────────
function replacePlaceholders(text, data) {
    if (!text) return '';
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}

// ──────────────────────────────────────────────
//  Variant Applicator (for rubrum, signatures)
// ──────────────────────────────────────────────
function applyVariants(rawText, variants, data) {
    if (!variants || !variants.length) return rawText;
    let text = rawText;

    for (const v of variants) {
        if (!evalCondition(v.condition, data)) continue;

        if (v.replaces === 'VERKAEUFER_NAME block') {
            const rubrumSeller = /\{\{VERKAEUFER_NAME\}\},\n.*?(?=\n\s*— nachfolgend „Verkäufer")/s;
            const sigSeller = /_+\n\s*\{\{VERKAEUFER_NAME\}\}\n\s*\(Verkäufer\)/;
            if (rubrumSeller.test(text)) {
                text = text.replace(rubrumSeller, v.text.trimEnd());
            } else if (sigSeller.test(text)) {
                text = text.replace(sigSeller, v.text.trimEnd());
            }
        } else if (v.replaces === 'KAEUFER_NAME block') {
            const rubrumBuyer = /\{\{KAEUFER_NAME\}\},\n.*?(?=\n\s*— nachfolgend „Käufer")/s;
            const sigBuyer = /_+\n\s*\{\{KAEUFER_NAME\}\}\n.*?\(Käufer\)/s;
            if (rubrumBuyer.test(text)) {
                text = text.replace(rubrumBuyer, v.text.trimEnd());
            } else if (sigBuyer.test(text)) {
                text = text.replace(sigBuyer, v.text.trimEnd());
            }
        }
    }
    return text;
}

// ──────────────────────────────────────────────
//  Main Generator
// ──────────────────────────────────────────────
function generate(tpl, data) {
    const lines = [];

    const sections = tpl.sections
        .filter(s => evalCondition(s.condition, data))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const section of sections) {
        if (section.text) {
            let sectionText = section.text;
            if (section.variants) {
                sectionText = applyVariants(sectionText, section.variants, data);
            }
            lines.push(replacePlaceholders(sectionText, data));
        }

        if (section.clauses) {
            for (const clause of section.clauses) {
                if (!evalCondition(clause.condition, data)) continue;
                if (clause.text) {
                    lines.push(replacePlaceholders(clause.text, data));
                }
            }
        }

        lines.push('');
    }

    return lines.join('\n');
}

module.exports = { generate, evalCondition, replacePlaceholders };
