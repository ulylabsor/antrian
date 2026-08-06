// ============================================================
// TTS — Text-to-Speech bahasa Indonesia untuk panggilan antrian
// ============================================================
// Strategi dua lapis (fallback otomatis):
//   1. Google Cloud Text-to-Speech (neural voice) — suara manusiawi &
//      enak didengar seperti announcer bandara. Butuh service account
//      (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY) yang SAMA
//      dengan yang dipakai untuk sync Google Sheets, plus Cloud
//      Text-to-Speech API di-enable di project yang sama.
//   2. google-tts-api (Google Translate) — suara robotik tapi 100% gratis
//      & tanpa konfigurasi. Dipakai otomatis bila Cloud TTS belum
//      dikonfigurasi atau gagal, supaya aplikasi tetap bersuara.
// ============================================================
import dotenv from 'dotenv';
dotenv.config();

let cloudClient = null;
let cloudClientInitTried = false;
let cloudClientInitPromise = null;

// Inisialisasi client Cloud TTS (sekali, lazy, async). Null bila belum ada credentials.
async function getCloudClient() {
  if (cloudClientInitTried) return cloudClient;
  if (cloudClientInitPromise) return cloudClientInitPromise;
  cloudClientInitPromise = (async () => {
    cloudClientInitTried = true;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY;
    if (!email || !key) return null; // belum dikonfigurasi → fallback
    try {
      // Dynamic import (project pakai ESM) supaya aplikasi tetap jalan
      // walau paket bermasalah / belum dikonfigurasi.
      const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
      cloudClient = new TextToSpeechClient({
        credentials: {
          type: 'service_account',
          client_email: email,
          private_key: key.replace(/\\n/g, '\n'),
        },
      });
      return cloudClient;
    } catch (err) {
      console.warn('Cloud TTS client gagal init, fallback ke Google Translate TTS:', err.message);
      return null;
    } finally {
      cloudClientInitPromise = null;
    }
  })();
  return cloudClientInitPromise;
}

// Voice neural id-ID. Neural2-C = perempuan, hangat & jelas (cocok announcer).
// Bila voice tertentu tidak tersedia di project, Cloud TTS akan error → fallback.
const NEURAL_VOICE = { languageCode: 'id-ID', name: 'id-ID-Neural2-C', ssmlGender: 'FEMALE' };

/**
 * Generate audio panggilan dari teks.
 * @param {string} teks
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
export async function generatePanggilanAudio(teks) {
  // --- Lapis 1: Google Cloud TTS (neural) ---
  const client = await getCloudClient();
  if (client) {
    try {
      const [response] = await client.synthesizeSpeech({
        input: { text: teks },
        voice: NEURAL_VOICE,
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 0.9,   // sedikit lebih lambat & tenang (gaya announcer)
          pitch: 0,
        },
      });
      if (response && response.audioContent) {
        return { buffer: Buffer.from(response.audioContent, 'base64'), contentType: 'audio/mpeg' };
      }
    } catch (err) {
      console.warn('Cloud TTS synthesize gagal, fallback ke Google Translate TTS:', err.message);
    }
  }

  // --- Lapis 2: google-tts-api (Google Translate) — fallback ---
  const { getAudioBase64 } = await import('google-tts-api');
  const result = await getAudioBase64(teks, { lang: 'id', slow: false });
  return { buffer: Buffer.from(result, 'base64'), contentType: 'audio/mpeg' };
}

// Cek apakah Cloud TTS aktif (untuk info/debug di endpoint)
export async function isCloudTTSAvailable() {
  const client = await getCloudClient();
  return client !== null;
}
