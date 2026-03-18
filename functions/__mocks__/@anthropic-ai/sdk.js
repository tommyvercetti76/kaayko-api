/**
 * Jest manual mock for @anthropic-ai/sdk
 *
 * Usage in tests:
 *   const Anthropic = require('@anthropic-ai/sdk');
 *   Anthropic._mockResponse = [{ type: 'text', text: '...' }];
 *   // or
 *   Anthropic._mockError = new Error('API error');
 *   // or per-call:
 *   Anthropic.messages.create.mockResolvedValueOnce({ content: [...] });
 */

const mockCreate = jest.fn();

// Default successful response — parseable JSON array
mockCreate.mockResolvedValue({
  content: [{ type: 'text', text: '[]' }],
});

class Anthropic {
  constructor() {
    this.messages = { create: mockCreate };
  }
}

// Expose the mock fn and a helper to set response text easily
Anthropic.messages = { create: mockCreate };

Anthropic._setResponse = function (text) {
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text }],
  });
};

Anthropic._setError = function (err) {
  mockCreate.mockRejectedValue(err instanceof Error ? err : new Error(err));
};

Anthropic._reset = function () {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: '[]' }],
  });
};

module.exports = Anthropic;
