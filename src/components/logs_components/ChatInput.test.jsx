/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * `executeKill` is a thin wrapper around a Cloud Function call now
 * (docs/improvements.md item 4) — validation, scoring, unmapping, and
 * remapping all happen server-side, inside `functions/callableFunctions/
 * killPlayer.js`, not in ChatInput.js. So these tests mock `executeKill`
 * itself rather than the individual Firestore calls it used to make; what's
 * left to verify here is ChatInput's own remaining job: normalize the typed
 * names, check them against the roster, call executeKill, and route its
 * response to the right handlers.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from './ChatInput';
import { executionContext, gameContext } from '../Contexts';
import * as dbCalls from '../firebase_calls/dbCalls';
import { executeKill } from '../executeKill';

// An explicit factory, not just `jest.mock('../firebase_calls/dbCalls')` —
// auto-mocking still loads the real module first to learn its shape, which
// pulls in utils/firebase.js's real initialization (getFunctions() touches
// `fetch`, undefined in jsdom).
jest.mock('../firebase_calls/dbCalls', () => ({
    addPlayerToCompletedByForTask: jest.fn(),
    fetchAlivePlayerNamesForRoom: jest.fn(),
    fetchAllPlayersForRoom: jest.fn(),
    fetchPlayersByStatusForRoom: jest.fn(),
    fetchReferenceByIndexForTask: jest.fn(),
    fetchTaskByIndexForRoom: jest.fn(),
    setOpenSznOfPlayerToValueForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
    updateIsCompleteToTrueForTaskByIndex: jest.fn(),
    updatePointsForPlayer: jest.fn(),
}));
jest.mock('../executeKill', () => ({ executeKill: jest.fn() }));
jest.mock('../RemapPlayers', () => () => async () => [[], []]);

const executionHandlers = {
    handleKillPlayer: jest.fn(),
    handleAddNewAssassins: jest.fn(),
    handleAddNewTargets: jest.fn(),
    handleSetShowMessageToTrue: jest.fn(),
    handleRemapping: jest.fn(),
    handleTaskCompleted: jest.fn(),
    handleShowMissionCreation: jest.fn(),
    handleShowMissionList: jest.fn(),
    addLog: jest.fn(),
};

const mountChatInput = () => {
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <executionContext.Provider value={executionHandlers}>
                    <ChatInput />
                </executionContext.Provider>
            </gameContext.Provider>
        </ChakraProvider>
    );
    return screen.getByRole('textbox');
};

const typeAndSubmit = (input, text) => userEvent.type(input, `${text}{enter}`);

beforeEach(() => {
    jest.clearAllMocks();
    // Realistic roster: stored with the GM's original capitalization.
    dbCalls.fetchAllPlayersForRoom.mockResolvedValue(['Alice', 'Bob']);
    dbCalls.fetchAlivePlayerNamesForRoom.mockResolvedValue(['Bob']);
    dbCalls.updatePointsForPlayer.mockResolvedValue(undefined);
    executeKill.mockResolvedValue({
        targetWasOpenSzn: false,
        addedTargets: {},
        addedAssassins: {},
        remapLogs: [],
    });
});

describe('/kill (improvements item 4: executeKill is now a Cloud Function call)', () => {
    it('normalizes both names and routes the response to the right handlers', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() => expect(executeKill).toHaveBeenCalledWith('alice', 'bob', 'room-a'));
        expect(executionHandlers.handleKillPlayer).toHaveBeenCalledWith('alice', 'bob', false);
    });

    it('rejects a kill for a name not on the roster without calling executeKill', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill nobody bob');

        expect(await screen.findByText(/invalid players/i)).toBeInTheDocument();
        expect(executeKill).not.toHaveBeenCalled();
    });

    it('passes remapLogs, addedTargets, and addedAssassins from the response through to their handlers', async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: false,
            addedTargets: { bob: ['carol'] },
            addedAssassins: { carol: ['bob'] },
            remapLogs: ['New target for bob: carol'],
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() =>
            expect(executionHandlers.handleRemapping).toHaveBeenCalledWith(
                'New target for bob: carol'
            )
        );
        expect(executionHandlers.handleAddNewTargets).toHaveBeenCalledWith({ bob: ['carol'] });
        expect(executionHandlers.handleAddNewAssassins).toHaveBeenCalledWith({
            carol: ['bob'],
        });
        expect(executionHandlers.handleSetShowMessageToTrue).toHaveBeenCalled();
    });
});

describe('/kill with a multi-word bracketed player name (improvements item 35)', () => {
    it('normalizes a name with an internal space before calling executeKill', async () => {
        dbCalls.fetchAllPlayersForRoom.mockResolvedValue(['Alice Smith', 'Bob']);

        const commandInput = mountChatInput();
        // user-event v13's type() treats a bare `[` as special syntax —
        // `[[` escapes to a literal `[`. `]` needs no escaping. This types
        // the literal string "/kill [Alice Smith] bob".
        typeAndSubmit(commandInput, '/kill [[Alice Smith] bob');

        await waitFor(() =>
            expect(executeKill).toHaveBeenCalledWith('alicesmith', 'bob', 'room-a')
        );
    });
});

describe('open-season flag passed to handleKillPlayer (improvements item 8)', () => {
    it("uses executeKill's targetWasOpenSzn, not any locally-derived flag", async () => {
        executeKill.mockResolvedValue({
            targetWasOpenSzn: true,
            addedTargets: {},
            addedAssassins: {},
            remapLogs: [],
        });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill alice bob');

        await waitFor(() => expect(executionHandlers.handleKillPlayer).toHaveBeenCalled());
        expect(executionHandlers.handleKillPlayer).toHaveBeenCalledWith('alice', 'bob', true);
    });
});

describe('/add with a capitalized player name (improvements item 1)', () => {
    it('accepts the player despite parseCommand not lowercasing args', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/add Alice 5');

        await waitFor(() => expect(dbCalls.updatePointsForPlayer).toHaveBeenCalled());
        expect(dbCalls.updatePointsForPlayer).toHaveBeenCalledWith('alice', 5, 'room-a');
    });
});

describe('a rejected executeKill surfaces as a toast (improvements item 5)', () => {
    it('shows the Cloud Function error instead of killing anyway', async () => {
        executeKill.mockRejectedValue(new Error('bob is not a valid target for alice'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/kill bob alice');

        expect(await screen.findByText(/bob is not a valid target for alice/i)).toBeInTheDocument();
        expect(executionHandlers.handleKillPlayer).not.toHaveBeenCalled();
    });
});

describe('/mission end does not toast success before the write succeeds (improvements item 20)', () => {
    it('shows an error and does not toast success when the task index is invalid', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue(undefined);

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission end 5');

        expect(await screen.findByText(/invalid task index/i)).toBeInTheDocument();
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).not.toHaveBeenCalled();
        expect(executionHandlers.handleTaskCompleted).not.toHaveBeenCalled();
        expect(screen.queryByText(/task has been saved as completed/i)).not.toBeInTheDocument();
    });

    it('toasts success and calls handleTaskCompleted once the write succeeds', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ title: 'Find the clue' });
        dbCalls.updateIsCompleteToTrueForTaskByIndex.mockResolvedValue(undefined);

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission end 2');

        await waitFor(() =>
            expect(executionHandlers.handleTaskCompleted).toHaveBeenCalledWith('Find the clue')
        );
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).toHaveBeenCalledWith(2, 'room-a');
        expect(await screen.findByText(/task has been saved as completed/i)).toBeInTheDocument();
    });
});

describe('/mission start and /mission view open the mission modals (improvements item 15)', () => {
    it('/mission start calls handleShowMissionCreation', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission start');

        await waitFor(() => expect(executionHandlers.handleShowMissionCreation).toHaveBeenCalled());
    });

    it('/mission view calls handleShowMissionList', async () => {
        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission view');

        await waitFor(() => expect(executionHandlers.handleShowMissionList).toHaveBeenCalled());
    });
});

describe('/mission done (bug report: ended missions, missing chat log, completion cap)', () => {
    const baseTask = {
        title: 'Find the clue',
        taskType: 'Task',
        pointValue: '10',
        completedBy: [],
        isComplete: false,
        maxCompletions: null,
    };

    it('rejects completing a mission that has already ended', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask, isComplete: true });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        expect(await screen.findByText(/mission 1 has already ended/i)).toBeInTheDocument();
        expect(dbCalls.updatePointsForPlayer).not.toHaveBeenCalled();
        expect(dbCalls.addPlayerToCompletedByForTask).not.toHaveBeenCalled();
    });

    it('logs the completion to chat', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'bob completed mission: Find the clue',
                'green.400'
            )
        );
    });

    it('auto-ends the mission and announces it once the completion cap is reached', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask, maxCompletions: 1 });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).toHaveBeenCalledWith(1, 'room-a')
        );
        expect(executionHandlers.addLog).toHaveBeenCalledWith(
            'Mission "Find the clue" auto-ended — reached its 1-completion cap',
            'purple.400'
        );
    });

    it('does not auto-end the mission before the completion cap is reached', async () => {
        dbCalls.fetchTaskByIndexForRoom.mockResolvedValue({ ...baseTask, maxCompletions: 2 });

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/mission done bob 1');

        await waitFor(() =>
            expect(executionHandlers.addLog).toHaveBeenCalledWith(
                'bob completed mission: Find the clue',
                'green.400'
            )
        );
        expect(dbCalls.updateIsCompleteToTrueForTaskByIndex).not.toHaveBeenCalled();
    });
});

describe('Tab accepts an autosuggest match (bug report: typing full commands is troublesome)', () => {
    it('completes the input to the only matching suggestion on Tab', async () => {
        const commandInput = mountChatInput();

        await userEvent.type(commandInput, '/mission s');
        expect(await screen.findByText('/mission start')).toBeInTheDocument();
        expect(screen.queryByText('/mission done [player name] mission_index')).toBeNull();

        await userEvent.tab();

        expect(commandInput).toHaveValue('/mission start');
    });
});

describe('silent no-ops now give feedback (improvements item 21)', () => {
    it('/revive on a player who is not dead shows an error instead of doing nothing', async () => {
        dbCalls.fetchPlayersByStatusForRoom.mockResolvedValue([]); // nobody dead

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/revive alice');

        expect(await screen.findByText(/alice is not dead/i)).toBeInTheDocument();
        expect(dbCalls.updateIsAliveForPlayer).not.toHaveBeenCalled();
    });

    it.each(['/broadcast hello', '/leaderboard', '/whisper alice hi'])(
        '%s toasts "not implemented" instead of silently doing nothing',
        async (command) => {
            const [commandLine] = command.split(' ');
            const commandInput = mountChatInput();
            typeAndSubmit(commandInput, command);

            expect(
                await screen.findByText(new RegExp(`${commandLine} is not implemented yet`, 'i'))
            ).toBeInTheDocument();
            // None of these need the roster — confirms the check short-circuits
            // before the Firestore call, not just before the switch case.
            expect(dbCalls.fetchAllPlayersForRoom).not.toHaveBeenCalled();
        }
    );
});

describe('a thrown dbCalls error surfaces to the GM (improvements item 10)', () => {
    it('shows a toast instead of failing silently', async () => {
        // Before item 10, dbCalls functions swallowed errors and returned
        // undefined, so a failure here would previously do nothing visible.
        dbCalls.updatePointsForPlayer.mockRejectedValue(new Error('network down'));

        const commandInput = mountChatInput();
        typeAndSubmit(commandInput, '/add Alice 5');

        expect(await screen.findByText(/\/add failed: network down/i)).toBeInTheDocument();
    });
});
