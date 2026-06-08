// ============================================================
// IMAGEGEN.JS — Generación de imágenes con Google Imagen 3
// ============================================================

const fetch = require('node-fetch');

async function generateImage(prompt) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { ok: false, error: 'GOOGLE_API_KEY no configurada' };

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=' + key,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            safetyFilterLevel: 'block_few'
          }
        })
      }
    );

    const data = await res.json();

    if (data.error) return { ok: false, error: data.error.message };
    if (!data.predictions || !data.predictions[0]) return { ok: false, error: 'Sin resultado' };

    // La imagen viene en base64
    const base64 = data.predictions[0].bytesBase64Encoded;
    const buffer = Buffer.from(base64, 'base64');
    return { ok: true, buffer: buffer };

  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { generateImage };
