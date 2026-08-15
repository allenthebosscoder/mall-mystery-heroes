/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * KillPhotoModal is presentational: MessageComposer.js owns capturing,
 * compressing, and submitting the photo, and hands this modal whatever it
 * needs to render (previewUrl/error/isSubmitting) plus an onSubmit
 * callback
 * (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
 * No compressImage/uploadKillPhoto/addPhotoForRoom mocking needed — this
 * component no longer imports any of them.
 */
import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KillPhotoModal from './KillPhotoModal';

const onClose = jest.fn();
const onSubmit = jest.fn();

const mountModal = (props = {}) =>
    render(
        <ChakraProvider>
            <KillPhotoModal
                isOpen
                onClose={onClose}
                targets={['bob']}
                previewUrl={null}
                error={null}
                isSubmitting={false}
                onSubmit={onSubmit}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
    it('auto-selects the only target and shows no picker when there is exactly one', () => {
        mountModal({ targets: ['bob'] });

        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('shows a picker when there is more than one target', () => {
        mountModal({ targets: ['bob', 'carol'] });

        expect(screen.getByRole('radio', { name: 'bob' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'carol' })).toBeInTheDocument();
    });

    it('shows the preview image when previewUrl is set', () => {
        mountModal({ previewUrl: 'blob:fake-preview' });

        expect(screen.getByAltText('Kill photo preview')).toHaveAttribute(
            'src',
            'blob:fake-preview'
        );
    });

    it('shows no preview image when previewUrl is not set', () => {
        mountModal({ previewUrl: null });

        expect(screen.queryByAltText('Kill photo preview')).not.toBeInTheDocument();
    });

    it('shows the error alert when error is set', () => {
        mountModal({ error: 'Could not submit the photo. Check your connection and try again.' });

        expect(
            screen.getByText('Could not submit the photo. Check your connection and try again.')
        ).toBeInTheDocument();
    });

    it('disables Submit when there is no preview yet', () => {
        mountModal({ previewUrl: null });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    });

    it('disables Submit while isSubmitting', () => {
        mountModal({ previewUrl: 'blob:fake-preview', isSubmitting: true });

        expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled();
    });

    it('enables Submit once there is a preview and a target', () => {
        mountModal({ previewUrl: 'blob:fake-preview', targets: ['bob'] });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('calls onSubmit with the effective target when Submit is clicked', async () => {
        mountModal({ previewUrl: 'blob:fake-preview', targets: ['bob', 'carol'] });

        await userEvent.click(screen.getByRole('radio', { name: 'carol' }));
        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith('carol');
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });
});
