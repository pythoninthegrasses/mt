/**
 * Protocol v1 boundary codec. Not wired to the legacy getTracks endpoint.
 * Operation payload validation and authorization are mandatory dispatch steps.
 */
export const MAX_MESSAGE_BYTES = 1024 * 1024;
const U64_MAX = '18446744073709551615';
const I64_MAX = '9223372036854775807';
const decimalFields = new Set([
  'revision',
  'sequence',
  'count',
  'timestamp_ms',
  'position_ms',
  'size_bytes',
]);
export const ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  unsupported_version: 400,
  unknown_operation: 404,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  busy: 409,
  too_large: 413,
  cancelled: 409,
  deadline_exceeded: 504,
  outcome_uncertain: 504,
  unavailable: 503,
  internal: 500,
});

export class EngineProtocolError extends Error {
  constructor(code = 'invalid_request') {
    super('Invalid engine protocol message');
    this.name = 'EngineProtocolError';
    this.code = code;
  }
}

function require(condition, code) {
  if (!condition) throw new EngineProtocolError(code);
}

function object(value) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function decimal(value, max = U64_MAX) {
  require(typeof value === 'string' && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value));
  require(value.length < max.length || (value.length === max.length && value <= max));
}

function identity(value) {
  require(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}(?![\s\S])/.test(value));
}

function fields(value, required, optional = []) {
  object(value);
  require(required.every((key) => Object.hasOwn(value, key)));
  require(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)));
}

function data(value, depth = 0, key = '') {
  require(depth <= 32);
  require(value === null || ['string', 'boolean', 'number', 'object'].includes(typeof value));
  if (decimalFields.has(key)) decimal(value);
  if (key === 'track_id') {
    decimal(value, I64_MAX);
    require(value !== '0');
  }
  if (key === 'path') require(typeof value === 'string' && !value.includes('\0'));
  if (typeof value === 'number') {
    require(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
  }
  if (typeof value === 'string') {
    // JSON permits escaped lone surrogates; the wire requires Unicode scalar text.
    for (const character of value) {
      const code = character.codePointAt(0);
      require(code < 0xD800 || code > 0xDFFF);
    }
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      require(Object.keys(value).length === value.length);
    } else {
      require(
        Object.getPrototypeOf(value) === Object.prototype ||
          Object.getPrototypeOf(value) === null,
      );
    }
    for (const [childKey, child] of Object.entries(value)) {
      data(childKey, depth + 1);
      data(child, depth + 1, Array.isArray(value) ? '' : childKey);
    }
  }
}

/** Decode an HTTP body / Tauri event; allowlist must be direction-specific. */
export function decodeEngineMessage(text, allowedOperations) {
  require(typeof text === 'string');
  require(text.length <= MAX_MESSAGE_BYTES, 'too_large');
  require(new TextEncoder().encode(text).length <= MAX_MESSAGE_BYTES, 'too_large');
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    // Native JSON syntax errors can include a snippet containing a credential.
    require(false);
  }
  object(message);
  require(Number.isInteger(message.version));
  require(message.version === 1, 'unsupported_version');
  identity(message.generation);
  identity(message.operation);
  require(allowedOperations.includes(message.operation), 'unknown_operation');
  const common = ['version', 'kind', 'generation', 'operation'];
  switch (message.kind) {
    case 'request':
      fields(message, [...common, 'id', 'payload', 'deadline_ms']);
      identity(message.id);
      require(
        Number.isInteger(message.deadline_ms) && message.deadline_ms >= 1 &&
          message.deadline_ms <= 300000,
      );
      object(message.payload);
      break;
    case 'response':
      fields(message, [...common, 'id'], ['result', 'error']);
      identity(message.id);
      require(Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'));
      if (Object.hasOwn(message, 'error')) {
        const error = message.error;
        fields(error, ['code', 'message', 'retryable'], ['details']);
        require(Object.hasOwn(ERROR_STATUS, error.code));
        require(
          typeof error.message === 'string' &&
            new TextEncoder().encode(error.message).length <= 1024,
        );
        require(typeof error.retryable === 'boolean');
        if (error.code === 'outcome_uncertain') require(error.retryable === false);
        if (Object.hasOwn(error, 'details')) object(error.details);
      }
      break;
    case 'event':
      fields(message, [...common, 'sequence', 'revision', 'payload']);
      decimal(message.sequence);
      require(message.sequence !== '0');
      decimal(message.revision);
      object(message.payload);
      break;
    case 'observation':
      fields(message, [...common, 'sequence', 'payload']);
      decimal(message.sequence);
      require(message.sequence !== '0');
      object(message.payload);
      break;
    default:
      require(false);
  }
  if (message.operation === 'control.cancel') {
    if (message.kind === 'request') {
      fields(message.payload, ['target_id']);
      identity(message.payload.target_id);
    } else {
      require(message.kind === 'response');
      if (Object.hasOwn(message, 'result')) {
        fields(message.result, ['state']);
        require(['accepted', 'already_finished', 'not_found'].includes(message.result.state));
      }
    }
  }
  data(message);
  return message;
}

/** Validate before emitting; no raw payload/error text is included in diagnostics. */
export function encodeEngineMessage(message, allowedOperations) {
  // Validate before JSON.stringify can silently turn NaN into null or omit
  // undefined fields. Also bounds cyclic/deep object graphs before serializing.
  data(message);
  const text = JSON.stringify(message);
  decodeEngineMessage(text, allowedOperations);
  return text;
}

/** Check correlation before exposing a response result to its caller. */
export function decodeEngineResponse(text, request, status, allowedOperations) {
  const message = decodeEngineMessage(text, allowedOperations);
  require(
    message.kind === 'response' && message.id === request.id &&
      message.operation === request.operation && message.generation === request.generation,
  );
  require(
    Object.hasOwn(message, 'error') ? ERROR_STATUS[message.error.code] === status : status === 200,
  );
  return message;
}
