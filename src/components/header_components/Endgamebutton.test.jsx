/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers docs/improvements.md item 10: `endGame` now throws on failure
 * rather than swallowing, and this button used to fire-and-forget the call
 * then navigate away unconditionally — a failure was invisible and the GM
 * would land on /dashboard believing the game had ended when it hadn't.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Endgamebutton from './Endgamebutton';
import { gameContext } from '../Contexts';
import { endGame } from '../firebase_calls/dbCalls';

const mockNavigate = jest.fn();

jest.mock('../firebase_calls/dbCalls', () => ({ endGame: jest.fn() }));
jest.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

const mountEndgamebutton = () =>
    render(
        <ChakraProvider>
            <gameContext.Provider value={{ roomID: 'room-a' }}>
                <Endgamebutton />
            </gameContext.Provider>
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

const confirmEndGame = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'End Game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm End Game' }));
};

describe('Endgamebutton (improvements item 10)', () => {
    it('navigates to /dashboard once endGame resolves', async () => {
        endGame.mockResolvedValue(undefined);
        mountEndgamebutton();

        await confirmEndGame();

        expect(endGame).toHaveBeenCalledWith('room-a');
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('shows an alert and does not navigate when endGame rejects', async () => {
        endGame.mockRejectedValue(new Error('network down'));
        mountEndgamebutton();

        await confirmEndGame();

        expect(await screen.findByText(/network down/i)).toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
