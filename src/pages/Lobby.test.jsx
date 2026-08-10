/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers Lobby's player roster: a live subscription, not a one-time fetch
 * (docs/improvements.md item 13 extended here from GameMasterView, which
 * this covers) — a player who joins from another device (e.g. self-join via
 * /join) now shows up without the GM reloading the page.
 *
 * TargetGenerator/PlayerAddition/PlayerRemove are exercised for real (not
 * stubbed) since none of them do anything on mount that touches Firebase —
 * they only act on user interaction, which this file never triggers. All
 * three import from dbCalls.js, so the explicit mock factory below covers
 * every function any of them need, the same reasoning as every other
 * dbCalls mock in this repo (see ChatInput.test.jsx).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import Lobby from './Lobby';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchAllPlayersQueryForRoom: jest.fn(() => 'players-query'),
    addPlayerForRoom: jest.fn(),
    removePlayerForRoom: jest.fn(),
    addLogForRoom: jest.fn(),
    markGameAsStarted: jest.fn(),
    updateAssassinsForPlayer: jest.fn(),
    updateTargetsForPlayer: jest.fn(),
}));

const asPlayerDocs = (names) => names.map((name) => ({ data: () => ({ name }) }));

// PlayerRemove's <select> also renders each player's name as an <option>,
// so a bare getByText('Alice') is ambiguous (matches both the roster list
// item and the dropdown option) — scope to listitem role to read only the
// roster PlayerList actually renders.
const rosterNames = () => screen.getAllByRole('listitem').map((item) => item.textContent);

const mountLobby = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/room-a/lobby']}>
                <Routes>
                    <Route path="/rooms/:roomID/lobby" element={<Lobby />} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the player roster is a live subscription, not a one-time fetch', () => {
    it('shows players from the subscribed snapshot on mount', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({ docs: asPlayerDocs(['Alice', 'Bob']) });
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    });

    it('shows a player who joins from another device without a reload', () => {
        let deliverPlayers;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverPlayers = onNext;
            onNext({ docs: asPlayerDocs(['Alice']) });
            return () => {};
        });

        mountLobby();
        expect(screen.getByText('Players (1)')).toBeInTheDocument();

        // Simulates a player self-joining from a second device/tab — the
        // point of a live subscription is this needs no reload to show up.
        act(() => {
            deliverPlayers({ docs: asPlayerDocs(['Alice', 'Carol']) });
        });

        expect(screen.getByText('Players (2)')).toBeInTheDocument();
        expect(rosterNames()).toEqual(expect.arrayContaining(['Alice', 'Carol']));
    });

    it('surfaces a subscription error instead of leaving the roster silently empty', () => {
        onSnapshot.mockImplementation((query, onNext, onError) => {
            onError(new Error('boom'));
            return () => {};
        });

        mountLobby();

        expect(screen.getByText('Players (0)')).toBeInTheDocument();
        expect(screen.getByText('Error updating arrayOfPlayers')).toBeInTheDocument();
    });
});
