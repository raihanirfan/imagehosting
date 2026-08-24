const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
const cssPath = path.join(publicDir, 'style.css');
const css = fs.readFileSync(cssPath, 'utf8');

const ASSET_VERSION = '2.1';

// 1. Update public HTML files to ensure clean inline CSS and versioned defer JS
const publicHtmlFiles = ['index.html', 'docs.html', 'faq.html', 'legal.html', 'contact.html', 'status.html', 'stats.html'];
publicHtmlFiles.forEach(file => {
    const filePath = path.join(publicDir, file);
    if (!fs.existsSync(filePath)) return;
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Replace preconnect, tailwind CDN script, external stylesheet link, or previous inline style
    html = html.replace(/(<link rel="preconnect"[^>]*>\s*)?(<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*)?(<link rel="stylesheet" href="\/style\.css">|<link rel="stylesheet" href="style\.css">|<style>[\s\S]*?<\/style>)/, `<style>${css}</style>`);
    
    // Ensure versioned script with defer
    html = html.replace(/<script src="app\.js[^"]*"[^>]*><\/script>/g, `<script src="app.js?v=${ASSET_VERSION}" defer></script>`);
    if (!html.includes(`app.js?v=${ASSET_VERSION}`) && html.includes('<script src="app.js"></script>')) {
        html = html.replace('<script src="app.js"></script>', `<script src="app.js?v=${ASSET_VERSION}" defer></script>`);
    }
    
    fs.writeFileSync(filePath, html, 'utf8');
});

// 2. Read all static files
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const docsHtml = fs.readFileSync(path.join(publicDir, 'docs.html'), 'utf8');
const faqHtml = fs.readFileSync(path.join(publicDir, 'faq.html'), 'utf8');
const legalHtml = fs.readFileSync(path.join(publicDir, 'legal.html'), 'utf8');
const contactHtml = fs.readFileSync(path.join(publicDir, 'contact.html'), 'utf8');
const statusHtml = fs.readFileSync(path.join(publicDir, 'status.html'), 'utf8');
const statsHtml = fs.readFileSync(path.join(publicDir, 'stats.html'), 'utf8');
const manifestJson = fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8');
const iconSvg = fs.readFileSync(path.join(publicDir, 'icon.svg'), 'utf8');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const statusJs = fs.readFileSync(path.join(publicDir, 'status.js'), 'utf8');
const llmsTxt = fs.readFileSync(path.join(publicDir, 'llms.txt'), 'utf8');

// 3. Generate clean src/routes/frontend.ts with 1-Year Long-Term Caching & Immutable Assets
const frontendFile = path.join(__dirname, '../src/routes/frontend.ts');

const generatedTs = `import { Hono } from 'hono';
import { Env } from '../types';

const frontendRoute = new Hono<{ Bindings: Env }>();

const HTML_CONTENT = ${JSON.stringify(indexHtml)};
const LEGAL_HTML_CONTENT = ${JSON.stringify(legalHtml)};
const FAQ_HTML_CONTENT = ${JSON.stringify(faqHtml)};
const DOCS_HTML_CONTENT = ${JSON.stringify(docsHtml)};
const CONTACT_HTML_CONTENT = ${JSON.stringify(contactHtml)};
const STATUS_HTML_CONTENT = ${JSON.stringify(statusHtml)};
const STATS_HTML_CONTENT = ${JSON.stringify(statsHtml)};
const MANIFEST_CONTENT = ${JSON.stringify(manifestJson)};
const ICON_SVG_CONTENT = ${JSON.stringify(iconSvg)};
const JS_CONTENT = ${JSON.stringify(appJs)};
const STATUS_JS_CONTENT = ${JSON.stringify(statusJs)};
const CSS_CONTENT = ${JSON.stringify(css)};
const LLMS_TXT_CONTENT = ${JSON.stringify(llmsTxt)};

const CANARY_URL = 'https://canarytokens.com/about/terms/5uvajs7m7k9di88n65sz8oic0/submit.aspx';

const createHtmlResponse = (content: string) => {
    return new Response(content, {
        headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
        }
    });
};

// 1. Robots.txt with Honeypot Decoys
frontendRoute.get('/robots.txt', (c) => {
    const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /admin-login',
        'Disallow: /internal-backup',
        'Disallow: /admin-secret',
        'Disallow: /.env',
        'Sitemap: ' + new URL(c.req.url).origin + '/sitemap.xml'
    ].join('\\n');
    return new Response(robots, {
        headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Cache-Control': 'public, max-age=86400'
        }
    });
});

// llms.txt Standard Endpoint for AI agents (llmstxt.org)
frontendRoute.get('/llms.txt', (c) => {
    return new Response(LLMS_TXT_CONTENT, {
        headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
        }
    });
});

frontendRoute.get('/sitemap.xml', function(c) {
    var origin = new URL(c.req.url).origin;
    var pages = ['', '/legal', '/faq', '/docs', '/contact', '/status', '/stats'];
    var now = new Date().toISOString();
    var urls = pages.map(function(p) { return '  <url><loc>' + origin + (p || '/') + '</loc><lastmod>' + now + '</lastmod></url>'; }).join(String.fromCharCode(10));
    var xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + String.fromCharCode(10) + urls + String.fromCharCode(10) + '</urlset>';
    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=UTF-8', 'Cache-Control': 'public, max-age=86400' } });
});

// 2. Honeypot Trigger Handler
const handleHoneypot = async (c: any) => {
    const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';

    // Trigger Canary Token in background with attacker context
    if (c.executionCtx && c.executionCtx.waitUntil) {
        c.executionCtx.waitUntil(
            fetch(CANARY_URL, {
                headers: {
                    'User-Agent': \`\${userAgent} (Honeypot Trap at \${c.req.path} by \${clientIp})\`,
                    'X-Forwarded-For': clientIp
                }
            }).catch(() => {})
        );
    }

    return c.json({
        success: false,
        error: 'Forbidden: Access to restricted area logged.'
    }, 403);
};

// Decoy Honeypot Routes
frontendRoute.on(['GET', 'POST'], '/admin-login', handleHoneypot);
frontendRoute.on(['GET', 'POST'], '/internal-backup', handleHoneypot);
frontendRoute.on(['GET', 'POST'], '/admin-secret', handleHoneypot);
frontendRoute.on(['GET', 'POST'], '/wp-admin', handleHoneypot);
frontendRoute.on(['GET', 'POST'], '/.env', handleHoneypot);

// 3. PWA Assets (Manifest & Icon) - 1 Year Immutable Caching
frontendRoute.get('/manifest.json', (c) => {
    return new Response(MANIFEST_CONTENT, {
        headers: {
            'Content-Type': 'application/manifest+json; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
});

frontendRoute.get('/icon.svg', (c) => {
    return new Response(ICON_SVG_CONTENT, {
        headers: {
            'Content-Type': 'image/svg+xml; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
});

// Native Browser Favicon Endpoint - 1 Year Immutable Caching
frontendRoute.get('/favicon.ico', (c) => {
    return new Response(ICON_SVG_CONTENT, {
        headers: {
            'Content-Type': 'image/svg+xml; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
});

// 4. ShareX Config Download Endpoint (Zero Config, Direct Import)
frontendRoute.get('/sharex.sxcu', (c) => {
    const origin = new URL(c.req.url).origin;
    const sxcuConfig = {
        Version: '15.0.0',
        Name: \`ImgOF (\${origin.replace('https://', '')})\`,
        DestinationType: 'ImageUploader',
        RequestMethod: 'POST',
        RequestURL: \`\${origin}/api/upload\`,
        Body: 'MultipartFormData',
        FileFormName: 'file',
        URL: ':url$',
        ThumbnailURL: ':url$',
        DeletionURL: ':delete_url$',
        ErrorMessage: ':error$'
    };

    return new Response(JSON.stringify(sxcuConfig, null, 2), {
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Content-Disposition': 'attachment; filename="imgof.sxcu"',
            'Cache-Control': 'public, max-age=86400'
        }
    });
});

// 5. Open Graph Image Viewer Page (/v/:id) with Strict Sanitization (Anti-Reflected XSS)
frontendRoute.get('/v/:id', async (c) => {
    const rawParam = c.req.param('id') || '';
    // Strict alphanumeric format check (max 32 chars)
    if (!/^[a-zA-Z0-9_-]{1,32}(\\.[a-zA-Z0-9]{1,10})?$/.test(rawParam)) {
        return c.text('Invalid Image ID', 400);
    }
    const cleanId = rawParam.replace(/\\.[^/.]+$/, '');
    const origin = new URL(c.req.url).origin;
    const imageUrl = \`\${origin}/i/\${encodeURIComponent(rawParam)}\`;

    const escapeHtml = (str: string) => String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const safeCleanId = escapeHtml(cleanId);
    const safeImageUrl = escapeHtml(imageUrl);
    const safeOrigin = escapeHtml(origin);

    const viewerHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ImgOF — \${safeCleanId}</title>
    <meta name="theme-color" content="#0f172a">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="canonical" href="\${safeOrigin}/v/\${safeCleanId}">
    
    <!-- Open Graph & Social Media Cards -->
    <meta property="og:site_name" content="ImgOF">
    <meta property="og:type" content="website">
    <meta property="og:title" content="ImgOF — View Image \${safeCleanId}">
    <meta property="og:description" content="View image hosted on ImgOF.">
    <meta property="og:image" content="\${safeImageUrl}">
    <meta property="og:url" content="\${safeOrigin}/v/\${safeCleanId}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="ImgOF — View Image \${safeCleanId}">
    <meta name="twitter:image" content="\${safeImageUrl}">
    
    <style>\${CSS_CONTENT}</style>
</head>
<body class="bg-gray-900 text-white min-h-screen font-sans flex flex-col justify-between items-center p-4">
    <div class="w-full max-w-4xl flex items-center justify-between py-4 border-b border-gray-800 mb-6">
        <a href="/" class="text-xl font-bold tracking-tight text-white hover:text-blue-400 flex items-center gap-2">
            <span class="text-blue-500">◀</span> ImgOF
        </a>
        <div class="flex items-center gap-3">
            <a href="\${safeImageUrl}" target="_blank" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors">Direct Image</a>
        </div>
    </div>
    
    <main class="w-full max-w-4xl flex flex-col items-center justify-center my-auto">
        <div class="bg-gray-950 p-2 rounded-2xl border border-gray-800 shadow-2xl overflow-hidden max-w-full">
            <img src="\${safeImageUrl}" alt="Hosted on ImgOF" class="max-h-[75vh] w-auto object-contain rounded-xl mx-auto shadow-md">
        </div>
    </main>
    
    <footer class="w-full max-w-4xl text-center py-6 border-t border-gray-800 text-xs text-gray-400 mt-6 flex justify-center items-center gap-5">
        <span>&copy; 2026 ImgOF</span>
        <a href="/docs" class="text-gray-300 hover:text-blue-300 underline">API Docs</a>
        <a href="/faq" class="text-gray-300 hover:text-blue-300 underline">FAQ</a>
        <a href="/status" class="text-gray-300 hover:text-blue-300 underline">Status</a>
        <a href="/contact" class="text-gray-300 hover:text-blue-300 underline">Kontak</a>
        <a href="/legal" class="text-gray-300 hover:text-blue-300 underline">Legal</a>
    </footer>
</body>
</html>\`;

    return createHtmlResponse(viewerHtml);
});

// 6. Web UI Routes with Optimized Cache-Control
frontendRoute.get('/', (c) => {
    return createHtmlResponse(HTML_CONTENT);
});

frontendRoute.get('/legal', (c) => {
    return createHtmlResponse(LEGAL_HTML_CONTENT);
});

frontendRoute.get('/faq', (c) => {
    return createHtmlResponse(FAQ_HTML_CONTENT);
});

frontendRoute.get('/docs', (c) => {
    return createHtmlResponse(DOCS_HTML_CONTENT);
});

frontendRoute.get('/contact', (c) => {
    return createHtmlResponse(CONTACT_HTML_CONTENT);
});

frontendRoute.get('/status', (c) => {
    return createHtmlResponse(STATUS_HTML_CONTENT);
});

frontendRoute.get('/stats', (c) => {
    return createHtmlResponse(STATS_HTML_CONTENT);
});

// 7. Static Assets - 1-Year Long-Term Caching with Immutable & SWR
frontendRoute.get('/app.js', (c) => {
    return new Response(JS_CONTENT, {
        headers: {
            'Content-Type': 'application/javascript; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, stale-while-revalidate=604800, immutable'
        }
    });
});

frontendRoute.get('/status.js', (c) => {
    return new Response(STATUS_JS_CONTENT, {
        headers: {
            'Content-Type': 'application/javascript; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, stale-while-revalidate=604800, immutable'
        }
    });
});

frontendRoute.get('/style.css', (c) => {
    return new Response(CSS_CONTENT, {
        headers: {
            'Content-Type': 'text/css; charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, stale-while-revalidate=604800, immutable'
        }
    });
});

export default frontendRoute;
`;

fs.writeFileSync(frontendFile, generatedTs, 'utf8');
console.log('src/routes/frontend.ts regenerated with /status.js and /status routes!');
