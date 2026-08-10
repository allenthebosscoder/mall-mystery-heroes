/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers MessageFeed's live subscription and client-side filtering: a
 * player sees broadcasts and leaderboard sends (recipient: null) plus any
 * whisper addressed to them, but not whispers addressed to someone else.
 * This filtering is a display convenience, not a security boundary —
 * firestore.rules already grants any player-of-the-room read access to
 * the whole collection
 * (docs/superpowers/specs/2026-08-10-player-chat-messaging-design.md).
 *
 * Explicit mock factory for 'firebase/firestore', not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import MessageFeed from './MessageFeed';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

const asMessageDocs = (messages) => messages.map((message) => ({ data: () => message }));

const mountFeed = (playerName = 'Alice') =>
    render(
        <ChakraProvider>
            <MessageFeed roomID="room-a" playerName={playerName} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('MessageFeed', () => {
    it('shows a broadcast to any player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: 'Game starts soon!',
                        standings: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('Game starts soon!')).toBeInTheDocument();
    });

    it('shows a whisper addressed to this player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'whisper',
                        recipient: 'Alice',
                        text: 'You are being hunted',
                        standings: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.getByText('You are being hunted')).toBeInTheDocument();
    });

    it('does not show a whisper addressed to a different player', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    { type: 'whisper', recipient: 'Bob', text: 'Secret for Bob', standings: null },
                ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.queryByText('Secret for Bob')).not.toBeInTheDocument();
    });

    it('matches the recipient case/whitespace-insensitively', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'whisper',
                        recipient: 'alice smith',
                        text: 'For Alice Smith',
                        standings: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed('Alice Smith');

        expect(screen.getByText('For Alice Smith')).toBeInTheDocument();
    });

    it('does not subscribe when playerName is empty', () => {
        onSnapshot.mockImplementation(() => () => {});

        mountFeed('');

        expect(fetchPlayerMessagesQueryForRoom).not.toHaveBeenCalled();
    });
});
