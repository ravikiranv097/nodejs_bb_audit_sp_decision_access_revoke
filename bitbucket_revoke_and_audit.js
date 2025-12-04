// bitbucket_revoke_from_csv.js
'use strict';

/*
  Purpose:
  - Read input_files/access_check_results.csv
  - For each row where AccessStatus == HAS_ACCESS:
      1. Revoke project-level access via Bitbucket DC API
      2. Verify via REST API
      3. Generate HTML evidence file
      4. Take PNG screenshot using Puppeteer
      5. Write into "after revoke" CSVs
      6. Generate DOCX reports (has_access + no_access)
*/

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const axios = require('axios');
const puppeteer = require('puppeteer');
const officegen = require('officegen');
const sharp = require('sharp');
require('dotenv').config();

// --------------------------------------------
// CONFIGURATION
// --------------------------------------------

const ROOT = process.cwd();

const INPUT_DIR = path.join(ROOT, 'input_files');
const OUTPUT_DIR = path.join(ROOT, 'output_files');
const HTML_DIR = path.join(OUTPUT_DIR, 'html');
const PNG_DIR = path.join(OUTPUT_DIR, 'png');
const HAS_ACCESS_PNG_DIR = path.join(PNG_DIR, 'has_access');
const NO_ACCESS_PNG_DIR = path.join(PNG_DIR, 'no_access');
const DOC_DIR = path.join(OUTPUT_DIR, 'doc');
const LOG_DIR = path.join(OUTPUT_DIR, 'logs');

// Fixed Input CSV path
const INPUT_CSV_PATH = path.join(INPUT_DIR, 'access_check_results.csv');

// Output CSVs
const ACCESS_OUTPUT_CSV = path.join(OUTPUT_DIR, 'access_check_results_after_revoke.csv');
const NO_ACCESS_OUTPUT_CSV = path.join(OUTPUT_DIR, 'no_access_check_results_after_revoke.csv');

// Bitbucket Config
const BB_URL_RAW = (process.env.BB_URL || '').trim();
const USERNAME = process.env.BB_USERNAME;
const KEYNAME = process.env.BB_KEYNAME;

if (!BB_URL_RAW || !USERNAME || !KEYNAME) {
  console.error("Missing BB_URL, BB_USERNAME or BB_KEYNAME in .env");
  process.exit(1);
}

// Normalize base URL: ensure there's a protocol and no trailing slash
let BASE_URL = BB_URL_RAW.replace(/\/+$|\/+$/g, '');
if (!/^https?:\/\//i.test(BASE_URL)) {
  BASE_URL = 'http://' + BASE_URL;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

ensureDir(INPUT_DIR);
ensureDir(OUTPUT_DIR);
ensureDir(HTML_DIR);
ensureDir(PNG_DIR);
ensureDir(HAS_ACCESS_PNG_DIR);
ensureDir(NO_ACCESS_PNG_DIR);
ensureDir(DOC_DIR);
ensureDir(LOG_DIR);

function safeName(s) {
  return String(s || '').replace(/[\/\\?%*:|"<> ]+/g, '_');
}

function formatTs() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatSafeTs() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// --------------------------------------------
// BITBUCKET API CALLS
// --------------------------------------------

async function revokeAccess(projectKey, username) {
  const url = `${BASE_URL}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/permissions/users?name=${encodeURIComponent(username)}`;
  try {
    const resp = await axios({
      method: 'delete',
      url,
      auth: { username: USERNAME, password: KEYNAME },
      validateStatus: () => true,
      timeout: 20000
    });
    return { ok: resp.status === 204, status: resp.status, url };
  } catch (err) {
    return { ok: false, status: null, error: err.message, url };
  }
}

async function verifyAccess(projectKey, username) {
  const url = `${BASE_URL}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/permissions/users?filter=${encodeURIComponent(username)}`;
  try {
    const resp = await axios.get(url, {
      auth: { username: USERNAME, password: KEYNAME },
      timeout: 20000
    });

    let hasAccess = false;
    if (resp.data && Array.isArray(resp.data.values)) {
      hasAccess = resp.data.values.some(v => {
        const nm = v.name || (v.user && v.user.name) || "";
        return nm.toLowerCase() === username.toLowerCase();
      });
    }

    return { ok: true, status: resp.status, hasAccess, raw: resp.data, url };
  } catch (err) {
    return { ok: false, error: err.message, url };
  }
}

// --------------------------------------------
// HTML + PNG Evidence
// --------------------------------------------

async function createEvidence({ user, accId, projectKey, apiUrl, apiResponse, destPng }) {
  ensureDir(HTML_DIR);
  const stamp = formatSafeTs();
  const htmlFile = path.join(HTML_DIR, `${safeName(user)}_${safeName(projectKey)}_${stamp}.html`);

  const html = `
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; }
    #evidence { font-family: monospace; padding: 20px; box-sizing: border-box; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div id="evidence">
    <b>User:</b> ${user}<br>
    <b>Account ID:</b> ${accId}<br>
    <b>Project:</b> ${projectKey}<br>
    <b>Timestamp:</b> ${formatTs()}<br><br>
    <h3>API URL</h3>
    <p>${apiUrl}</p>
    <h3>Response JSON</h3>
    <pre>${JSON.stringify(apiResponse, null, 2)}</pre>
  </div>
</body>
</html>
`;

  fs.writeFileSync(htmlFile, html);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + htmlFile, { waitUntil: 'networkidle0' });
  // Compute bounding rect of the evidence container and screenshot that area
  const rect = await page.evaluate(() => {
    const el = document.getElementById('evidence') || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });

  // Clamp dimensions to avoid browser limits
  const MAX_DIM = 16384;
  const clipX = Math.max(0, rect.x);
  const clipY = Math.max(0, rect.y);
  const clipW = Math.min(rect.width || 1280, MAX_DIM);
  const clipH = Math.min(rect.height || 900, MAX_DIM);

  // Ensure viewport is large enough to capture the clip area
  await page.setViewport({ width: Math.max(clipX + clipW, 1280), height: Math.max(clipY + clipH, 900) });

  // Screenshot the exact bounding box to remove extra whitespace
  const tmpPng = destPng + '.tmp.png';
  try {
    await page.screenshot({ path: tmpPng, clip: { x: clipX, y: clipY, width: clipW, height: clipH } });
  } catch (e) {
    // Fallback to full-page screenshot if clip fails
    await page.screenshot({ path: tmpPng, fullPage: true });
  }

  // Trim uniform background whitespace using sharp
  try {
    await sharp(tmpPng).trim().toFile(destPng);
    fs.unlinkSync(tmpPng);
  } catch (e) {
    // If sharp fails, fallback to the raw screenshot
    try { fs.renameSync(tmpPng, destPng); } catch (_) { /* ignore */ }
  }
  await browser.close();

  return { htmlFile, pngFile: destPng };
}

// --------------------------------------------
// DOCX GENERATOR
// --------------------------------------------

async function createDocx(dirPath, docName) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".png"));
  if (files.length === 0) return;

  const docx = officegen('docx');
  const outPath = path.join(DOC_DIR, docName);

  const title = docx.createP({ align: 'center' });
  title.addText(docName.replace('.docx',''), { bold: true, font_size: 28 });

  docx.createP().addText(`Generated: ${formatTs()}`, { font_size: 14 });

  files.forEach((img, idx) => {
    const p = docx.createP({ align: 'center' });
    // Constrain image width to fit in the page and keep aspect ratio.
    // Try to detect actual image dimensions using `image-size` (optional
    // dependency). If not available, fall back to adding the image
    // without sizing.
    const MAX_IMG_WIDTH_PX = 600;
    const imgPath = path.join(dirPath, img);
    try {
      let size;
      try {
        const sizeOf = require('image-size');
        size = sizeOf(imgPath);
      } catch (e) {
        size = null; // image-size not installed or failed
      }

      if (size && size.width && size.height) {
        const origW = size.width;
        const origH = size.height;
        const scale = Math.min(1, MAX_IMG_WIDTH_PX / origW);
        const targetW = Math.round(origW * scale);
        const targetH = Math.round(origH * scale);
        p.addImage(imgPath, { cx: targetW, cy: targetH });
      } else {
        // Fallback: add without explicit sizing
        p.addImage(imgPath);
      }
    } catch (e) {
      // If officegen or image reading fails, log and fallback
      console.error('Failed to add image to DOCX:', imgPath, e.message || e);
      try { p.addImage(imgPath); } catch (e2) { /* ignore */ }
    }
    if (idx < files.length - 1) docx.putPageBreak();
  });

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    out.on('error', reject);
    out.on('close', resolve);
    docx.generate(out);
  });

  console.log("DOCX created →", outPath);
}

// --------------------------------------------
// MAIN WORKFLOW
// --------------------------------------------

(async function main() {
  try {
    console.log("Reading:", INPUT_CSV_PATH);

    if (!fs.existsSync(INPUT_CSV_PATH)) {
      console.error("CSV not found:", INPUT_CSV_PATH);
      process.exit(1);
    }

    const raw = fs.readFileSync(INPUT_CSV_PATH, 'utf8');
    const rows = csv.parse(raw, { columns: true });

    // Prepare output CSV files
    fs.writeFileSync(ACCESS_OUTPUT_CSV,
      "Username,Account ID,Project Key,Access Permission,Access Status,Timestamp,Screenshot\n"
    );
    fs.writeFileSync(NO_ACCESS_OUTPUT_CSV,
      "Username,Account ID,Project Key,Access Permission,Access Status,Timestamp,Screenshot\n"
    );

    for (const row of rows) {
      const user = (row['Username'] || '').trim();
      const accId = (row['Account ID'] || '').trim();
      const project = (row['Project Key'] || '').trim();
      const permission = (row['Access Permission'] || '').trim();
      const status = (row['Access Status'] || '').trim();

      if (!user || !project) continue;

      if (status !== "HAS_ACCESS") {
        console.log(`Skipping ${user} - already NO_ACCESS`);
        continue;
      }

      console.log(`\nRevoking access for ${user} on project ${project}`);

      // 1) Revoke
      const revokeRes = await revokeAccess(project, user);
      console.log("  Revoke:", revokeRes.status, revokeRes.ok ? "OK" : "FAILED");

      // 2) Verify
      const verifyRes = await verifyAccess(project, user);
      console.log("  Verify:", verifyRes.status, verifyRes.hasAccess ? "Still HAS_ACCESS" : "NO_ACCESS");

      const ts = formatTs();
      const safeTs = formatSafeTs();

      const destPng = verifyRes.hasAccess
        ? path.join(HAS_ACCESS_PNG_DIR, `${safeName(user)}_${safeName(project)}_${safeTs}.png`)
        : path.join(NO_ACCESS_PNG_DIR, `${safeName(user)}_${safeName(project)}_${safeTs}.png`);

      // 3) Evidence
      const evidence = await createEvidence({
        user, accId, projectKey: project,
        apiUrl: verifyRes.url,
        apiResponse: verifyRes.raw || verifyRes,
        destPng
      });

      // 4) Append CSV
      if (verifyRes.hasAccess) {
        fs.appendFileSync(ACCESS_OUTPUT_CSV,
          `${user},${accId},${project},${permission},HAS_ACCESS,${ts},${evidence.pngFile}\n`
        );
      } else {
        fs.appendFileSync(NO_ACCESS_OUTPUT_CSV,
          `${user},${accId},${project},${permission},NO_ACCESS,${ts},${evidence.pngFile}\n`
        );
      }
    }

    // Generate DOC files
    await createDocx(HAS_ACCESS_PNG_DIR, "Bitbucket_Has_Access_Report.docx");
    await createDocx(NO_ACCESS_PNG_DIR, "Bitbucket_No_Access_Report.docx");

    console.log("\n✔ DONE. All outputs generated in:", OUTPUT_DIR);

  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(2);
  }
})();
