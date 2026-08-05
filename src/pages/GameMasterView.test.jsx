/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 13: GameMasterView's player roster is now
 * a live subscription, not fetched once and mutated by hand — this is what
 * the standing CLAUDE.md note ("don't write component tests asserting
 * game-state outcomes until [item 13 is] fixed") was blocking on.
 *
 * ChatInput and PhotosDisplay are stubbed out (each already has its own
 * thorough test file) so this stays focused on GameMasterView's own logic:
 * deriving the header count and the alive-only roster it hands down.
 * ResetTargetsButton is stubbed too, for the same reason — its own dialog
 * UI is its concern, not GameMasterView's; what GameMasterView is
 * responsible for is computing the right `arrayOfPlayers` prop to give it.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import GameMasterView from './GameMasterView';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

// Explicit factory, not auto-mock — see ChatInput.test.jsx for why.
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchPlayersQueryByDescendPointsThenIsAliveForRoom: jest.fn(() => 'players-query'),
    fetchLogsQueryByAscendingTimestampForRoom: jest.fn(() => 'logs-query'),
    addLogForRoom: jest.fn(),
    updateIsAliveForPlayer: jest.fn(),
    endGame: jest.fn(),
}));

jest.mock('../components/logs_components/ChatInput', () => () => <div>chat-input-stub</div>);
jest.mock('../components/photos_display_component/PhotosDisplay', () => () => (
    <div>photos-display-stub</div>
));
jest.mock('../components/header_components/ResetTargetsButton', () => ({ arrayOfPlayers }) => (
    <div data-testid="reset-targets-stub">{JSON.stringify(arrayOfPlayers)}</div>
));
// TaskCreationModal/TaskListModal (item 15's mission modals) have their
// own test coverage (TaskCreationModal.test.jsx, TaskListModal.test.jsx) —
// stubbed here for the same reason ChatInput/PhotosDisplay/ResetTargetsButton
// are: this file stays focused on GameMasterView's own logic.
jest.mock('../components/task_components/TaskCreationModal', () => () => (
    <div>task-creation-modal-stub</div>
));
jest.mock('../components/task_components/TaskListModal', () => () => (
    <div>task-list-modal-stub</div>
));

const asPlayerDocs = (players) => players.map((player) => ({ data: () => player }));

const mountGameMasterView = () => {
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/GameMasterView']}>
                <Routes>
                    <Route path="/rooms/:roomID/GameMasterView" element={<GameMasterView />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );
};

/** Simulates onSnapshot reporting the given players immediately, and an
 * empty logs snapshot, regardless of mount order. */
const mockPlayersSnapshot = (players) => {
    onSnapshot.mockImplementation((query, onNext) => {
        onNext({ docs: query === 'players-query' ? asPlayerDocs(players) : [] });
        return () => {};
    });
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the player roster is a live subscription, not stale state (improvements item 13)', () => {
    it('shows the header count from the subscribed snapshot, not a frozen count', async () => {
        mockPlayersSnapshot([
            { name: 'Alice', score: 10, targets: [], openSeason: false, isAlive: true },
            { name: 'Bob', score: 5, targets: [], openSeason: false, isAlive: false },
        ]);

        mountGameMasterView();

        // Before this fix, the header read from router state frozen at
        // navigation time — a reload (no router state) always showed
        // "Players (0)" regardless of the real roster.
        expect(await screen.findByText('Players (2)')).toBeInTheDocument();
    });

    it('updates the header count when the subscription reports a change', async () => {
        let onNext;
        onSnapshot.mockImplementation((query, callback) => {
            if (query === 'players-query') onNext = callback;
            callback({
                docs:
                    query === 'players-query'
                        ? asPlayerDocs([
                              {
                                  name: 'Alice',
                                  score: 0,
                                  targets: [],
                                  openSeason: false,
                                  isAlive: true,
                              },
                          ])
                        : [],
            });
            return () => {};
        });

        mountGameMasterView();
        expect(await screen.findByText('Players (1)')).toBeInTheDocument();

        // Simulates a second GM adding a player in another tab — the point
        // of a live subscription is this needs no reload to show up.
        act(() => {
            onNext({
                docs: asPlayerDocs([
                    { name: 'Alice', score: 0, targets: [], openSeason: false, isAlive: true },
                    { name: 'Carol', score: 0, targets: [], openSeason: false, isAlive: true },
                ]),
            });
        });

        expect(await screen.findByText('Players (2)')).toBeInTheDocument();
    });

    it('passes only alive players to the reset-targets roster, not the full player list', async () => {
        mockPlayersSnapshot([
            { name: 'Alice', score: 10, targets: [], openSeason: false, isAlive: true },
            { name: 'Bob', score: 5, targets: [], openSeason: false, isAlive: false },
        ]);

        mountGameMasterView();

        expect(await screen.findByTestId('reset-targets-stub')).toHaveTextContent(
            JSON.stringify(['Alice'])
        );
    });
});
