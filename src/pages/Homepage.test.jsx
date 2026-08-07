/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Host Game / Join Game buttons and the localStorage
 * redirect-on-mount for a returning player
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * The redirect only fires when a stored session is backed by an actual
 * signed-in Firebase user (final-review fix: without that check, Homepage
 * and RequireAuth can form an infinite redirect loop when the localStorage
 * session outlives Firebase Auth's own state) — so '../utils/firebase' is
 * mocked here the way RequireAuth.test.jsx and ChatInput.test.jsx do, even
 * though this file previously needed no Firebase mocks at all.
 * playerSession.js itself is left unmocked: it touches only real
 * (jsdom-provided) localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Homepage from './Homepage';
import { writePlayerSession } from '../utils/playerSession';
import { auth } from '../utils/firebase';

jest.mock('../utils/firebase', () => ({ auth: { currentUser: null } }));

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
    auth.currentUser = null;
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

    it('redirects straight to the waiting screen when a player session is stored and Firebase Auth has a signed-in user', () => {
        auth.currentUser = { uid: 'test-uid' };
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByText('Waiting page')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Host Game' })).not.toBeInTheDocument();
    });

    it('shows the Host/Join buttons (no redirect loop) when a session is stored but Firebase Auth has no signed-in user', () => {
        auth.currentUser = null;
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });
});
