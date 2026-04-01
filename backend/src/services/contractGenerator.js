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
        // For person_list fields, prefer the _TEXT flat representation
        if (Array.isArray(data[key]) && data[key + '_TEXT'] !== undefined) {
            return data[key + '_TEXT'];
        }
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
//  Dynamic Clause Renumbering
// ──────────────────────────────────────────────
/**
 * Renumbers clause paragraphs within each § section so that there are
 * no gaps when conditional clauses are excluded.
 * Handles patterns like (1), (2), (3a), (10a) at the start of lines.
 * Also renumbers § headers (§ 1 → § 2 etc.) sequentially.
 */
function renumberClauses(text) {
    // Split into § sections
    const sectionPattern = /^(§\s*)(\d+)(.*)/;
    const clausePattern = /^(\s*)\((\d+)((?:[a-z])?)\)/;

    const lines = text.split('\n');
    const result = [];

    let currentSectionNum = 0;    // running § counter
    let clauseCounter = 0;        // running clause counter within section
    let lastBaseNum = null;       // last base digit seen (for letter suffixes)
    let currentLetterSuffix = ''; // tracking letter suffixes like 'a', 'b'

    // First pass: build a map of old § numbers to new § numbers
    const sectionMap = {};        // { old# → new# }
    let tempCounter = 0;
    for (const line of lines) {
        const sm = line.match(/^§\s*(\d+)/);
        if (sm) {
            tempCounter++;
            sectionMap[sm[1]] = String(tempCounter);
        }
    }

    // Second pass: renumber everything
    currentSectionNum = 0;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Check for § header
        const sm = line.match(sectionPattern);
        if (sm) {
            currentSectionNum++;
            clauseCounter = 0;
            lastBaseNum = null;
            line = `${sm[1]}${currentSectionNum}${sm[3]}`;
            // Replace § cross-references in same line (rare, but possible)
        }

        // Check for clause number like (1), (2a), etc.
        const cm = line.match(clausePattern);
        if (cm) {
            const indent = cm[1];
            const oldBase = cm[2];
            const suffix = cm[3] || '';

            if (suffix) {
                // Letter suffix like (2a) — keep same base as parent, just increment suffix
                if (oldBase !== lastBaseNum) {
                    // New base with suffix — increment clause counter
                    clauseCounter++;
                    lastBaseNum = oldBase;
                }
                line = line.replace(clausePattern, `${indent}(${clauseCounter}${suffix})`);
            } else {
                // Plain number like (2) — increment
                clauseCounter++;
                lastBaseNum = oldBase;
                line = line.replace(clausePattern, `${indent}(${clauseCounter})`);
            }
        }

        // Replace § cross-references like "§ 8 Abs." or "gemäß § 11"
        // Only replace within text (not headers), using the sectionMap
        if (!sm) {
            line = line.replace(/§\s*(\d+)/g, (match, num) => {
                const mapped = sectionMap[num];
                return mapped ? `§ ${mapped}` : match;
            });
        }

        result.push(line);
    }

    return result.join('\n');
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

    let result = lines.join('\n');

    // Renumber clauses to close gaps from excluded conditional clauses
    result = renumberClauses(result);

    return result;
}

module.exports = { generate, evalCondition, replacePlaceholders };
