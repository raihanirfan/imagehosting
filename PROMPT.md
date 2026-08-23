# SPECIFICATION & SYSTEM PROMPT: Cloudflare Serverless Image Hosting

> **Target Platform:** Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare R2 (Object Storage), Cloudflare Pages (Frontend)  
> **Backend Framework:** Hono.js (TypeScript)  
> **Frontend Stack:** Vite + Vanilla TypeScript + Tailwind CSS (Single Page App)  
> **Goal:** Build an ultrafast, production-ready, cost-free public image hosting service (similar to Tikolu / Imgur minimalist clone).

---

## 1. Project Overview & Architecture

You are tasked with building a full-stack, serverless image hosting application that leverages Cloudflare's ecosystem to operate completely within the Free Tier limits ($0 egress fee).

### Architecture Components:
- **Backend API (Cloudflare Worker):** Handles image uploads, hash deduplication, metadata persistence, deletion logic, and edge delivery routing.
- **Database (Cloudflare D1):** Relational storage for metadata (`id`, `hash`, `mime_type`, `size`, `delete_token`, `created_at`, `views`).
- **Object Storage (Cloudflare R2):** Stores raw image files (`.webp`, `.png`, `.jpg`, `.gif`).
- **Frontend (Cloudflare Pages):** Minimalist drag-and-drop UI with client-side WebP compression, clipboard paste support, upload progress, and local upload history.
- **Bot Protection:** Cloudflare Turnstile verification.

---

## 2. Directory Structure

Please create the project following this clean structure:

```text
image-hosting/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── schema.sql
├── src/
│   ├── index.ts                # Main Hono application entrypoint
│   ├── types.ts                # TypeScript bindings & interfaces
│   ├── db/
│   │   └── queries.ts          # D1 Database helper queries
│   ├── utils/
│   │   ├── hash.ts             # SHA-256 calculation helper
│   │   ├── nanoid.ts           # Custom slug generator (5-7 chars)
│   │   └── turnstile.ts        # Cloudflare Turnstile validator
│   └── routes/
│       ├── upload.ts           # POST /api/upload
│       ├── serve.ts            # GET /i/:id (Serve image from R2 with edge cache)
│       └── delete.ts           # DELETE /api/delete/:id
└── public/
    ├── index.html              # Frontend UI with Tailwind CSS CDN / built bundle
    ├── app.js                  # Client upload logic, compression, local storage history
    └── style.css               # Custom animations / styles
```

---

## 3. Database Schema (`schema.sql`)

Create the SQLite migration file for Cloudflare D1:

```sql
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,               -- e.g. "a9xZ2k" (alphanumeric short ID)
    hash TEXT NOT NULL UNIQUE,          -- SHA-256 hash for deduplication
    original_name TEXT,                 -- Original file name
    mime_type TEXT NOT NULL,            -- e.g. "image/webp", "image/png"
    size_bytes INTEGER NOT NULL,        -- File size in bytes
    delete_token TEXT NOT NULL,         -- UUID or secure token for deletion
    views INTEGER DEFAULT 0,            -- Access counter
    created_at INTEGER NOT NULL         -- Unix timestamp (milliseconds)
);

CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
```

---

## 4. Backend Requirements (Cloudflare Worker + Hono)

### Environment Bindings (`src/types.ts`)
```typescript
export interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    TURNSTILE_SECRET_KEY?: string;
    ENVIRONMENT?: string;
}
```

### Endpoints Specification:

#### 1. `POST /api/upload`
- **Accepts:** `multipart/form-data` with fields:
  - `file`: Binary image file (Max size: 10MB).
  - `turnstile_token`: (Optional/Enforced based on environment).
- **Validation:**
  - Verify Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`.
  - Validate Turnstile token with Cloudflare verification API if secret key is present.
- **Deduplication Check:**
  - Compute SHA-256 hash of the incoming file buffer.
  - Query D1: If `hash` already exists in `images`, return the existing file URL immediately without writing to R2 again.
- **Storage:**
  - Generate a secure, URL-safe short slug (e.g., 6 characters alphanumeric: `[a-zA-Z0-9]`).
  - Store object in R2 with key `${id}.${extension}` and appropriate `httpMetadata: { contentType: mime_type }`.
  - Generate a secure `delete_token` (e.g., UUIDv4 or 32-character random string).
  - Insert record into D1 `images` table.
- **Response JSON (201 Created):**
  ```json
  {
    "success": true,
    "id": "x8Kq2P",
    "url": "https://yourdomain.com/i/x8Kq2P.webp",
    "direct_url": "https://yourdomain.com/i/x8Kq2P.webp",
    "delete_url": "https://yourdomain.com/api/delete/x8Kq2P?token=SECRET_TOKEN",
    "size": 142050,
    "mime_type": "image/webp",
    "markdown": "![Image](https://yourdomain.com/i/x8Kq2P.webp)",
    "html": "<img src="https://yourdomain.com/i/x8Kq2P.webp" alt="Image" />"
  }
  ```

#### 2. `GET /i/:id` (or `/i/:id.:ext`)
- Retrieve the requested file from R2 bucket.
- If not found, return 404 JSON/Text.
- If found:
  - Increment `views` in D1 asynchronously (`ctx.waitUntil(incrementViewCount(db, id))`).
  - Set HTTP response headers for maximal edge caching:
    ```http
    Content-Type: <mime_type>
    Cache-Control: public, max-age=31536000, immutable
    Access-Control-Allow-Origin: *
    ```
  - Return the readable stream directly from R2 object body.

#### 3. `DELETE /api/delete/:id`
- Accepts query param `token` or JSON payload `{ "token": "..." }`.
- Verify if `delete_token` matches the record in D1.
- If verified:
  - Delete object from R2 bucket.
  - Delete record from D1 database.
  - Return `{ "success": true, "message": "Image deleted permanently." }`.
- If invalid token, return `403 Forbidden`.

#### 4. `GET /api/info/:id`
- Returns public metadata: `{ id, mime_type, size_bytes, views, created_at }`. Do **NOT** expose `delete_token` or uploader IP.

---

## 5. Frontend Requirements (`public/`)

Create a sleek, minimalist, responsive user interface (dark/light modern aesthetic similar to modern developer tools).

### Core Features:
1. **Dropzone:** Large interactive area supporting:
   - Drag and drop files
   - Click to browse
   - **Paste directly from clipboard (`Ctrl+V` / `Cmd+V`)**
2. **Client-Side Compression:**
   - Before uploading, if the image is `image/png` or `image/jpeg` larger than 1MB, optionally convert and compress to `image/webp` using HTML5 Canvas API to save user bandwidth and R2 storage.
3. **Upload Progress & States:**
   - Loading indicator with upload progress bar.
   - Error handling toast (file too big, invalid format, network failure).
4. **Post-Upload Result Modal/Card:**
   - Image preview thumbnail.
   - Quick copy buttons for:
     - **Direct Link:** `https://domain.com/i/abc.webp`
     - **Markdown:** `![Image](https://domain.com/i/abc.webp)`
     - **HTML Embed:** `<img src="..." />`
     - **BBCode:** `[IMG]...[/IMG]`
   - Red button with confirmation dialog: **"Delete this image now"** (uses local delete token).
5. **Local Upload History (LocalStorage):**
   - Save the list of uploaded images in browser `localStorage` (storing ID, URL, delete token, and timestamp).
   - Display a "Recent Uploads" grid section below the dropzone with preview cards and one-click delete buttons.

---

## 6. Configuration Template (`wrangler.toml`)

```toml
name = "image-hosting"
main = "src/index.ts"
compatibility_date = "2024-04-01"

# Enable static assets serving for Cloudflare Workers / Pages
[site]
bucket = "./public"

# Cloudflare D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "image_db"
database_id = "<REPLACE_WITH_YOUR_D1_DATABASE_ID>"

# Cloudflare R2 Bucket Binding
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "images-bucket"

# Environment Variables (Optional Turnstile Secret)
[vars]
ENVIRONMENT = "production"
# TURNSTILE_SECRET_KEY = "0x4AAAAAA..."
```

---

## 7. Execution & Implementation Steps for the Agent

When implementing this project, execute the following steps in order:

1. **Initialize Project:** Create `package.json` with dependencies (`hono`, `@cloudflare/workers-types`, `wrangler`, `typescript`).
2. **Write TypeScript Boilerplate:** Setup `tsconfig.json` optimized for Cloudflare Workers.
3. **Setup Database & Queries:** Write `schema.sql` and `src/db/queries.ts` with prepared D1 statements.
4. **Implement Helper Modules:**
   - `src/utils/hash.ts`: Streaming/Buffer SHA-256 calculation.
   - `src/utils/nanoid.ts`: Fast collision-resistant random ID generator.
   - `src/utils/turnstile.ts`: Cloudflare Turnstile token validation helper.
5. **Implement API Routes:** Create `src/routes/upload.ts`, `src/routes/serve.ts`, and `src/routes/delete.ts`.
6. **Assemble Entrypoint:** Mount routes into main Hono app in `src/index.ts` with CORS and error handling middlewares.
7. **Build Frontend:** Create standard, self-contained `public/index.html`, `public/app.js`, and `public/style.css` implementing all required UI features.
8. **Provide Setup Commands:** Output the exact terminal commands required to run migrations, test locally (`wrangler dev`), and deploy to production (`wrangler deploy`).

---
*Ready to execute. Start by scaffolding the project files and dependencies.*
