/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * GameOverScreen is presentational: PlayerGame.js computes standings (via
 * buildLeaderboardStandings) and passes them down once the room's
 * isGameActive flips false
 * (docs/superpowers/specs/2026-08-17-player-game-over-screen-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameOverScreen from './GameOverScreen';

const standings = [
    { name: 'alice', score: 30, isAlive: true },
    { name: 'bob', score: 20, isAlive: false },
    { name: 'carol', score: 10, isAlive: true },
    { name: 'dave', score: 5, isAlive: false },
];

const mountScreen = (props = {}) =>
    render(
        <ChakraProvider>
            <GameOverScreen standings={standings} {...props} />
        </ChakraProvider>
    );

describe('GameOverScreen', () => {
    it('shows the game-over heading and the return-to-starting-area instruction', () => {
        mountScreen();

        expect(screen.getByText('Game Over')).toBeInTheDocument();
        expect(screen.getByText('Please head back to the starting area.')).toBeInTheDocument();
    });

    it('shows only the top 3 standings, marking eliminated players', () => {
        mountScreen();

        expect(screen.getByText('1. alice — 30')).toBeInTheDocument();
        expect(screen.getByText('2. bob — 20 (eliminated)')).toBeInTheDocument();
        expect(screen.getByText('3. carol — 10')).toBeInTheDocument();
        expect(screen.queryByText(/dave/)).not.toBeInTheDocument();
    });

    it('does not show the leaderboard modal until View Leaderboard is clicked', () => {
        mountScreen();

        expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();
    });

    it('opens the leaderboard modal, showing every player, when View Leaderboard is clicked', async () => {
        mountScreen();

        await userEvent.click(screen.getByRole('button', { name: 'View Leaderboard' }));

        expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        expect(screen.getByText(/dave/)).toBeInTheDocument();
    });
});
