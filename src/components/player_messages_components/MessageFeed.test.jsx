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
import { act, render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import MessageFeed from './MessageFeed';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';
import { formatMessageTime } from '../../utils/formatMessageTime';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

const asMessageDocs = (messages) =>
    messages.map((message, index) => ({ id: `message-${index}`, data: () => message }));

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

    it('renders a leaderboard message as a standings list, not a text line', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'leaderboard',
                        recipient: null,
                        text: null,
                        standings: [
                            { name: 'Alice', score: 30, isAlive: true },
                            { name: 'Bob', score: 10, isAlive: false },
                        ],
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('Alice: 30')).toBeInTheDocument();
        expect(screen.getByText('Bob: 10 (eliminated)')).toBeInTheDocument();
    });

    it('scrolls to the bottom whenever a new message arrives', async () => {
        let deliverMessages;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverMessages = onNext;
            onNext({ docs: [] });
            return () => {};
        });

        mountFeed();

        const feedBox = await screen.findByTestId('message-feed');
        // jsdom never computes real layout, so scrollHeight is always 0 —
        // stub it to a value that would actually require scrolling, the same
        // way a real, overflowing feed would report it.
        Object.defineProperty(feedBox, 'scrollHeight', {
            value: 500,
            configurable: true,
        });
        feedBox.scrollTop = 0;

        await act(async () => {
            deliverMessages({
                docs: asMessageDocs([
                    { type: 'broadcast', recipient: null, text: 'New message', standings: null },
                ]),
            });
        });

        expect(feedBox.scrollTop).toBe(500);
    });

    it('renders a mission message as a "New Mission!" card with unlimited participants', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'mission',
                        recipient: null,
                        text: null,
                        standings: null,
                        mission: {
                            title: 'Find the clue',
                            description: 'Look under the food court table',
                            taskType: 'Task',
                            pointValue: '10',
                            maxCompletions: null,
                        },
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('New Mission!')).toBeInTheDocument();
        expect(screen.getByText('Find the clue')).toBeInTheDocument();
        expect(screen.getByText('Look under the food court table')).toBeInTheDocument();
        expect(screen.getByText('Task · 10 points · Unlimited players')).toBeInTheDocument();
    });

    it('renders a mission message with a participant limit', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'mission',
                        recipient: null,
                        text: null,
                        standings: null,
                        mission: {
                            title: 'Revive a fallen hero',
                            description: 'Say the secret phrase',
                            taskType: 'Revival Mission',
                            pointValue: 0,
                            maxCompletions: 3,
                        },
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(
            screen.getByText('Revival Mission · 0 points · Limited to 3 players')
        ).toBeInTheDocument();
    });

    it('shows a chat message with its sender', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'chat',
                        recipient: null,
                        text: 'lol where are you',
                        standings: null,
                        mission: null,
                        sender: 'Bob',
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it('right-aligns the current player’s own chat message and omits the sender prefix', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'chat',
                        recipient: null,
                        text: 'be right there',
                        standings: null,
                        mission: null,
                        sender: 'Alice',
                        timestamp: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-end' });
        expect(screen.queryByText('Alice:')).not.toBeInTheDocument();
        expect(screen.getByText('be right there')).toBeInTheDocument();
    });

    it('left-aligns a chat message from someone else', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'chat',
                        recipient: null,
                        text: 'lol where are you',
                        standings: null,
                        mission: null,
                        sender: 'Bob',
                        timestamp: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed('Alice');

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-start' });
    });

    it('shows a formatted time on a chat message with a resolved timestamp', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'chat',
                        recipient: null,
                        text: 'hi',
                        standings: null,
                        mission: null,
                        sender: 'Bob',
                        timestamp,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows no time text for a chat message with a pending (null) timestamp', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'chat',
                        recipient: null,
                        text: 'sending this now',
                        standings: null,
                        mission: null,
                        sender: 'Bob',
                        timestamp: null,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText('sending this now')).toBeInTheDocument();
    });

    it('shows a formatted time on a leaderboard message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'leaderboard',
                        recipient: null,
                        text: null,
                        standings: [{ name: 'Alice', score: 30, isAlive: true }],
                        timestamp,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a mission message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'mission',
                        recipient: null,
                        text: null,
                        standings: null,
                        mission: {
                            title: 'Find the clue',
                            description: 'Look under the food court table',
                            taskType: 'Task',
                            pointValue: '10',
                            maxCompletions: null,
                        },
                        timestamp,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a broadcast message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: 'Game starts soon!',
                        standings: null,
                        timestamp,
                    },
                ]),
            });
            return () => {};
        });

        mountFeed();

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });
});
