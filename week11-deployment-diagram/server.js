// Minggu 11 - Deployment Diagram
// API Server Sistem Perpustakaan.
//
// API Server berkomunikasi dengan Gemini AI Service melalui HTTP.
// API key hanya disimpan dan digunakan oleh AI Service.

import "dotenv/config";
import { createServer } from "node:http";

class Buku {
  constructor(isbn, judul, kategori, eksemplarTersedia) {
    this.isbn = isbn;
    this.judul = judul;
    this.kategori = kategori;
    this.eksemplarTersedia = eksemplarTersedia;
  }
}

class SistemPerpustakaan {
  #buku = [
    new Buku("978-1", "Clean Code", "Teknologi", 2),
    new Buku("978-2", "Design Patterns", "Desain", 1),
  ];

  daftarBuku() {
    return this.#buku;
  }

  cariBuku(isbn) {
    return this.#buku.find((buku) => buku.isbn === isbn);
  }

  pinjamkan(isbn) {
    const buku = this.cariBuku(isbn);

    if (!buku) {
      throw new Error("Buku tidak ditemukan");
    }

    if (buku.eksemplarTersedia <= 0) {
      throw new Error("Stok buku habis");
    }

    buku.eksemplarTersedia -= 1;

    return buku;
  }
}

const sistem = new SistemPerpustakaan();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:3001";

const AI_TIMEOUT_MS = Number(
  process.env.AI_TIMEOUT_MS || 15000,
);

function kirimJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(data, null, 2));
}

async function ambilRekomendasi(kategori) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);

  try {
    const endpoint =
      `${AI_SERVICE_URL}/recommend` +
      `?kategori=${encodeURIComponent(kategori)}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error(
        "AI Service tidak mengembalikan format JSON",
      );
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail ||
        data.pesan ||
        `AI Service merespons HTTP ${response.status}`,
      );
    }

    if (
      data.berhasil !== true ||
      !Array.isArray(data.rekomendasi)
    ) {
      throw new Error(
        "Struktur respons AI Service tidak valid",
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`,
    );

    // Menangani preflight CORS
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type",
      });

      res.end();
      return;
    }

    // Halaman informasi API
    if (req.method === "GET" && url.pathname === "/") {
      kirimJSON(res, 200, {
        nama: "API Sistem Perpustakaan",
        status: "aktif",
        aiService: AI_SERVICE_URL,
        endpoint: [
          "GET /health",
          "GET /buku",
          "GET /buku/:isbn",
          "GET /rekomendasi/:isbn",
          "POST /pinjam/:isbn",
        ],
      });

      return;
    }

    // Status API Server
    if (
      req.method === "GET" &&
      url.pathname === "/health"
    ) {
      kirimJSON(res, 200, {
        status: "ok",
        service: "api-server",
        port: PORT,
        aiServiceUrl: AI_SERVICE_URL,
      });

      return;
    }

    // Daftar seluruh buku
    if (
      req.method === "GET" &&
      url.pathname === "/buku"
    ) {
      kirimJSON(res, 200, {
        berhasil: true,
        jumlah: sistem.daftarBuku().length,
        data: sistem.daftarBuku(),
      });

      return;
    }

    // Detail buku berdasarkan ISBN
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/buku/")
    ) {
      const isbn = decodeURIComponent(
        url.pathname.slice("/buku/".length),
      );

      const buku = sistem.cariBuku(isbn);

      if (!buku) {
        kirimJSON(res, 404, {
          berhasil: false,
          pesan: "Buku tidak ditemukan",
          isbn,
        });

        return;
      }

      kirimJSON(res, 200, {
        berhasil: true,
        data: buku,
      });

      return;
    }

    // Rekomendasi Gemini berdasarkan kategori buku
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/rekomendasi/")
    ) {
      const isbn = decodeURIComponent(
        url.pathname.slice("/rekomendasi/".length),
      );

      const buku = sistem.cariBuku(isbn);

      if (!buku) {
        kirimJSON(res, 404, {
          berhasil: false,
          pesan: "Buku tidak ditemukan",
          isbn,
        });

        return;
      }

      try {
        console.log(
          `Meminta rekomendasi untuk kategori: ${buku.kategori}`,
        );

        const hasil = await ambilRekomendasi(
          buku.kategori,
        );

        kirimJSON(res, 200, {
          berhasil: true,
          bukuAcuan: buku,
          kategori: hasil.kategori,
          rekomendasi: hasil.rekomendasi,
          sumber: hasil.sumber,
          provider: hasil.provider,
          model: hasil.model,
          diverifikasiManusia: false,
        });
      } catch (error) {
        const timeout =
          error.name === "AbortError";

        console.error(
          "Gagal mengambil rekomendasi:",
          timeout ? "timeout" : error.message,
        );

        kirimJSON(res, 502, {
          berhasil: false,
          pesan:
            "Layanan rekomendasi tidak tersedia",
          detail: timeout
            ? `Timeout setelah ${AI_TIMEOUT_MS} ms`
            : error.message,
          fallback: [],
        });
      }

      return;
    }

    // Peminjaman buku
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/pinjam/")
    ) {
      const isbn = decodeURIComponent(
        url.pathname.slice("/pinjam/".length),
      );

      try {
        const buku = sistem.pinjamkan(isbn);

        kirimJSON(res, 200, {
          berhasil: true,
          pesan: "Peminjaman berhasil",
          buku,
        });
      } catch (error) {
        const statusCode =
          error.message === "Buku tidak ditemukan"
            ? 404
            : 400;

        kirimJSON(res, statusCode, {
          berhasil: false,
          pesan: error.message,
        });
      }

      return;
    }

    kirimJSON(res, 404, {
      berhasil: false,
      pesan: "Rute tidak ditemukan",
      metode: req.method,
      path: url.pathname,
    });
  } catch (error) {
    console.error(
      "Kesalahan API Server:",
      error,
    );

    kirimJSON(res, 500, {
      berhasil: false,
      pesan:
        "Terjadi kesalahan internal pada API Server",
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} sedang digunakan aplikasi lain.`,
    );
  } else if (error.code === "EACCES") {
    console.error(
      `Tidak memiliki izin menggunakan port ${PORT}.`,
    );
  } else {
    console.error(
      "API Server gagal dijalankan:",
      error.message,
    );
  }

  process.exit(1);
});

// Jalankan API Server secara langsung
server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("API Server berhasil dijalankan");
  console.log(`URL        : http://localhost:${PORT}`);
  console.log(`AI Service : ${AI_SERVICE_URL}`);
  console.log(`Timeout AI : ${AI_TIMEOUT_MS} ms`);
  console.log(`Health     : http://localhost:${PORT}/health`);
  console.log("========================================");
});

export {
  server,
  sistem,
  ambilRekomendasi,
};