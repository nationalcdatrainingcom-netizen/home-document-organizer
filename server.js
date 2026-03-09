const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Storage paths (Render persistent disk mounts at /data) ──
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const META_FILE = path.join(DATA_DIR, 'documents.json');

[DATA_DIR, FILES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, '[]', 'utf8');

// ── Helpers ──
function readDocs() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { return []; }
}
function writeDocs(docs) {
  fs.writeFileSync(META_FILE, JSON.stringify(docs, null, 2), 'utf8');
}

// ── Multer – store uploads to FILES_DIR ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('Only images and PDFs allowed'), ok);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Anthropic AI analysis ──
async function analyzeDocument(filePath, mimeType, originalName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const isImage = mimeType.startsWith('image/');
  let messages;

  const prompt = `Analyze this document and return ONLY a valid JSON object (no markdown, no backticks) with these exact fields:
{
  "title": "short descriptive title (max 60 chars)",
  "category": one of exactly: bill|tax|tax_receipt|notice|appointment|receipt|insurance|legal|financial|other,
  "priority": one of exactly: urgent|high|normal|low,
  "sender": "organization or person name, or null",
  "amount": "dollar amount as string e.g. $45.00, or null",
  "dueDate": "YYYY-MM-DD format or null",
  "appointmentDate": "YYYY-MM-DD format or null",
  "summary": "2-3 sentence plain-English summary",
  "actionRequired": "specific action needed, or null",
  "keyDetails": ["3 to 5 key facts as strings"],
  "taxYear": "4-digit year string or null"
}`;

  if (isImage) {
    const imageData = fs.readFileSync(filePath).toString('base64');
    messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } },
        { type: 'text', text: prompt }
      ]
    }];
  } else {
    // PDF – read as base64 document
    const pdfData = fs.readFileSync(filePath).toString('base64');
    messages = [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfData } },
        { type: 'text', text: prompt }
      ]
    }];
  }

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });

  const text = res.data.content.find(b => b.type === 'text')?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── API Routes ──

// GET all documents
app.get('/api/documents', (req, res) => {
  const docs = readDocs();
  // Return metadata without file paths (use /api/documents/:id/file for file)
  res.json(docs.map(d => ({ ...d, filePath: undefined })));
});

// GET single document
app.get('/api/documents/:id', (req, res) => {
  const docs = readDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ ...doc, filePath: undefined });
});

// GET file for a document
app.get('/api/documents/:id/file', (req, res) => {
  const docs = readDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (!fs.existsSync(doc.filePath)) return res.status(404).json({ error: 'File not found on disk' });
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
  res.sendFile(path.resolve(doc.filePath));
});

// POST upload + analyze
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const analysis = await analyzeDocument(req.file.path, req.file.mimetype, req.file.originalname);
    const doc = {
      id: uuidv4(),
      ...analysis,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      filePath: req.file.path,
      fileName: req.file.filename,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      status: 'unread'
    };
    const docs = readDocs();
    docs.unshift(doc);
    writeDocs(docs);
    res.json({ ...doc, filePath: undefined });
  } catch (err) {
    // Clean up uploaded file on error
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// PATCH update document metadata
app.patch('/api/documents/:id', (req, res) => {
  const docs = readDocs();
  const idx = docs.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['status','category','priority','title','dueDate','appointmentDate','amount','sender','actionRequired','summary','notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) docs[idx][k] = req.body[k]; });
  writeDocs(docs);
  res.json({ ...docs[idx], filePath: undefined });
});

// DELETE document
app.delete('/api/documents/:id', (req, res) => {
  const docs = readDocs();
  const idx = docs.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const doc = docs[idx];
  if (doc.filePath && fs.existsSync(doc.filePath)) {
    try { fs.unlinkSync(doc.filePath); } catch {}
  }
  docs.splice(idx, 1);
  writeDocs(docs);
  res.json({ success: true });
});

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Mail Organizer running on port ${PORT}`));
