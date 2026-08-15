import React, { useRef, useState } from 'react';
import { Flex, Input, Button, VisuallyHidden } from '@chakra-ui/react';
import { addChatMessageForRoom, addPhotoForRoom } from '../firebase_calls/dbCalls';
import { compressImage } from '../../utils/compressImage';
import { uploadKillPhoto } from '../firebase_calls/storageCalls';
import KillPhotoModal from './KillPhotoModal';

// Sends player-authored group-chat messages and captures/submits a
// kill-photo claim. The camera button triggers a hidden file input
// directly (always mounted, so it can fire before KillPhotoModal has ever
// opened) — tapping it opens the camera immediately, and KillPhotoModal
// only appears once a photo has been captured, or capture failed, to
// review/pick a target/submit
// (docs/superpowers/specs/2026-08-12-chat-send-and-efficiency-design.md,
// docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md,
// docs/superpowers/specs/2026-08-15-one-tap-kill-photo-capture-design.md).
const MessageComposer = ({ roomID, playerName, targets = [] }) => {
    const [text, setText] = useState('');
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [compressedBlob, setCompressedBlob] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [photoError, setPhotoError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef(null);

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setText('');
        try {
            await addChatMessageForRoom(trimmed, playerName, roomID);
        } catch (error) {
            // Losing a single sent message isn't session-invalidating,
            // matching MessageFeed's own subscription-error handling — log
            // only, no toast/alert plumbing in this simple composer. The
            // typed text is restored (not left cleared) so a failed send
            // doesn't lose the player's words with no way to retry.
            console.error('Error sending chat message:', error);
            setText(trimmed);
        }
    };

    const handleKeyDown = (event) => {
        // Guards Shift+Enter (would insert a newline, if this ever becomes
        // multiline) and IME composition (an Enter keystroke that's
        // confirming a composed character, not submitting the message).
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            handleSend();
        }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        // Reset immediately, not just on success: this input is always
        // mounted now (unlike the old design, where it lived inside the
        // modal and remounted fresh every time the modal opened), so a
        // real browser will not fire another change event for the exact
        // same file next time unless the value is cleared first.
        event.target.value = '';
        if (!file) return;
        setPhotoError(null);
        setCompressedBlob(null);
        setPreviewUrl(null);
        try {
            const blob = await compressImage(file);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(blob);
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (compressError) {
            console.error('Error compressing photo:', compressError);
            setPhotoError('Could not read that photo. Try taking it again.');
        } finally {
            setIsPhotoModalOpen(true);
        }
    };

    const handlePhotoSubmit = async (effectiveTarget) => {
        setIsSubmitting(true);
        setPhotoError(null);
        try {
            const url = await uploadKillPhoto(roomID, compressedBlob);
            await addPhotoForRoom(roomID, playerName, effectiveTarget, url);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setCompressedBlob(null);
            setPreviewUrl(null);
            setIsPhotoModalOpen(false);
        } catch (submitError) {
            console.error('Error submitting kill photo:', submitError);
            setPhotoError('Could not submit the photo. Check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // playerName can be empty when the stored session's room doesn't match
    // the URL (PlayerGame.js) — MessageFeed.js already guards its
    // subscription on the same condition; this keeps the composer from
    // attempting a chat write with sender: ''.
    const disabled = !playerName;

    return (
        <Flex p={2} borderTop="1px solid" borderColor="gray.600">
            <Input
                placeholder="Type a message..."
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                isDisabled={disabled}
                mr={2}
            />
            <VisuallyHidden>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    aria-label="Take Photo"
                />
            </VisuallyHidden>
            <Button
                isDisabled={disabled || targets.length === 0}
                onClick={() => fileInputRef.current.click()}
                mr={2}
                aria-label="Send photo"
            >
                📷
            </Button>
            <Button onClick={handleSend} colorScheme="teal" isDisabled={disabled}>
                Send
            </Button>
            <KillPhotoModal
                isOpen={isPhotoModalOpen}
                onClose={() => setIsPhotoModalOpen(false)}
                targets={targets}
                previewUrl={previewUrl}
                error={photoError}
                isSubmitting={isSubmitting}
                onSubmit={handlePhotoSubmit}
            />
        </Flex>
    );
};

export default MessageComposer;
