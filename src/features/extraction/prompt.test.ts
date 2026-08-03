/**
 * The parse boundary between the model and the database.
 *
 * Two behaviours matter more than the rest and both are asserted directly:
 *
 *   1. A fenced response still parses. We deliberately do NOT use OpenRouter's
 *      JSON mode (support varies by model and provider route), so a stray
 *      ```json fence is expected occasionally rather than exceptional.
 *   2. Garbage THROWS. It must never come back as `{items: []}` — an empty
 *      array is a real answer ("this meeting had no action items"), and
 *      conflating the two would make a broken extractor look like a quiet
 *      meeting while the job is marked done.
 *
 * No database, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  ExtractionParseError,
  parseExtractionResponse,
  stripFences
} from './prompt';

const ITEM = {
  description: 'Send the revised deck to the client',
  owner_name: 'Speaker A',
  due_date: '2026-08-07',
  follow_ups: [],
  confidence: 0.9,
  source_span: "I'll send the revised deck over to them by Friday."
};

const BODY = JSON.stringify({ items: [ITEM] });

describe('stripFences', () => {
  it('leaves bare JSON untouched', () => {
    expect(stripFences(BODY)).toBe(BODY);
  });

  it('strips a ```json fence', () => {
    expect(JSON.parse(stripFences('```json\n' + BODY + '\n```'))).toEqual({ items: [ITEM] });
  });

  it('strips an unlabelled ``` fence', () => {
    expect(JSON.parse(stripFences('```\n' + BODY + '\n```'))).toEqual({ items: [ITEM] });
  });

  it('strips prose on either side of the object', () => {
    const raw = `Here is the JSON you asked for:\n\n${BODY}\n\nLet me know if you need anything else.`;
    expect(JSON.parse(stripFences(raw))).toEqual({ items: [ITEM] });
  });

  it('handles a fence AND prose together', () => {
    const raw = `Sure!\n\`\`\`json\n${BODY}\n\`\`\`\nHope that helps.`;
    expect(JSON.parse(stripFences(raw))).toEqual({ items: [ITEM] });
  });
});

describe('parseExtractionResponse', () => {
  it('accepts a valid response', () => {
    expect(parseExtractionResponse(BODY).items).toHaveLength(1);
  });

  it('⚠️ an EMPTY array is valid — zero action items is a correct answer', () => {
    // The whole point of the "do not invent items" rule. If this ever became an
    // error the prompt's central instruction would be unfollowable.
    expect(parseExtractionResponse('{"items":[]}').items).toEqual([]);
  });

  it('⚠️ THROWS on garbage rather than returning zero items', () => {
    // The distinction this file exists to protect. A silent `{items: []}` here
    // would mark the job completed and lose the meeting.
    expect(() => parseExtractionResponse('I could not find any action items.')).toThrow(
      ExtractionParseError
    );
  });

  it('throws on an empty response', () => {
    expect(() => parseExtractionResponse('   ')).toThrow(ExtractionParseError);
  });

  it('throws on JSON that is the wrong shape', () => {
    expect(() => parseExtractionResponse('{"action_items":[]}')).toThrow(ExtractionParseError);
  });

  it('throws when an item is missing source_span', () => {
    // source_span is how a reviewer verifies the item against the recording, so
    // it is required, not optional.
    const { source_span: _dropped, ...rest } = ITEM;
    expect(() => parseExtractionResponse(JSON.stringify({ items: [rest] }))).toThrow(
      ExtractionParseError
    );
  });

  it('throws when confidence is out of range', () => {
    expect(() =>
      parseExtractionResponse(JSON.stringify({ items: [{ ...ITEM, confidence: 4 }] }))
    ).toThrow(ExtractionParseError);
  });

  it('carries the raw response on the error but keeps it OUT of the message', () => {
    // A transcript-sized response in a log line drowns everything around it.
    const raw = 'x'.repeat(5000);
    try {
      parseExtractionResponse(raw);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionParseError);
      expect((err as ExtractionParseError).raw).toBe(raw);
      expect((err as ExtractionParseError).message.length).toBeLessThan(300);
    }
  });
});

describe('the prompt itself', () => {
  it('tells the model to return bare JSON with no fences', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/no markdown fences/i);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/BARE JSON/);
  });

  it('states that an empty array is a correct answer', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/EMPTY ARRAY/);
  });

  it('anchors relative dates on the meeting date when one is known', () => {
    const p = buildExtractionPrompt({
      title: 'Weekly sync',
      meetingDate: '2026-08-03',
      speakers: ['Speaker A'],
      lines: [{ speaker: 'Speaker A', text: "I'll do it by Friday" }]
    });
    expect(p).toContain('2026-08-03');
    expect(p).toContain("Speaker A: I'll do it by Friday");
  });

  it('tells the model NOT to guess when the meeting date is unknown', () => {
    const p = buildExtractionPrompt({
      title: null,
      meetingDate: null,
      speakers: [],
      lines: [{ speaker: 'Speaker A', text: 'hello' }]
    });
    expect(p).toMatch(/UNKNOWN/);
    expect(p).toMatch(/do not guess/i);
  });
});
