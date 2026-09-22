// AI Service untuk latihan Deployment Diagram.
// Service menggunakan Gemini API untuk menghasilkan rekomendasi buku.
//
// Konfigurasi disimpan di file .env:
// AI_PROVIDER=gemini
// AI_PORT=3001
// GEMINI_API_KEY=API_KEY_ANDA
// GEMINI_MODEL=gemini-3.6-flash

import "dotenv/config";
import { createServer } from "node:http";
import { GoogleGenAI } from "@google/genai";

const PORT = Number(process.env.AI_PORT || 3001);
const HOST = process.env.AI_HOST || "0.0.0.0";
const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Validasi konfigurasi
if (AI_PROVIDER !== "gemini") {
  console.error(
    `AI_PROVIDER "${AI_PROVIDER}" belum didukung. Gunakan AI_PROVIDER=gemini.`,
  );
  process.exit(1);
}

if (
  !GEMINI_API_KEY ||
  GEMINI_API_KEY === "MASUKKAN_API_KEY_ASLI_ANDA" ||
  GEMINI_API_KEY === "ISI_API_KEY_ANDA"
) {
  console.error("GEMINI_API_KEY belum diisi dengan API key asli.");
  console.error("Silakan periksa file .env.");
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("AI_PORT tidak valid.");
  process.exit(1);
}

// Inisialisasi Gemini
const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

function kirimJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(JSON.stringify(data, null, 2));
}

function bersihkanRekomendasi(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (item && typeof item.judul === "string") {
        return item.judul.trim();
      }

      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

async function ambilRekomendasiDariGemini(kategori) {
  const prompt = `
Anda adalah sistem rekomendasi buku perpustakaan.

Berikan tepat 3 rekomendasi buku untuk kategori "${kategori}".

Ketentuan:
1. Buku harus relevan dengan kategori.
2. Jangan memasukkan penjelasan.
3. Kembalikan hasil sebagai array JSON.
4. Setiap item hanya berisi judul buku.

Contoh format:
["Judul Buku 1", "Judul Buku 2", "Judul Buku 3"]
`;

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  if (!result.text) {
    throw new Error("Gemini tidak menghasilkan respons teks.");
  }

  let data;

  try {
    data = JSON.parse(result.text);
  } catch {
    throw new Error("Respons Gemini bukan JSON yang valid.");
  }

  const rekomendasi = bersihkanRekomendasi(data);

  if (rekomendasi.length === 0) {
    throw new Error("Gemini tidak menghasilkan rekomendasi.");
  }

  return rekomendasi;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`,
    );

    // Menangani preflight CORS
    if (req.method === "OPTIONS") {
      kirimJSON(res, 204, {});
      return;
    }

    // Status AI Service
    if (req.method === "GET" && url.pathname === "/health") {
      kirimJSON(res, 200, {
        status: "ok",
        service: "gemini-ai-service",
        provider: AI_PROVIDER,
        model: GEMINI_MODEL,
        port: PORT,
        apiKeyTersedia: true,
      });
      return;
    }

    // Rekomendasi buku dari Gemini
    if (req.method === "GET" && url.pathname === "/recommend") {
      const kategori =
        url.searchParams.get("kategori")?.trim() || "Umum";

      if (kategori.length > 100) {
        kirimJSON(res, 400, {
          pesan: "Kategori maksimal 100 karakter.",
        });
        return;
      }

      console.log(`Meminta rekomendasi kategori: ${kategori}`);

      try {
        const rekomendasi =
          await ambilRekomendasiDariGemini(kategori);

        kirimJSON(res, 200, {
          berhasil: true,
          kategori,
          rekomendasi,
          sumber: "gemini",
          provider: AI_PROVIDER,
          model: GEMINI_MODEL,
          diverifikasiManusia: false,
        });
      } catch (error) {
        console.error("Gemini API Error:", error.message);

        kirimJSON(res, 502, {
          berhasil: false,
          pesan: "Gagal memperoleh rekomendasi dari Gemini.",
          detail: error.message,
          fallback: [],
        });
      }

      return;
    }

    kirimJSON(res, 404, {
      pesan: "Rute tidak ditemukan.",
      ruteTersedia: [
        "GET /health",
        "GET /recommend?kategori=Teknologi",
      ],
    });
  } catch (error) {
    console.error("Kesalahan AI Service:", error);

    kirimJSON(res, 500, {
      berhasil: false,
      pesan: "Terjadi kesalahan internal pada AI Service.",
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sedang digunakan aplikasi lain.`);
  } else if (error.code === "EACCES") {
    console.error(`Tidak memiliki izin menggunakan port ${PORT}.`);
  } else {
    console.error("AI Service gagal dijalankan:", error.message);
  }

  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("Gemini AI Service berhasil dijalankan");
  console.log(`Provider : ${AI_PROVIDER}`);
  console.log(`Model    : ${GEMINI_MODEL}`);
  console.log(`URL      : http://localhost:${PORT}`);
  console.log(`Health   : http://localhost:${PORT}/health`);
  console.log(
    `Contoh   : http://localhost:${PORT}/recommend?kategori=Teknologi`,
  );
  console.log("========================================");
});

export {
  server,
  ambilRekomendasiDariGemini,
};