/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Host Game / Join Game buttons and the localStorage
 * redirect-on-mount for a returning player
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * No mocks needed: playerSession.js touches only real (jsdom-provided)
 * localStorage, not Firebase.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Homepage from './Homepage';
import { writePlayerSession } from '../utils/playerSession';

const renderHomepage = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Homepage />} />
                    <Route path="/host" element={<div>Host page</div>} />
                    <Route path="/join" element={<div>Join page</div>} />
                    <Route path="/rooms/:roomID/waiting" element={<div>Waiting page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

beforeEach(() => {
    localStorage.clear();
});

describe('Homepage', () => {
    it('shows Host Game and Join Game buttons when no session is stored', () => {
        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
    });

    it('navigates to /host when Host Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Host Game' }));

        expect(screen.getByText('Host page')).toBeInTheDocument();
    });

    it('navigates to /join when Join Game is clicked', async () => {
        renderHomepage();

        await userEvent.click(screen.getByRole('button', { name: 'Join Game' }));

        expect(screen.getByText('Join page')).toBeInTheDocument();
    });

    it('redirects straight to the waiting screen when a player session is already stored', () => {
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByText('Waiting page')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Host Game' })).not.toBeInTheDocument();
    });
});
