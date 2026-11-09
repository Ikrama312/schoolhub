import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BODY_MAX, COUNTER_FROM } from '@/lib/messaging/constants';
import {
  createConversationSchema,
  listMessagesQuery,
  messagingSettingsSchema,
  reportSchema,
  sendMessageSchema,
} from '@/lib/validators/messaging';

/** SH-13 QA: FR-11 composer behaviour, FR-7 blocked state, and the messaging validators (FR-11/12/21/22). */

vi.mock('@/components/FileUpload/FileUpload', () => ({ FileUpload: () => null }));

import { CANNOT_SEND, Composer } from '@/components/messaging/Composer';

const box = () => screen.getByRole('textbox', { name: 'Message' });
// The real api() client runs; only the network is faked.
const api = vi.fn();
const respond = (status: number, json: unknown) => api.mockImplementation(async () => ({ ok: status < 400, status, json: async () => json }));

describe('Composer (FR-11, FR-7)', () => {
  beforeEach(() => {
    api.mockReset();
    vi.stubGlobal('fetch', api);
  });

  it('Enter sends, Shift+Enter does not', async () => {
    respond(201, { data: { message: { id: 'm1' } } });
    const onSent = vi.fn();
    render(<Composer conversationId="c1" canSend onSent={onSent} />);
    fireEvent.change(box(), { target: { value: 'hello' } });
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(api).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(onSent).toHaveBeenCalledWith({ id: 'm1' }));
    expect(api).toHaveBeenCalledWith('/api/conversations/c1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'hello', fileIds: [] }) }));
    expect(box()).toHaveValue('');
  });

  it('does not send a blank message', () => {
    render(<Composer conversationId="c1" canSend onSent={() => {}} />);
    fireEvent.change(box(), { target: { value: '   ' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(api).not.toHaveBeenCalled();
  });

  it(`shows the counter only after ${COUNTER_FROM} characters`, () => {
    render(<Composer conversationId="c1" canSend onSent={() => {}} />);
    fireEvent.change(box(), { target: { value: 'a'.repeat(COUNTER_FROM) } });
    expect(screen.queryByText(`${COUNTER_FROM} / ${BODY_MAX}`)).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: 'a'.repeat(COUNTER_FROM + 1) } });
    expect(screen.getByText(`${COUNTER_FROM + 1} / ${BODY_MAX}`)).toBeInTheDocument();
  });

  it('shows the FR-7 message when canSend is false, and after a RELATIONSHIP_ENDED refusal', async () => {
    const { unmount } = render(<Composer conversationId="c1" canSend={false} onSent={() => {}} />);
    expect(screen.getByText(CANNOT_SEND)).toBeInTheDocument();
    expect(CANNOT_SEND).toBe('You can no longer send messages in this conversation.');
    unmount();

    respond(403, { error: { code: 'FORBIDDEN', message: CANNOT_SEND, details: { reason: 'RELATIONSHIP_ENDED' } } });
    render(<Composer conversationId="c1" canSend onSent={() => {}} />);
    fireEvent.change(box(), { target: { value: 'hi' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(await screen.findByText(CANNOT_SEND)).toBeInTheDocument();
  });
});

describe('messaging validators', () => {
  it('body is 1–5,000 chars after trim; at most 5 files', () => {
    expect(sendMessageSchema.safeParse({ body: ' ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: 'a'.repeat(BODY_MAX) }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: 'a'.repeat(BODY_MAX + 1) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ body: 'x', fileIds: ['1', '2', '3', '4', '5'] }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ body: 'x', fileIds: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
  });

  it('subject max 120 and optional; recipients deduplicated', () => {
    expect(createConversationSchema.safeParse({ participantIds: ['a'], body: 'x', subject: 's'.repeat(121) }).success).toBe(false);
    const ok = createConversationSchema.parse({ participantIds: ['a', 'a'], body: 'x', subject: '  ' });
    expect(ok.participantIds).toEqual(['a']);
    expect(ok.subject).toBeUndefined();
  });

  it('report reason 1–1,000 chars', () => {
    expect(reportSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: 'r'.repeat(1000) }).success).toBe(true);
    expect(reportSchema.safeParse({ reason: 'r'.repeat(1001) }).success).toBe(false);
  });

  it('quiet hours: HH:mm, both-or-neither, may wrap midnight, start ≠ end', () => {
    expect(messagingSettingsSchema.safeParse({ quietStart: '22:00', quietEnd: '07:00' }).success).toBe(true);
    expect(messagingSettingsSchema.safeParse({ quietStart: null, quietEnd: null }).success).toBe(true);
    expect(messagingSettingsSchema.safeParse({ quietStart: '22:00', quietEnd: null }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ quietStart: '24:00', quietEnd: '07:00' }).success).toBe(false);
    expect(messagingSettingsSchema.safeParse({ quietStart: '07:00', quietEnd: '07:00' }).success).toBe(false);
  });

  it('message list: page size 30 by default; before/after exclusive; since needs after', () => {
    expect(listMessagesQuery.parse({}).limit).toBe(30);
    expect(listMessagesQuery.safeParse({ limit: '31' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ before: 'a', after: 'b' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ since: new Date().toISOString() }).success).toBe(false);
  });
});
