/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the Host Game / Join Game buttons and the localStorage
 * redirect-on-mount for a returning player
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 * The redirect only fires when a stored session is backed by an actual
 * signed-in Firebase user (final-review fix: without that check, Homepage
 * and RequireAuth can form an infinite redirect loop when the localStorage
 * session outlives Firebase Auth's own state). Firebase Auth restores that
 * user asynchronously, so Homepage subscribes via onAuthStateChanged
 * exactly like RequireAuth does — 'firebase/auth' and '../utils/firebase'
 * are mocked here the same way RequireAuth.test.jsx mocks them, controlling
 * what the onAuthStateChanged callback receives in each test.
 * playerSession.js itself is left unmocked: it touches only real
 * (jsdom-provided) localStorage.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import Homepage from './Homepage';
import { writePlayerSession } from '../utils/playerSession';

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: jest.fn(),
}));
jest.mock('../utils/firebase', () => ({ auth: {} }));

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
    onAuthStateChanged.mockReset();
    onAuthStateChanged.mockImplementation((auth, callback) => {
        callback(null);
        return () => {};
    });
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

    it('redirects straight to the waiting screen when a player session is stored and Firebase Auth reports a signed-in user', () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback({ uid: 'test-uid' });
            return () => {};
        });
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByText('Waiting page')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Host Game' })).not.toBeInTheDocument();
    });

    it('shows the Host/Join buttons (no redirect loop) when a session is stored but Firebase Auth reports no signed-in user', () => {
        onAuthStateChanged.mockImplementation((auth, callback) => {
            callback(null);
            return () => {};
        });
        writePlayerSession('Fluffy42317', 'Alice');

        renderHomepage();

        expect(screen.getByRole('button', { name: 'Host Game' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join Game' })).toBeInTheDocument();
        expect(screen.queryByText('Waiting page')).not.toBeInTheDocument();
    });
});
