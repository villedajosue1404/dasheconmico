// ============================================================
// IMAGEGEN.JS — Generación de imágenes con Hugging Face
// Modelo: FLUX.1-schnell (gratis, buena calidad)
// ============================================================

const fetch = require('node-fetch');

async function generateImage(prompt) {
  const key = process.env.HF_API_KEY;
  if (!key) return { ok: false, error: 'HF_API_KEY no configurada' };

  try {
    const res = await fetch(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs: prompt })
      }
    );

    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.error || 'Error ' + res.status };
    }

    // Hugging Face devuelve la imagen directo como blob
    const buffer = await res.buffer();
    return { ok: true, buffer: buffer };

  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { generateImage };
