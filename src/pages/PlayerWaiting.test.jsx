/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the post-join waiting screen: renders room/player info, updates
 * its status line when gameStarted flips, redirects home when the room
 * stops existing, and Leave signs out + clears the stored session
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * Explicit mock factories for 'firebase/auth', 'firebase/firestore', and
 * '../components/firebase_calls/dbCalls' — see RequireAuth.test.jsx and
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe here.
 * playerSession is left unmocked: it touches only real jsdom localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import PlayerWaiting from './PlayerWaiting';
import { fetchRoomReferenceForRoom } from '../components/firebase_calls/dbCalls';
import { writePlayerSession, readPlayerSession } from '../utils/playerSession';

jest.mock('firebase/auth', () => ({
    signOut: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));
jest.mock('../components/firebase_calls/dbCalls', () => ({
    fetchRoomReferenceForRoom: jest.fn(),
}));

const renderWaiting = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/waiting']}>
                <Routes>
                    <Route path="/rooms/:roomID/waiting" element={<PlayerWaiting />} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fetchRoomReferenceForRoom.mockReturnValue('room-ref');
    signOut.mockResolvedValue(undefined);
});

describe('PlayerWaiting', () => {
    it('shows the stored player name and room ID, waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Alice joined Fluffy42317')).toBeInTheDocument();
        expect(screen.getByText('Waiting for the host to start...')).toBeInTheDocument();
    });

    it('updates the status line once gameStarted flips true', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('The game has started!')).toBeInTheDocument();
    });

    it('clears the session and redirects home when the room no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => false });
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when onSnapshot reports a permission error', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback, errorCallback) => {
            errorCallback({
                code: 'permission-denied',
                message: 'Missing or insufficient permissions.',
            });
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('signs out, clears the session, and navigates home when Leave is clicked', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

        expect(signOut).toHaveBeenCalled();
        expect(readPlayerSession()).toBeNull();
        expect(await screen.findByText('Home page')).toBeInTheDocument();
    });
});
