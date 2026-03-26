import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();
const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/chat
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }] }
 */
router.post('/', async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: system || 'You are a helpful assistant.',
      messages,
    });

    const assistantMessage = response.content[0]?.text ?? '';

    res.json({
      message: assistantMessage,
      usage: response.usage,
      model: response.model,
      stop_reason: response.stop_reason,
    });
  } catch (err) {
    console.error('Anthropic API error:', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

/**
 * POST /api/chat/stream
 * Body: { messages: [...], system?: string }
 * Streams the response as SSE (Server-Sent Events)
 */
router.post('/stream', async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  let finished = false;

  try {
    const stream = getClient().messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: system || 'You are a helpful assistant.',
      messages,
    });

    // Use res.on (not req.on) — fires only on actual client disconnect
    res.on('close', () => {
      if (!finished) stream.controller.abort();
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        write({ type: 'text', text: chunk.delta.text });
      }
    }

    finished = true;
    write({ type: 'done' });
    res.end();

  } catch (err) {
    if (err.name !== 'APIUserAbortError') {
      console.error('Stream error:', err.message);
      write({ type: 'error', error: err.message });
    }
    res.end();
  }
});

export default router;
