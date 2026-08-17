/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the join form: successful join (guest auth fires invisibly,
 * session persisted, navigates to the waiting screen) and each error path
 * joinRoom's Cloud Function can throw
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * Explicit mock factories for 'firebase/auth', '../utils/firebase', and
 * '../components/joinRoom' — see RequireAuth.test.jsx for why. playerSession
 * is left unmocked: it touches only real jsdom localStorage, not Firebase.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import JoinGame from './JoinGame';
import { joinRoom } from '../components/joinRoom';
import { readPlayerSession } from '../utils/playerSession';
import { auth } from '../utils/firebase';

jest.mock('firebase/auth', () => ({
    signInAnonymously: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/joinRoom', () => ({ joinRoom: jest.fn() }));

const renderJoinGame = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/join']}>
                <Routes>
                    <Route path="/join" element={<JoinGame />} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

const fillAndSubmit = async (gameId, playerName) => {
    await userEvent.type(screen.getByPlaceholderText('Game ID'), gameId);
    await userEvent.type(screen.getByPlaceholderText('Your name'), playerName);
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
};

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    signInAnonymously.mockResolvedValue({ user: { uid: 'guest-uid' } });
    auth.currentUser = null;
});

describe('JoinGame', () => {
    it('joins and navigates to the waiting screen on success', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(joinRoom).toHaveBeenCalledWith('Fluffy42317', 'Alice');
        expect(readPlayerSession()).toEqual({ roomID: 'Fluffy42317', playerName: 'Alice' });
    });

    it('does not call signInAnonymously when a GM is already signed in, but still joins', async () => {
        auth.currentUser = { uid: 'host-uid' };
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Waiting page')).toBeInTheDocument();
        expect(signInAnonymously).not.toHaveBeenCalled();
        expect(joinRoom).toHaveBeenCalledWith('Fluffy42317', 'Alice');
    });

    it('trims whitespace from the game ID before joining', async () => {
        joinRoom.mockResolvedValue(undefined);
        renderJoinGame();

        await fillAndSubmit('  Fluffy42317  ', 'Alice');

        await screen.findByText('Waiting page');
        expect(joinRoom).toHaveBeenCalledWith('Fluffy42317', 'Alice');
    });

    it('shows an inline error and does not navigate when the room does not exist', async () => {
        joinRoom.mockRejectedValue(new Error('Room not found: Nope99999'));
        renderJoinGame();

        await fillAndSubmit('Nope99999', 'Alice');

        expect(await screen.findByText('Room not found: Nope99999')).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });

    it('shows an inline error when the game has already started', async () => {
        joinRoom.mockRejectedValue(new Error('This game has already started.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('This game has already started.')).toBeInTheDocument();
    });

    it('shows an inline error when the room is no longer active', async () => {
        joinRoom.mockRejectedValue(new Error('This room is no longer active.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('This room is no longer active.')).toBeInTheDocument();
    });

    it('shows an inline error when the name is already taken', async () => {
        joinRoom.mockRejectedValue(new Error('Alice is already taken in this room.'));
        renderJoinGame();

        await fillAndSubmit('Fluffy42317', 'Alice');

        expect(await screen.findByText('Alice is already taken in this room.')).toBeInTheDocument();
    });

    it('limits the name input to 40 characters', () => {
        renderJoinGame();

        expect(screen.getByPlaceholderText('Your name')).toHaveAttribute('maxlength', '40');
    });
});
