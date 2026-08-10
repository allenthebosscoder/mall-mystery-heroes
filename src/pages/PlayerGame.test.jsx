/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the post-join waiting screen and the in-game target/status view:
 * renders room/player info, updates its status line when gameStarted flips,
 * redirects home when the room stops existing, shows the player's target(s)
 * or a placeholder once the game has started, shows an eliminated state,
 * and Leave signs out + clears the stored session
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md,
 * docs/superpowers/specs/2026-08-08-player-target-view-design.md).
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
import PlayerGame from './PlayerGame';
import {
    fetchRoomReferenceForRoom,
    fetchPlayerReferenceForRoom,
} from '../components/firebase_calls/dbCalls';
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
    fetchPlayerReferenceForRoom: jest.fn(),
}));
// Stubbed — each has its own thorough test file (MessageFeed.test.jsx,
// MessageComposer.test.jsx). This file stays focused on PlayerGame's own
// status-line logic and on wiring MessageFeed's props, not re-testing
// MessageFeed's internals — same reasoning GameMasterView.test.jsx stubs
// ChatInput.
jest.mock('../components/player_messages_components/MessageFeed', () => (props) => (
    <div>
        message-feed-stub roomID={props.roomID} playerName={props.playerName}
    </div>
));
jest.mock('../components/player_messages_components/MessageComposer', () => () => (
    <div>message-composer-stub</div>
));

const renderWaiting = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/rooms/Fluffy42317/waiting']}>
                <Routes>
                    <Route path="/rooms/:roomID/waiting" element={<PlayerGame />} />
                    <Route path="/" element={<div>Home page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fetchRoomReferenceForRoom.mockReturnValue('room-ref');
    fetchPlayerReferenceForRoom.mockReturnValue('player-ref');
    signOut.mockResolvedValue(undefined);
});

describe('PlayerGame', () => {
    it('shows the stored player name and room ID, waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Alice joined Fluffy42317')).toBeInTheDocument();
        expect(screen.getByText('Waiting for the host to start...')).toBeInTheDocument();
    });

    it('hides the waiting message once gameStarted flips true', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.queryByText('Waiting for the host to start...')).not.toBeInTheDocument();
    });

    it('clears the session and redirects home when the room no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => false });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when onSnapshot reports a permission error', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback, errorCallback) => {
            if (ref === 'room-ref') {
                errorCallback({
                    code: 'permission-denied',
                    message: 'Missing or insufficient permissions.',
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when the player-doc subscription reports a permission error', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback, errorCallback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                errorCallback({
                    code: 'permission-denied',
                    message: 'Missing or insufficient permissions.',
                });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('clears the session and redirects home when the player doc no longer exists', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => false });
            }
            return () => {};
        });

        renderWaiting();

        expect(await screen.findByText('Home page')).toBeInTheDocument();
        expect(readPlayerSession()).toBeNull();
    });

    it('signs out, clears the session, and navigates home when Leave is clicked', async () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        await userEvent.click(screen.getByRole('button', { name: 'Leave' }));

        expect(signOut).toHaveBeenCalled();
        expect(readPlayerSession()).toBeNull();
        expect(await screen.findByText('Home page')).toBeInTheDocument();
    });

    it('subscribes to the player doc once gameStarted is true and shows the target', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: ['Bob'] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Your target: Bob')).toBeInTheDocument();
    });

    it('does not subscribe to the player doc while still waiting for the host', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(fetchPlayerReferenceForRoom).not.toHaveBeenCalled();
    });

    it('shows a placeholder when alive but not yet assigned a target', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: true, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText('Waiting for your target...')).toBeInTheDocument();
    });

    it('shows an eliminated message instead of a target once isAlive is false', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: true }) });
            } else if (ref === 'player-ref') {
                callback({ exists: () => true, data: () => ({ isAlive: false, targets: [] }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(screen.getByText("You've been eliminated")).toBeInTheDocument();
        expect(
            screen.getByText(/you may be revived if the host assigns you a revival mission/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/your target/i)).not.toBeInTheDocument();
    });

    it('mounts the message feed even before the game has started', () => {
        writePlayerSession('Fluffy42317', 'Alice');
        onSnapshot.mockImplementation((ref, callback) => {
            if (ref === 'room-ref') {
                callback({ exists: () => true, data: () => ({ gameStarted: false }) });
            }
            return () => {};
        });

        renderWaiting();

        expect(
            screen.getByText('message-feed-stub roomID=Fluffy42317 playerName=Alice')
        ).toBeInTheDocument();
        expect(screen.getByText('message-composer-stub')).toBeInTheDocument();
    });
});
