/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * MessageBubble renders one playerMessages document — extracted from
 * MessageFeed.js and wrapped in React.memo so unchanged messages skip
 * re-rendering when new ones arrive
 * (docs/superpowers/specs/2026-08-12-message-feed-render-perf-design.md).
 * No onSnapshot mocking needed — this component doesn't subscribe to
 * anything, it just renders whatever message/playerName props it's given.
 */
import React from 'react';
import { ChakraProvider, List } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import { formatMessageTime } from '../../utils/formatMessageTime';

const mountBubble = (message, playerName = 'Alice') =>
    render(
        <ChakraProvider>
            <List>
                <MessageBubble message={message} playerName={playerName} />
            </List>
        </ChakraProvider>
    );

describe('MessageBubble', () => {
    it('renders a leaderboard message as a standings list, not a text line', () => {
        mountBubble({
            type: 'leaderboard',
            recipient: null,
            text: null,
            standings: [
                { name: 'Alice', score: 30, isAlive: true },
                { name: 'Bob', score: 10, isAlive: false },
            ],
        });

        expect(screen.getByText('Alice: 30')).toBeInTheDocument();
        expect(screen.getByText('Bob: 10 (eliminated)')).toBeInTheDocument();
    });

    it('renders a mission message as a "New Mission!" card with unlimited participants', () => {
        mountBubble({
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
        });

        expect(screen.getByText('New Mission!')).toBeInTheDocument();
        expect(screen.getByText('Find the clue')).toBeInTheDocument();
        expect(screen.getByText('Look under the food court table')).toBeInTheDocument();
        expect(screen.getByText('Task · 10 points · Unlimited players')).toBeInTheDocument();
    });

    it('renders a mission message with a participant limit', () => {
        mountBubble({
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
        });

        expect(
            screen.getByText('Revival Mission · 0 points · Limited to 3 players')
        ).toBeInTheDocument();
    });

    it('shows a chat message with its sender', () => {
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'lol where are you',
            standings: null,
            mission: null,
            sender: 'Bob',
        });

        expect(screen.getByText('Bob:')).toBeInTheDocument();
        expect(screen.getByText('lol where are you')).toBeInTheDocument();
    });

    it("right-aligns the current player's own chat message and omits the sender prefix", () => {
        mountBubble(
            {
                type: 'chat',
                recipient: null,
                text: 'be right there',
                standings: null,
                mission: null,
                sender: 'Alice',
                timestamp: null,
            },
            'Alice'
        );

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-end' });
        expect(screen.queryByText('Alice:')).not.toBeInTheDocument();
        expect(screen.getByText('be right there')).toBeInTheDocument();
    });

    it('left-aligns a chat message from someone else', () => {
        mountBubble(
            {
                type: 'chat',
                recipient: null,
                text: 'lol where are you',
                standings: null,
                mission: null,
                sender: 'Bob',
                timestamp: null,
            },
            'Alice'
        );

        expect(screen.getByTestId('chat-message')).toHaveStyle({ justifyContent: 'flex-start' });
    });

    it('shows a formatted time on a chat message with a resolved timestamp', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 15, 45) };
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'hi',
            standings: null,
            mission: null,
            sender: 'Bob',
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows no time text for a chat message with a pending (null) timestamp', () => {
        mountBubble({
            type: 'chat',
            recipient: null,
            text: 'sending this now',
            standings: null,
            mission: null,
            sender: 'Bob',
            timestamp: null,
        });

        expect(screen.getByText('sending this now')).toBeInTheDocument();
        expect(screen.queryByText(/^\d{1,2}:\d{2}/)).not.toBeInTheDocument();
    });

    it('shows a formatted time on a leaderboard message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
            type: 'leaderboard',
            recipient: null,
            text: null,
            standings: [{ name: 'Alice', score: 30, isAlive: true }],
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a mission message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
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
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });

    it('shows a formatted time on a broadcast message', () => {
        const timestamp = { toDate: () => new Date(2024, 0, 1, 9, 5) };
        mountBubble({
            type: 'broadcast',
            recipient: null,
            text: 'Game starts soon!',
            standings: null,
            timestamp,
        });

        expect(screen.getByText(formatMessageTime(timestamp))).toBeInTheDocument();
    });
});
