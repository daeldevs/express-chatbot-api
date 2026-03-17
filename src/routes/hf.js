// src/routes/hf.js
import { Router } from 'express';
import { getHfClient, HF_MODEL, buildPrompt } from '../lib/hfClient.js';

const router = Router();

/**
 * POST /api/hf/chat
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }], system?: string }
 *
 * Non-streaming chat with the HuggingFace model.
 */
router.post('/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const prompt = buildPrompt(messages, system);

    const result = await getHfClient().textGeneration({
      model: HF_MODEL,
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.7,
        repetition_penalty: 1.3,
        return_full_text: false, // only return new tokens, not the prompt
        stop: ['Human:', '\nHuman:', 'System:'], // stop before a new turn starts
      },
    });

    const assistantMessage = result.generated_text.trim();

    res.json({ message: assistantMessage, model: HF_MODEL });
  } catch (err) {
    console.error('HuggingFace API error:', err);

    // HF returns 503 when the model is loading (cold start)
    if (err.message?.includes('loading') || err.status === 503) {
      return res.status(503).json({
        error: 'Model is loading. Please retry in 20–30 seconds.',
        loading: true,
      });
    }

    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

/**
 * POST /api/hf/chat/stream
 * Body: { messages: [...], system?: string }
 * Streams the response token-by-token as SSE.
 */
router.post('/chat/stream', async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const prompt = buildPrompt(messages, system);

    const stream = getHfClient().textGenerationStream({
      model: HF_MODEL,
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.7,
        repetition_penalty: 1.3,
        return_full_text: false,
        stop: ['Human:', '\nHuman:', 'System:'],
      },
    });

    for await (const chunk of stream) {
      const token = chunk.token?.text ?? '';

      // Stop streaming if a stop sequence is detected
      if (chunk.details?.finish_reason === 'stop_sequence') break;

      res.write(`data: ${JSON.stringify({ type: 'text', text: token })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('HuggingFace stream error:', err);

    if (err.message?.includes('loading') || err.status === 503) {
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: 'Model is loading. Retry in 20–30s.', loading: true })}\n\n`
      );
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    }

    res.end();
  }
});

export default router;
