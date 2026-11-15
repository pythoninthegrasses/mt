import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  decodeEngineMessage,
  decodeEngineResponse,
  encodeEngineMessage,
  MAX_MESSAGE_BYTES,
} from '../js/api/engine-protocol.js';

const cases = readFileSync(
  new URL('../../../tests/fixtures/engine-protocol/messages.jsonl', import.meta.url),
  'utf8',
).trim().split('\n').map((line) => JSON.parse(line));
const operations = [
  'library.getTracks',
  'native.metadata.read',
  'engine.changed',
  'native.audio.ended',
  'control.cancel',
];
const schema = JSON.parse(readFileSync(
  new URL('../../../protocol/engine-envelope.schema.json', import.meta.url),
  'utf8',
));
const ajv = new Ajv2020({ strictRequired: false });
ajv.addSchema(schema);
const validateSchema = ajv.compile({
  type: 'object',
  allOf: [
    { $ref: 'urn:mt:engine-envelope:1' },
    { properties: { operation: { enum: operations } } },
  ],
});

describe('shared protocol v1 wire fixtures', () => {
  it('loads a nonempty shared corpus', () => expect(cases.length).toBeGreaterThanOrEqual(40));
  for (const fixture of cases) {
    it(fixture.name, () => {
      const decode = () => decodeEngineMessage(fixture.wire, operations);
      let schemaValid = false;
      try {
        schemaValid = validateSchema(JSON.parse(fixture.wire));
      } catch {
        // Malformed JSON is invalid before schema validation.
      }
      expect(schemaValid, JSON.stringify(validateSchema.errors)).toBe(fixture.valid);
      if (!fixture.valid) {
        expect(decode).toThrow();
        if (fixture.code) {
          try {
            decode();
          } catch (error) {
            expect(error.code).toBe(fixture.code);
          }
        }
        return;
      }
      const message = decode();
      expect(decodeEngineMessage(encodeEngineMessage(message, operations), operations)).toEqual(
        message,
      );
    });
  }
  it('rejects excessive byte length and depth', () => {
    expect(() => decodeEngineMessage(' '.repeat(MAX_MESSAGE_BYTES + 1), operations)).toThrow();
    const message = JSON.parse(cases[0].wire);
    let payload = {};
    for (let i = 0; i < 33; i++) payload = { child: payload };
    message.payload = payload;
    expect(() => encodeEngineMessage(message, operations)).toThrow();
  });
  it('rejects unknown operations with a direction-specific allowlist', () => {
    expect(() => decodeEngineMessage(cases[0].wire, [])).toThrow();
  });
  it('checks correlation, generation and HTTP status', () => {
    const request = decodeEngineMessage(cases[0].wire, operations);
    expect(decodeEngineResponse(cases[2].wire, request, 200, operations).result.tracks).toEqual([]);
    expect(() => decodeEngineResponse(cases[2].wire, request, 503, operations)).toThrow();
    for (const key of ['generation', 'id', 'operation']) {
      expect(() =>
        decodeEngineResponse(cases[2].wire, { ...request, [key]: 'other' }, 200, operations)
      ).toThrow();
    }
    const error = {
      version: 1,
      kind: 'response',
      generation: request.generation,
      id: request.id,
      operation: request.operation,
      error: { code: 'unavailable', message: 'Unavailable', retryable: true },
    };
    const text = encodeEngineMessage(error, operations);
    expect(decodeEngineResponse(text, request, 503, operations).error.code).toBe('unavailable');
    expect(() => decodeEngineResponse(text, request, 200, operations)).toThrow();
  });
  it('rejects JS-only values before JSON serialization can lose their meaning', () => {
    for (const value of [undefined, NaN, Infinity, 1n, () => {}, new Date(), [,]]) {
      const message = JSON.parse(cases[2].wire);
      message.result = { value };
      expect(() => encodeEngineMessage(message, operations)).toThrow();
    }
    const message = JSON.parse(cases[2].wire);
    message.result = message;
    expect(() => encodeEngineMessage(message, operations)).toThrow();
  });
  it('does not expose malformed input in codec diagnostics', () => {
    try {
      decodeEngineMessage('{"credential":"never-echo-this", bad}', operations);
      expect.fail('malformed input must fail');
    } catch (error) {
      expect(error.message).toBe('Invalid engine protocol message');
      expect(error.message).not.toContain('never-echo-this');
    }
  });
});
