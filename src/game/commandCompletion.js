import { KNOWN_COMMANDS, UNIMPLEMENTED_COMMANDS } from './commands';

// Matches a leading /command, a [bracketed placeholder], or a bare word.
const TOKEN = /\/\S+|\[[^\]]+\]|\S+/g;

const MISSION_SUBCOMMANDS = ['done', 'end', 'start', 'view'];

const enumValues = (pipeSeparated) => pipeSeparated.split('|');

const longestCommonPrefixLength = (arr) => {
    if (!arr || arr.length === 0) return 0;
    if (arr.length === 1) return arr[0].length;
    const lowered = arr.map((s) => String(s));
    const minLen = Math.min(...lowered.map((s) => s.length));
    let i = 0;
    for (; i < minLen; i++) {
        const ch = lowered[0][i].toLowerCase();
        for (let j = 1; j < lowered.length; j++) {
            if (lowered[j][i].toLowerCase() !== ch) return i;
        }
    }
    return i;
};

const normalize = (s) => String(s || '');

const toPlayerNames = (players = []) => players.map((p) => p.name || p);

const toDeadPlayerNames = (players = []) => players.filter((p) => p.isAlive === false).map((p) => p.name || p);

const toActiveMissionIndices = (missions = []) => missions.filter((m) => !m.isComplete).map((m) => String(m.taskIndex));

// Public API: pure, synchronous. ChatInput is responsible for fetching
// missions and passing them in.
export function complete(input, { players = [], missions = [] } = {}) {
    const value = String(input ?? '');

    // If the cursor is after a trailing space, do nothing per spec.
    if (value.endsWith(' ') || value.length === 0) {
        return { applied: false, candidates: [] };
    }

    // tokenization with positions
    const tokens = [];
    let match;
    while ((match = TOKEN.exec(value)) !== null) {
        tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    }

    if (tokens.length === 0) return { applied: false, candidates: [] };

    const current = tokens[tokens.length - 1];
    const tokenRaw = current.text;
    const tokenStripped = tokenRaw.replace(/[[\]]/g, '');
    const stripped = tokens.map((t) => t.text.replace(/[[\]]/g, ''));
    const command = String(stripped[0] || '').toLowerCase();

    const tokenIndex = tokens.length - 1; // slot index counting from 0 = command word

    // Helper to produce case-insensitive candidate matching and compute replacement
    const buildResult = (candidates, preserveBracketsForMultiWord = true) => {
        const uniqueCandidates = candidates || [];
        if (uniqueCandidates.length === 0) return { applied: false, candidates: [] };

        const lowerToken = tokenStripped.toLowerCase();
        const matches = uniqueCandidates.filter((c) => String(c).toLowerCase().startsWith(lowerToken));
        // Prefer exact matches over longer prefix matches (e.g. '1' vs '123')
        const exact = matches.find((m) => String(m).toLowerCase() === lowerToken);
        const effectiveMatches = exact ? [exact] : matches;
        if (matches.length === 0) return { applied: false, candidates: [] };
        const lcpLen = longestCommonPrefixLength(effectiveMatches.map((m) => String(m)));
        // Use the first effective match's casing for the prefix slice
        const prefix = String(effectiveMatches[0]).slice(0, lcpLen);

        let replacementRaw = prefix;
        // If unique (or exact chosen), prefer the full candidate
        if (effectiveMatches.length === 1) {
            replacementRaw = String(effectiveMatches[0]);
        }

        // bracket wrapping for names with spaces
        const needsBrackets = preserveBracketsForMultiWord && /\s/.test(replacementRaw);
        const replacement = needsBrackets ? `[${replacementRaw}]` : replacementRaw;

        return {
            applied: true,
            tokenStart: current.start,
            tokenEnd: current.end,
            replacement,
            candidates: effectiveMatches,
            appendSpace: effectiveMatches.length === 1 && String(effectiveMatches[0]).length === replacementRaw.length,
        };
    };

    // Slot 0: command-word completion
    if (tokenIndex === 0) {
        return buildResult(KNOWN_COMMANDS);
    }

    // If the typed command is not known, don't suggest data-driven args.
    if (!KNOWN_COMMANDS.includes(command)) {
        // but if we're still typing the command word this would have been handled above
        return { applied: false, candidates: [] };
    }

    // Handle unimplemented commands: only complete the command-word itself
    if (UNIMPLEMENTED_COMMANDS.includes(command)) {
        return { applied: false, candidates: [] };
    }

    // Special handling for /mission subcommands
    if (command === '/mission') {
        // slot 1 is the sub-command (done/end/start/view)
        if (tokenIndex === 1) return buildResult(MISSION_SUBCOMMANDS);

        const sub = String(stripped[1] || '').toLowerCase();
        // /mission done <player> <index>
        if (sub === 'done') {
            if (tokenIndex === 2) return buildResult(toPlayerNames(players));
            if (tokenIndex === 3) return buildResult(toActiveMissionIndices(missions), false);
            return { applied: false, candidates: [] };
        }

        // /mission end <index>
        if (sub === 'end') {
            if (tokenIndex === 2) return buildResult(toActiveMissionIndices(missions), false);
            return { applied: false, candidates: [] };
        }

        // /mission start/view take no args
        return { applied: false, candidates: [] };
    }

    // Other commands mapping
    switch (command) {
        case '/add':
            if (tokenIndex === 1) return buildResult(toPlayerNames(players));
            return { applied: false, candidates: [] };
        case '/kill':
            if (tokenIndex === 1) return buildResult(toPlayerNames(players));
            if (tokenIndex === 2) return buildResult(toPlayerNames(players));
            return { applied: false, candidates: [] };
        case '/openseason':
            if (tokenIndex === 1) return buildResult(toPlayerNames(players));
            if (tokenIndex === 2) return buildResult(enumValues('start|end'));
            return { applied: false, candidates: [] };
        case '/revive':
            if (tokenIndex === 1) return buildResult(toDeadPlayerNames(players));
            return { applied: false, candidates: [] };
        case '/whisper':
            if (tokenIndex === 1) return buildResult(toPlayerNames(players));
            return { applied: false, candidates: [] };
        default:
            return { applied: false, candidates: [] };
    }
}

export default { complete };
