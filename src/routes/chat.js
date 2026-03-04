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

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = getClient().messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: system || 'You are a helpful assistant.',
      messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('message', (message) => {
      res.write(`data: ${JSON.stringify({ type: 'done', usage: message.usage })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => stream.controller.abort());
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
