/**
 * Layer 3 — component test, jsdom + Testing Library.
 *
 * KillPhotoModal is presentational: MessageComposer.js owns capturing,
 * compressing, and submitting the photo, and hands this modal whatever it
 * needs to render (previewUrl/error) plus an onSubmit callback
 * (docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
 * No compressImage/uploadKillPhoto/submitKillPhoto mocking needed — this
 * component no longer imports any of them. There is no isSubmitting prop
 * (or any other in-flight state) anymore — MessageComposer.js now closes
 * this modal immediately on Submit rather than waiting on the upload/save,
 * so there is no "submitting" state left for this modal to represent.
 *
 * No target picker either — a player no longer names who they killed;
 * the moderator resolves that later in PhotosDisplay.js. This modal is
 * just: preview the photo, show an error if capture failed, Submit.
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
                previewUrl={null}
                error={null}
                onSubmit={onSubmit}
                {...props}
            />
        </ChakraProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
});

describe('KillPhotoModal', () => {
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

    it('enables Submit once there is a preview', () => {
        mountModal({ previewUrl: 'blob:fake-preview' });

        expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });

    it('calls onSubmit with no arguments when Submit is clicked', async () => {
        mountModal({ previewUrl: 'blob:fake-preview' });

        await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith();
    });

    it('calls onClose when Close is clicked', async () => {
        mountModal();

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onClose).toHaveBeenCalled();
    });
});
