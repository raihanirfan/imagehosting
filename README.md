# ImgOF — High-Performance Serverless Image Hosting

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1_SQLite-F38020?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2_Storage-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Google Drive](https://img.shields.io/badge/Google_Drive-Multi--Storage-4285F4?logo=googledrive&logoColor=white)](https://developers.google.com/drive)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**ImgOF** ([imgof.my.id](https://imgof.my.id)) is a high-speed, privacy-first, zero-login image hosting platform engineered on Cloudflare's global edge network.

---

## 🌟 Features

- ⚡ **Global Edge CDN:** Sub-100ms delivery across 330+ edge datacenters with 1-year immutable caching (`max-age=31536000, immutable`).
- 🗄️ **Multi-Tier Hybrid Storage:** Seamless failover architecture supporting Google Drive, Cloudflare R2, Pixeldrain, and Buzzheavier.
- 🛡️ **Edge Security:**
  - Strict Magic Bytes binary validation (JPEG, PNG, WebP, GIF, SVG).
  - SSRF protection on remote URL uploads.
  - Enterprise HTTP security headers (COOP, HSTS Preload, Strict CSP, nosniff).
  - Dual-tier IP & IPv6 access control firewall (Allowlist & Blocklist).
- 🗜️ **Client & Edge Optimization:** Client-side auto-compression (>1MB to WebP) & custom expiration timers (1h, 24h, 1w, 1m, Permanent).
- ♿ **Modern Standards & Accessibility:** Full WCAG/ARIA compliance, semantic WebMCP form coverage, and [`/llms.txt`](https://llmstxt.org) support.
- 📸 **Desktop ShareX Integration:** Zero-configuration 1-click import (`/sharex.sxcu`).
- 🎯 **Privacy Focused:** No tracking cookies, no invasive analytics, self-service deletion via unique tokens.

---

## 🗺️ Public Endpoints

| Route | Method | Description |
|---|---|---|
| `/` | `GET` | Web UI with Drag & Drop, Clipboard Paste (Ctrl+V), and Local History |
| `/docs` | `GET` | Interactive API documentation (cURL, JavaScript, Python) |
| `/faq` | `GET` | Frequently Asked Questions & ShareX guide |
| `/status` | `GET` | Real-time edge service health & operational status |
| `/stats` | `GET` | Visual analytics & public upload statistics |
| `/contact` | `GET` | Official support, abuse reporting, and feedback center |
| `/legal` | `GET` | Terms of Service, Acceptable Use, and Privacy Policy |
| `/llms.txt` | `GET` | Standardized documentation for AI agents |
| `/sharex.sxcu` | `GET` | Desktop ShareX Custom Uploader configuration file |
| `/i/:id` | `GET` | High-speed CDN edge-cached image delivery |
| `/v/:id` | `GET` | Open Graph image viewer page |
| `/api/upload` | `POST` | Image file and remote URL upload endpoint |
| `/api/delete/:id` | `DELETE, POST`| Permanent file deletion endpoint (requires delete key) |
| `/api/info/:id` | `GET` | Public image metadata endpoint |
| `/api/stats` | `GET` | JSON payload of system statistics |

---

## 📸 ShareX Integration

1. Download [`imgof.sxcu`](https://imgof.my.id/sharex.sxcu).
2. Double-click the file to import directly into ShareX.
3. Start capturing screenshots with instant direct URLs copied to your clipboard.

---

## 💻 Local Development & Deployment

### Prerequisites
- Node.js (v18+)
- Cloudflare Wrangler CLI (`npm install -g wrangler` or via local devDependencies)

```bash
# 1. Clone repository
git clone https://github.com/raihanirfan/imagehosting.git
cd imagehosting

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .dev.vars

# 4. Build frontend Tailwind CSS
npm run build:css

# 5. Typecheck TypeScript
npx tsc --noEmit

# 6. Run locally with Cloudflare Workers emulation
npm run dev

# 7. Deploy to Cloudflare Workers
npm run deploy
```

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
