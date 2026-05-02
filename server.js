const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");

try {
  process.loadEnvFile(".env");
} catch {}

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.static("public"));
app.use(express.json({ limit: "10mb" }));

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
const cfHeaders = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// ---- Pixabay: search for an image ----
app.get("/api/pixabay", async (req, res) => {
  const q = req.query.q || "cat";
  const url = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(q)}&image_type=photo&per_page=3`;
  const data = await (await fetch(url)).json();
  const hit = data.hits?.[0];
  if (!hit) return res.status(404).json({ error: "no image found" });
  res.json({ url: hit.webformatURL });
});

// ---- Gemini: chat (using @google/genai SDK) ----
app.post("/api/gemini-chat", async (req, res) => {
  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "For each of the following words, write the literal opposite word. Do not argue with me. If it's a proper noun, get creative. For example if it's a location, choose a location on the opposite side of the word. Output the exact same number of words as the input. DO NOT output anything else. " + String(req.body.message),
    config: { temperature: 1, maxOutputTokens: 500 }
  });
  res.json({ text: response.text });
});

// ---- Gemini: chat (raw fetch — kept for reference) ----
// app.post("/api/gemini-chat", async (req, res) => {
//   const r = await fetch(
//     `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
//     {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         contents: [{ role: "user", parts: [{ text: req.body.message }] }],
//         generationConfig: { temperature: 1, maxOutputTokens: 500 }
//       })
//     }
//   );
//   const data = await r.json();
//   if (data.error) return res.status(500).json({ error: data.error.message });
//   res.json({ text: data.candidates[0].content.parts[0].text });
// });

// ---- Cloudflare: chat (Llama 4 Scout) ----
app.post("/api/cloudflare-chat", async (req, res) => {
  const r = await fetch(`${CF_BASE}/@cf/meta/llama-4-scout-17b-16e-instruct`, {
    method: "POST",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: req.body.message }],
      max_tokens: 500
    })
  });
  const data = await r.json();
  if (!data.success) return res.status(500).json({ error: JSON.stringify(data.errors) });
  res.json({ text: data.result.response });
});

// ---- Cloudflare: text-to-image (Flux 1 Schnell — JSON+base64) ----
app.post("/api/cloudflare-image", async (req, res) => {
  const r = await fetch(`${CF_BASE}/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: req.body.prompt, num_steps: 8 })
  });
  const data = await r.json();
  if (!data.success) return res.status(500).json({ error: JSON.stringify(data.errors) });
  res.set("Content-Type", "image/jpeg");
  res.send(Buffer.from(data.result.image, "base64"));
});

// ---- Cloudflare: image-to-image (Stable Diffusion 1.5 img2img — JSON in, raw image bytes out) ----
app.post("/api/cloudflare-img2img", async (req, res) => {
  const { prompt, image_b64 } = req.body;
  const r = await fetch(`${CF_BASE}/@cf/runwayml/stable-diffusion-v1-5-img2img`, {
    method: "POST",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_b64,
      // strength: how much to change the input image. 0 = identical, 1 = ignore input.
      strength: 0.7
    })
  });
  if (!r.ok) return res.status(500).json({ error: await r.text() });
  res.set("Content-Type", "image/png");
  res.send(Buffer.from(await r.arrayBuffer()));
});

// ---- ElevenLabs: text-to-speech (using @elevenlabs/elevenlabs-js SDK) ----
app.post("/api/tts", async (req, res) => {
  const audio = await elevenlabs.textToSpeech.convert("hpp4J3VqNfWAUOO0d1Us", {
    text: req.body.text,
    modelId: "eleven_flash_v2_5",
    outputFormat: "mp3_44100_128"
  });
  res.set("Content-Type", "audio/mpeg");
  const chunks = [];
  for await (const chunk of audio) chunks.push(chunk);
  res.send(Buffer.concat(chunks));
});

// ---- ElevenLabs: sound effects (using @elevenlabs/elevenlabs-js SDK) ----
app.post("/api/sfx", async (req, res) => {
  const audio = await elevenlabs.textToSoundEffects.convert({
    text: req.body.prompt,
    durationSeconds: 5
  });
  res.set("Content-Type", "audio/mpeg");
  const chunks = [];
  for await (const chunk of audio) chunks.push(chunk);
  res.send(Buffer.concat(chunks));
});

// ---- ElevenLabs: music generation ----
app.post("/api/music", async (req, res) => {
  const scales = [
    'C Major', 'C Minor',
    'Db Major', 'C# Minor',
    'D Major', 'D Minor',
    'Eb Major', 'D# Minor',
    'E Major', 'E Minor',
    'F Major', 'F Minor',
    'Gb Major', 'F# Minor',
    'G Major', 'G Minor',
    'Ab Major', 'G# Minor',
    'A Major', 'A Minor',
    'Bb Major', 'A# Minor',
    'B Major', 'B Minor'
  ];
  const timeSignatures = ['4/4', '3/4', '5/4', '6/8', '7/8', '9/8', '12/8'];
  const randomScale = req.body.scale || scales[Math.floor(Math.random() * scales.length)];
  const randomBPM = req.body.bpm || (Math.floor(Math.random() * (200 - 70 + 1)) + 70);
  const randomTimeSignature = req.body.timeSignature || timeSignatures[Math.floor(Math.random() * timeSignatures.length)];
  const audio = await elevenlabs.music.compose({
    prompt: String(req.body.prompt) + ` at ${randomBPM} BPM in ${randomScale} with a ${randomTimeSignature} time signature. Do not include vocals.`,
    musicLengthMs: 30000
  });
  res.set("Content-Type", "audio/mpeg");
  const chunks = [];
  for await (const chunk of audio) chunks.push(chunk);
  res.send(Buffer.concat(chunks));
});

// ---- ElevenLabs: text-to-speech (raw fetch — kept for reference) ----
// app.post("/api/tts", async (req, res) => {
//   const voiceId = "hpp4J3VqNfWAUOO0d1Us"; // Bella
//   const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
//     method: "POST",
//     headers: {
//       "xi-api-key": process.env.ELEVENLABS_API_KEY,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({ text: req.body.text, model_id: "eleven_flash_v2_5" })
//   });
//   if (!r.ok) return res.status(500).json({ error: await r.text() });
//   res.set("Content-Type", "audio/mpeg");
//   res.send(Buffer.from(await r.arrayBuffer()));
// });

// ---- ElevenLabs: sound effects (raw fetch — kept for reference) ----
// app.post("/api/sfx", async (req, res) => {
//   const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
//     method: "POST",
//     headers: {
//       "xi-api-key": process.env.ELEVENLABS_API_KEY,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({ text: req.body.prompt, duration_seconds: 5 })
//   });
//   if (!r.ok) return res.status(500).json({ error: await r.text() });
//   res.set("Content-Type", "audio/mpeg");
//   res.send(Buffer.from(await r.arrayBuffer()));
// });

app.listen(port, () => console.log(`Server is listening on port ${port}`));
