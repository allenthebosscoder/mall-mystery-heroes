/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Read-only view of the players' group chat, for the GM console — a
 * separate panel from the GM's own game-event Logs (different collection,
 * different purpose)
 * (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md).
 *
 * Explicit mock factory for 'firebase/firestore', not auto-mock — see
 * ChatInput.test.jsx for why auto-mocking utils/firebase.js isn't safe.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen } from '@testing-library/react';
import { onSnapshot } from 'firebase/firestore';
import GMChatPanel from './GMChatPanel';
import { fetchPlayerMessagesQueryForRoom } from '../firebase_calls/dbCalls';

jest.mock('firebase/firestore', () => ({
    onSnapshot: jest.fn(),
}));
jest.mock('../firebase_calls/dbCalls', () => ({
    fetchPlayerMessagesQueryForRoom: jest.fn(() => 'messages-query'),
}));

const asMessageDocs = (messages) =>
    messages.map((message, index) => ({ id: `message-${index}`, data: () => message }));

const mountPanel = (roomID = 'room-a') =>
    render(
        <ChakraProvider>
            <GMChatPanel roomID={roomID} />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('GMChatPanel', () => {
    it('shows a chat message with its sender', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    { type: 'chat', recipient: null, text: 'lol where are you', sender: 'Bob' },
                ]),
            });
            return () => {};
        });

        mountPanel();

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it('filters out non-chat messages, e.g. a GM broadcast', () => {
        onSnapshot.mockImplementation((query, onNext) => {
            onNext({
                docs: asMessageDocs([
                    {
                        type: 'broadcast',
                        recipient: null,
                        text: 'Game starts soon!',
                        standings: null,
                    },
                    { type: 'chat', recipient: null, text: 'hyped', sender: 'Alice' },
                ]),
            });
            return () => {};
        });

        mountPanel();

        expect(screen.queryByText('Game starts soon!')).not.toBeInTheDocument();
        expect(screen.getByText('hyped')).toBeInTheDocument();
    });

    it('does not subscribe when roomID is empty', () => {
        onSnapshot.mockImplementation(() => () => {});

        mountPanel('');

        expect(fetchPlayerMessagesQueryForRoom).not.toHaveBeenCalled();
    });

    it('scrolls to the bottom whenever a new message arrives', async () => {
        let deliverMessages;
        onSnapshot.mockImplementation((query, onNext) => {
            deliverMessages = onNext;
            onNext({ docs: [] });
            return () => {};
        });

        mountPanel();

        const panel = await screen.findByTestId('gm-chat-panel');
        // jsdom never computes real layout, so scrollHeight is always 0 —
        // stub it to a value that would actually require scrolling, the
        // same way a real, overflowing panel would report it.
        Object.defineProperty(panel, 'scrollHeight', {
            value: 500,
            configurable: true,
        });
        panel.scrollTop = 0;

        await act(async () => {
            deliverMessages({
                docs: asMessageDocs([
                    { type: 'chat', recipient: null, text: 'new message', sender: 'Bob' },
                ]),
            });
        });

        expect(panel.scrollTop).toBe(500);
    });
});
