/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * Covers the /host screen: today's old Homepage.js content, relocated one
 * level in behind the new "Host Game" button
 * (docs/superpowers/specs/2026-08-07-join-flow-ui-and-room-scoping-design.md).
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Host from './Host';

const renderHost = () =>
    render(
        <ChakraProvider>
            <MemoryRouter initialEntries={['/host']}>
                <Routes>
                    <Route path="/host" element={<Host />} />
                    <Route path="/login" element={<div>Login page</div>} />
                    <Route path="/signup" element={<div>Signup page</div>} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
    );

describe('Host', () => {
    it('navigates to /login when Log In is clicked', async () => {
        renderHost();

        await userEvent.click(screen.getByRole('button', { name: 'Log In' }));

        expect(screen.getByText('Login page')).toBeInTheDocument();
    });

    it('navigates to /signup when Sign Up is clicked', async () => {
        renderHost();

        await userEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

        expect(screen.getByText('Signup page')).toBeInTheDocument();
    });
});
